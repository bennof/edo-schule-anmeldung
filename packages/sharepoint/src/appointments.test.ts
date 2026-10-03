import { generateSchedule } from '@anmeldung/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppointmentService } from './appointments.ts';
import { FakeGraph } from './fake-graph.ts';
import { GraphClient } from './graph.ts';
import { provision } from './provision.ts';
import { SharePointSite } from './site.ts';

let fake: FakeGraph;
let service: AppointmentService;

beforeEach(async () => {
    fake = new FakeGraph();
    const site = new SharePointSite(new GraphClient(async () => 't', fake.fetch), 'site');
    await provision(site);
    service = new AppointmentService(site);
});

const plan = () =>
    generateSchedule({ procedureId: 'p1', date: '2030-03-04', start: '08:00', end: '09:00', intervalMinutes: 20, verantwortliche: ['A', 'B'] });

describe('appointment service', () => {
    it('creates drafts in batches and lists them sorted', async () => {
        const many = generateSchedule({ procedureId: 'p1', date: '2030-03-04', start: '08:00', end: '12:00', intervalMinutes: 5 });
        await service.createDrafts(many);
        expect(fake.requests.filter((r) => r === 'POST /$batch' || r.startsWith('POST /lists/') && r.endsWith('/items')).length).toBeGreaterThan(0);
        const list = await service.listForProcedure('p1');
        expect(list).toHaveLength(48);
        expect(list[0].datetime).toBe('2030-03-04T08:00');
        expect(list.every((a) => a.state === 'draft')).toBe(true);
    });

    it('edits and deletes drafts only', async () => {
        const [a, b] = await service.createDrafts(plan());
        await service.updateDraft(a.id, { datetime: '2030-03-04T07:40' });
        expect((await service.repo.get(a.id))?.datetime).toBe('2030-03-04T07:40');

        await service.publish([b.id]);
        await expect(service.updateDraft(b.id, { datetime: 'x' })).rejects.toThrow(/Nur Entwürfe/);
        await expect(service.deleteDrafts([a.id, b.id])).rejects.toThrow(/Nur Entwürfe/);

        await service.deleteDrafts([a.id]);
        expect(await service.repo.get(a.id)).toBeUndefined();
    });

    it('publishes drafts and refuses to publish twice', async () => {
        const drafts = await service.createDrafts(plan());
        await service.publish(drafts.map((d) => d.id));
        expect((await service.listForProcedure('p1')).every((a) => a.state === 'available')).toBe(true);
        await expect(service.publish([drafts[0].id])).rejects.toThrow(/available → available/);
    });

    it('cancels a booking: back to available, booking data removed', async () => {
        const [a] = await service.createDrafts(plan());
        await service.publish([a.id]);
        await service.repo.update(a.id, { state: 'booked', nameCustomer: 'X', emailCustomer: 'x@y.de', applicationId: '7', requestTime: 't', requestIp: '10.0.0.1' });
        await service.cancelBooking(a.id);
        expect(await service.repo.get(a.id)).toEqual({ id: a.id, procedureId: 'p1', datetime: a.datetime, verantwortlicherId: 'A', state: 'available' });
    });

    it('rejects invalid transitions', async () => {
        const [a] = await service.createDrafts(plan());
        await expect(service.markDone(a.id)).rejects.toThrow(/nicht booked, sondern draft/);
        await expect(service.cancelBooking(a.id)).rejects.toThrow(/nicht booked, sondern draft/);
        expect((await service.repo.get(a.id))?.state).toBe('draft');
    });
});
