// SharePoint adapter against the real test site, with the same code the
// secretariat SPA uses (authenticated app-only).
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { generateSchedule, type Appointment } from '../../packages/domain/src/index.ts';
import { AppointmentService, ConfigStore, Repository, SCHEMA_VERSION, provision } from '../../packages/sharepoint/src/index.ts';
import { testSite } from '../support/env.ts';

const site = testSite();

it('provisioning', async () => {
    await provision(site);
});

it('provisioning is idempotent', async () => {
    const r = await provision(testSite());
    assert(r.createdLists.length + r.createdColumns.length + r.createdConfig.length === 0, `second run changed schema: ${JSON.stringify(r)}`);
});

it('schema version stored in Config', async () => {
    const v = await new ConfigStore(site).get('schemaVersion');
    assert(v === String(SCHEMA_VERSION), `schemaVersion is ${v}`);
});

it('config set/get/delete', async () => {
    const config = new ConfigStore(site);
    const key = `itest-${Date.now()}`;
    await config.set(key, 'eins', true);
    await config.set(key, 'zwei');
    assert((await config.get(key)) === 'zwei', 'value not updated');
    assert((await config.publicEntries()).some((e) => e.key === key), 'isPublic not kept');
    await config.delete(key);
    assert((await config.get(key)) === undefined, 'entry not deleted');
});

it('appointment CRUD with filter and If-Match', async () => {
    const repo = new Repository<Appointment>(site, 'appointments');
    const procedureId = `itest-${Date.now()}`;
    const a = await repo.create({ procedureId, datetime: '2030-01-07T08:00', state: 'available' });
    try {
        const found = await repo.list(`${repo.filter('procedureId', procedureId)} and ${repo.filter('state', 'available')}`);
        assert(found.length === 1 && found[0].id === a.id, `filter returned ${found.length} items`);

        const item = (await site.getItem('appointments', a.id))!;
        await site.updateItem('appointments', a.id, { State: 'booked', NameCustomer: 'Test' }, item.eTag);
        const stale = await site.updateItem('appointments', a.id, { State: 'booked' }, item.eTag).then(
            () => 'accepted',
            (e) => e.status,
        );
        assert(stale === 412, `stale update was ${stale}`);

        await repo.update(a.id, { state: 'available', nameCustomer: undefined });
        const after = await repo.get(a.id);
        assert(after?.state === 'available' && after.nameCustomer === undefined, 'update/clear failed');
    } finally {
        await repo.delete(a.id);
    }
    assert((await repo.get(a.id)) === undefined, 'item not deleted');
});

it('appointment service: batch create, publish, delete (45 items)', async () => {
    const service = new AppointmentService(site);
    const procedureId = `itest-${Date.now()}`;
    const plan = generateSchedule({ procedureId, date: '2030-01-07', start: '08:00', end: '11:45', intervalMinutes: 15, verantwortliche: ['A', 'B', 'C'] });
    const created = await service.createDrafts(plan);
    try {
        assert(created.length === 45, `created ${created.length}`);
        await service.publish(created.slice(0, 30).map((a) => a.id));
        const list = await service.listForProcedure(procedureId);
        const available = list.filter((a) => a.state === 'available').length;
        assert(available === 30, `available ${available}`);
        const err = await service.deleteDrafts([created[0].id]).then(
            () => undefined,
            (e) => e,
        );
        assert(err, 'deleting a published appointment must fail');
    } finally {
        await site.deleteItems(
            'appointments',
            created.map((a) => a.id),
        );
    }
    assert((await service.listForProcedure(procedureId)).length === 0, 'cleanup failed');
});

it('application JSON round-trip', async () => {
    const repo = new Repository<{ id: string; procedureId: string; formId: string; data: unknown; state: string }>(site, 'applications');
    const data = { kind: { vorname: 'Ana', geburtsdatum: '2015-03-01' }, schulen: [{ von: 2021 }] };
    const app = await repo.create({ procedureId: 'itest', formId: 'f', data, state: 'created' });
    try {
        assert(JSON.stringify((await repo.get(app.id))?.data) === JSON.stringify(data), 'data changed');
    } finally {
        await repo.delete(app.id);
    }
});

it('asset put/get/delete', async () => {
    const key = `itest-${Date.now()}.txt`;
    await site.putAsset(key, new Blob(['hallo'], { type: 'text/plain' }));
    assert((await (await site.getAsset(key))?.text()) === 'hallo', 'content differs');
    await site.deleteAsset(key);
    assert((await site.getAsset(key)) === undefined, 'asset not deleted');
});
