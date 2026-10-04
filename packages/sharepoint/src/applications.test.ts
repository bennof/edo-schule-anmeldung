import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationService, ConflictError, childNameOf } from './applications.ts';
import { AppointmentService } from './appointments.ts';
import { FakeGraph } from './fake-graph.ts';
import { GraphClient } from './graph.ts';
import { provision } from './provision.ts';
import { SharePointSite } from './site.ts';

let service: ApplicationService;
let appointments: AppointmentService;

beforeEach(async () => {
    const fake = new FakeGraph();
    const site = new SharePointSite(new GraphClient(async () => 't', fake.fetch), 'site');
    await provision(site);
    service = new ApplicationService(site);
    appointments = new AppointmentService(site);
});

const create = (state: 'created' | 'submitted' = 'submitted') =>
    service.repo.create({ procedureId: 'p1', formId: 'f1', data: { nachname: 'Muster', vorname: 'Mia' }, state, contactName: 'Eva Muster' });

describe('application service', () => {
    it('derives the child name', () => {
        expect(childNameOf({ nachname: ' Muster ', vorname: 'Mia' })).toBe('Muster, Mia');
        expect(childNameOf({ vorname: 'Mia' })).toBe('Mia');
        expect(childNameOf({})).toBeUndefined();
    });

    it('lists summaries without form data', async () => {
        await create();
        const [s] = await service.listSummaries();
        expect(s.contactName).toBe('Eva Muster');
        expect('data' in s).toBe(false);
    });

    it('saves data and comments with eTag and keeps childName in sync (J5, J6)', async () => {
        const app = await create();
        const { eTag } = await service.load(app.id);
        const next = await service.save(app.id, { data: { nachname: 'Neu', vorname: 'Mia' }, secretariatComment: 'Pass fehlt' }, eTag);
        const { application } = await service.load(app.id);
        expect(application.childName).toBe('Neu, Mia');
        expect(application.secretariatComment).toBe('Pass fehlt');
        expect(next).not.toBe(eTag);
    });

    it('detects concurrent edits', async () => {
        const app = await create();
        const { eTag } = await service.load(app.id);
        await service.save(app.id, { secretariatComment: 'A' }, eTag);
        await expect(service.save(app.id, { secretariatComment: 'B' }, eTag)).rejects.toBeInstanceOf(ConflictError);
    });

    it('runs the review flow and rejects skipping steps (K5)', async () => {
        const app = await create();
        let { eTag } = await service.load(app.id);
        await expect(service.transition(app.id, 'checked', eTag)).rejects.toThrow(/submitted → checked/);
        eTag = await service.markInterview(app.id, eTag);
        eTag = await service.transition(app.id, 'in_review', eTag);
        eTag = await service.transition(app.id, 'checked', eTag);
        await expect(service.transition(app.id, 'imported', eTag)).rejects.toThrow(/checked → imported/);
        await service.transition(app.id, 'ready_for_svws', eTag);
        expect((await service.load(app.id)).application.state).toBe('ready_for_svws');
    });

    it('records SVWS transfers: imported only when complete', async () => {
        const app = await create();
        await service.repo.update(app.id, { state: 'ready_for_svws' });
        await service.recordTransfer(app.id, { ok: false, svwsId: '77' });
        expect((await service.load(app.id)).application).toMatchObject({ state: 'ready_for_svws', svwsId: '77' });
        await service.recordTransfer(app.id, { ok: true, svwsId: '77' });
        expect((await service.load(app.id)).application).toMatchObject({ state: 'imported', svwsId: '77' });
        const other = await create();
        await expect(service.recordTransfer(other.id, { ok: true, svwsId: '78' })).rejects.toThrow(/submitted → imported/);
    });

    it('marks the booked appointment done on interview (J4)', async () => {
        const app = await create('created');
        const [slot] = await appointments.createDrafts([{ procedureId: 'p1', datetime: '2030-03-04T08:00', state: 'draft' }]);
        await appointments.publish([slot.id]);
        await appointments.repo.update(slot.id, { state: 'booked', applicationId: app.id, nameCustomer: 'Eva' });
        await service.markInterview(app.id, (await service.load(app.id)).eTag);
        expect((await appointments.repo.get(slot.id))?.state).toBe('done');
        expect((await service.load(app.id)).application.state).toBe('interview');
    });
});
