import { beforeEach, expect, it } from 'vitest';
import { FakeGraph } from './fake-graph.ts';
import { GraphClient } from './graph.ts';
import { deleteProcedure } from './procedures.ts';
import { provision } from './provision.ts';
import { SharePointSite } from './site.ts';

let fake: FakeGraph;
let site: SharePointSite;

beforeEach(async () => {
    fake = new FakeGraph();
    site = new SharePointSite(new GraphClient(async () => 't', fake.fetch), 'site');
    await provision(site);
});

it('deletes a procedure with its applications, uploads and appointments, not the form', async () => {
    const [form] = await site.createItems('forms', [{ FormKey: 'k', FormVersion: '1' }]);
    const [p1, p2] = await site.createItems('procedures', [{ FormId: form!.id }, { FormId: form!.id }]);
    const apps = await site.createItems('applications', [{ ProcedureId: p1!.id }, { ProcedureId: p1!.id }, { ProcedureId: p2!.id }]);
    await site.createItems('appointments', [{ ProcedureId: p1!.id }, { ProcedureId: p2!.id }]);
    fake.folders = [apps[0]!.id, apps[2]!.id]; // the second application has no files

    expect(await deleteProcedure(site, p1!.id)).toEqual({ applications: 2, appointments: 1 });

    expect((await site.listItems('procedures')).map((i) => i.id)).toEqual([p2!.id]);
    expect((await site.listItems('applications')).map((i) => i.id)).toEqual([apps[2]!.id]);
    expect(await site.listItems('appointments')).toHaveLength(1);
    expect(await site.listItems('forms')).toHaveLength(1);
    // only the existing folder is deleted
    expect(fake.requests.filter((r) => r.startsWith('DELETE') && r.includes('/drive/'))).toEqual([`DELETE /lists/${(await site.listId('uploads'))}/drive/root:/${apps[0]!.id}:`]);
});
