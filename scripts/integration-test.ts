// Integration test against the real SharePoint test site (SHAREPOINT_ID in .env).
// Runs the same adapter code the Secretariat SPA uses, authenticated app-only.
// Usage: pnpm test:integration
import type { Appointment } from '../packages/domain/src/index.ts';
import {
    ConfigStore,
    GraphClient,
    Repository,
    SCHEMA_VERSION,
    SharePointSite,
    provision,
} from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';

const env = readEnv();
const newSite = () => new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);

let failures = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`ok    ${name}`);
    } catch (e) {
        failures++;
        console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
    }
}
function assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new Error(message);
}

const site = newSite();

await step('provisioning', async () => {
    const r = await provision(site);
    console.log(`      created lists: ${r.createdLists.join(', ') || '-'}; columns: ${r.createdColumns.join(', ') || '-'}`);
});

await step('provisioning is idempotent', async () => {
    const r = await provision(newSite());
    assert(r.createdLists.length === 0 && r.createdColumns.length === 0, `second run changed schema: ${JSON.stringify(r)}`);
});

await step('schema version stored in Config', async () => {
    const v = await new ConfigStore(site).get('schemaVersion');
    assert(v === String(SCHEMA_VERSION), `schemaVersion is ${v}`);
});

await step('config set/get/delete', async () => {
    const config = new ConfigStore(site);
    const key = `itest-${Date.now()}`;
    await config.set(key, 'eins', true);
    await config.set(key, 'zwei');
    assert((await config.get(key)) === 'zwei', 'value not updated');
    assert((await config.publicEntries()).some((e) => e.key === key), 'isPublic not kept');
    await config.delete(key);
    assert((await config.get(key)) === undefined, 'entry not deleted');
});

await step('appointment CRUD with filter and If-Match', async () => {
    const repo = new Repository<Appointment>(site, 'appointments');
    const procedureId = `itest-${Date.now()}`;
    const a = await repo.create({ procedureId, datetime: '2030-01-07T08:00', state: 'available' });
    try {
        const found = await repo.list(`${repo.filter('procedureId', procedureId)} and ${repo.filter('state', 'available')}`);
        assert(found.length === 1 && found[0].id === a.id, `filter returned ${found.length} items`);

        const item = (await site.getItem('appointments', a.id))!;
        await site.updateItem('appointments', a.id, { State: 'booked', NameCustomer: 'Test' }, item.eTag);
        const stale = await site
            .updateItem('appointments', a.id, { State: 'booked' }, item.eTag)
            .then(() => 'accepted', (e) => e.status);
        assert(stale === 412, `stale update was ${stale}`);

        await repo.update(a.id, { state: 'available', nameCustomer: undefined });
        const after = await repo.get(a.id);
        assert(after?.state === 'available' && after.nameCustomer === undefined, 'update/clear failed');
    } finally {
        await repo.delete(a.id);
    }
    assert((await repo.get(a.id)) === undefined, 'item not deleted');
});

await step('application JSON round-trip', async () => {
    const repo = new Repository<{ id: string; procedureId: string; formId: string; data: unknown; state: string }>(
        site,
        'applications',
    );
    const data = { kind: { vorname: 'Ana', geburtsdatum: '2015-03-01' }, schulen: [{ von: 2021 }] };
    const app = await repo.create({ procedureId: 'itest', formId: 'f', data, state: 'created' });
    try {
        assert(JSON.stringify((await repo.get(app.id))?.data) === JSON.stringify(data), 'data changed');
    } finally {
        await repo.delete(app.id);
    }
});

await step('asset put/get/delete', async () => {
    const key = `itest-${Date.now()}.txt`;
    await site.putAsset(key, new Blob(['hallo'], { type: 'text/plain' }));
    assert((await (await site.getAsset(key))?.text()) === 'hallo', 'content differs');
    await site.deleteAsset(key);
    assert((await site.getAsset(key)) === undefined, 'asset not deleted');
});

console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
process.exit(failures ? 1 : 0);
