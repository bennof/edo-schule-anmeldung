import type { Appointment } from '@anmeldung/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './config.ts';
import { FakeGraph } from './fake-graph.ts';
import { GraphClient, GraphError } from './graph.ts';
import { provision } from './provision.ts';
import { Repository } from './repository.ts';
import { LISTS, SCHEMA_VERSION } from './schema.ts';
import { SharePointSite } from './site.ts';

let fake: FakeGraph;
let site: SharePointSite;

function newSite(): SharePointSite {
    return new SharePointSite(new GraphClient(async () => 'token', fake.fetch), 'site-1');
}

beforeEach(() => {
    fake = new FakeGraph();
    site = newSite();
});

describe('provision', () => {
    it('creates all lists on an empty site and stores the schema version', async () => {
        const report = await provision(site);
        expect(report.createdLists).toEqual(Object.values(LISTS).map((l) => l.name));
        expect(await new ConfigStore(site).get('schemaVersion')).toBe(String(SCHEMA_VERSION));
        const config = fake.lists.find((l) => l.displayName === 'Config')!;
        expect(config.columns.find((c) => c.name === 'Title')!.indexed).toBe(true);
    });

    it('is idempotent and keeps existing data', async () => {
        await provision(site);
        const repo = new Repository<Appointment>(site, 'appointments');
        const created = await repo.create({ procedureId: 'p1', datetime: '2026-11-02T08:00', state: 'draft' });

        const report = await provision(newSite());
        expect(report.createdLists).toEqual([]);
        expect(report.createdColumns).toEqual([]);
        expect(await repo.get(created.id)).toEqual(created);
        expect(fake.requests.some((r) => r.startsWith('DELETE'))).toBe(false);
    });

    it('adds columns missing on an existing list', async () => {
        await provision(site);
        const list = fake.lists.find((l) => l.displayName === 'Applications')!;
        list.columns = list.columns.filter((c) => c.name !== 'SecretariatComment');
        const report = await provision(newSite());
        expect(report.createdColumns).toEqual(['Applications.SecretariatComment']);
    });

    it('refuses to run against a newer schema', async () => {
        await provision(site);
        await new ConfigStore(site).set('schemaVersion', String(SCHEMA_VERSION + 1));
        await expect(provision(newSite())).rejects.toThrow(/schema version/);
    });
});

describe('repository', () => {
    beforeEach(() => provision(site));

    it('round-trips entities including JSON columns', async () => {
        const repo = new Repository<{ id: string; procedureId: string; formId: string; data: unknown; state: string }>(
            site,
            'applications',
        );
        const app = await repo.create({ procedureId: 'p1', formId: 'f1', data: { child: { name: 'Ana' } }, state: 'created' });
        expect(fake.lists.find((l) => l.displayName === 'Applications')!.items[0].fields.Data).toBe(
            '{"child":{"name":"Ana"}}',
        );
        expect(await repo.get(app.id)).toEqual(app);

        await repo.update(app.id, { state: 'submitted' });
        expect((await repo.get(app.id))!.state).toBe('submitted');

        await repo.delete(app.id);
        expect(await repo.get(app.id)).toBeUndefined();
    });

    it('clears columns set to undefined and filters by property', async () => {
        const repo = new Repository<Appointment>(site, 'appointments');
        const a = await repo.create({
            procedureId: 'p1',
            datetime: '2026-11-02T08:00',
            state: 'booked',
            nameCustomer: "O'Neil",
            emailCustomer: 'x@example.org',
        });
        await repo.create({ procedureId: 'p2', datetime: '2026-11-02T08:10', state: 'available' });

        expect((await repo.list(repo.filter('procedureId', 'p1'))).map((x) => x.id)).toEqual([a.id]);

        await repo.update(a.id, { state: 'available', nameCustomer: undefined, emailCustomer: undefined });
        const after = await repo.get(a.id);
        expect(after).toEqual({ id: a.id, procedureId: 'p1', datetime: '2026-11-02T08:00', state: 'available' });
    });

    it('rejects stale updates with If-Match', async () => {
        const item = await site.createItem('appointments', { State: 'available' });
        await site.updateItem('appointments', item.id, { State: 'booked' }, item.eTag);
        const err = await site.updateItem('appointments', item.id, { State: 'booked' }, item.eTag).catch((e) => e);
        expect(err).toBeInstanceOf(GraphError);
        expect(err.status).toBe(412);
    });
});

describe('config', () => {
    beforeEach(() => provision(site));

    it('sets, updates, reads and deletes entries', async () => {
        const config = new ConfigStore(site);
        await config.set('schoolName', 'Gesamtschule', true);
        await config.set('internalNote', 'nur intern');
        await config.set('schoolName', 'Gesamtschule Nord');

        expect(await config.get('schoolName')).toBe('Gesamtschule Nord');
        expect((await config.publicEntries()).map((e) => e.key)).toEqual(['schoolName']);

        await config.delete('internalNote');
        expect(await config.get('internalNote')).toBeUndefined();
    });
});

describe('graph client', () => {
    it('retries throttled requests', async () => {
        let calls = 0;
        const fetchFn = (async () => {
            calls++;
            return calls === 1
                ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
                : new Response('{"value":[]}', { status: 200 });
        }) as typeof fetch;
        const graph = new GraphClient(async () => 't', fetchFn);
        expect(await graph.collect('/sites/x/lists')).toEqual([]);
        expect(calls).toBe(2);
    });
});
