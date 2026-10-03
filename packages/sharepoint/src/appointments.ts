// Appointment domain service (backlog E1): all state changes go through
// here and are checked against the appointment state machine. Updates use
// the item eTag, so concurrent changes fail instead of overwriting.
import {
    canTransitionAppointment,
    type Appointment,
    type AppointmentState,
    type DraftAppointment,
} from '@anmeldung/domain';
import { Repository } from './repository.ts';
import type { SharePointSite } from './site.ts';

export class AppointmentError extends Error {}

type Tracked = { appointment: Appointment; eTag: string };

/** Fields cleared when a booking is released (cancellation). */
const BOOKING_FIELDS = ['applicationId', 'emailCustomer', 'nameCustomer', 'requestTime', 'requestIp'] as const;

export class AppointmentService {
    private readonly site: SharePointSite;
    readonly repo: Repository<Appointment>;

    constructor(site: SharePointSite) {
        this.site = site;
        this.repo = new Repository<Appointment>(site, 'appointments');
    }

    /** All appointments of a procedure, ordered by time and responsible person. */
    async listForProcedure(procedureId: string): Promise<Appointment[]> {
        return sortAppointments(await this.repo.list(this.repo.filter('procedureId', procedureId)));
    }

    async createDrafts(drafts: DraftAppointment[]): Promise<Appointment[]> {
        if (drafts.some((d) => d.state !== 'draft')) throw new AppointmentError('Neue Termine müssen Entwürfe sein');
        const items = await this.site.createItems(
            'appointments',
            drafts.map((d) => this.repo.toFields(d)),
        );
        return items.map((i) => this.repo.toEntity(i.id, i.fields));
    }

    /** Changes time or responsible person; only allowed for drafts. */
    async updateDraft(id: string, changes: Pick<Partial<Appointment>, 'datetime' | 'verantwortlicherId'>): Promise<void> {
        const { appointment, eTag } = await this.load(id);
        if (appointment.state !== 'draft') throw new AppointmentError('Nur Entwürfe können geändert werden');
        await this.repo.update(id, changes, eTag);
    }

    async deleteDrafts(ids: string[]): Promise<void> {
        const tracked = await this.loadMany(ids);
        if (tracked.some((t) => t.appointment.state !== 'draft'))
            throw new AppointmentError('Nur Entwürfe können gelöscht werden');
        await this.site.deleteItems('appointments', ids);
    }

    /** draft -> available for all given appointments (backlog E4). */
    async publish(ids: string[]): Promise<void> {
        const tracked = await this.loadMany(ids);
        for (const t of tracked) assertTransition(t.appointment.state, 'available');
        await this.site.updateItems(
            'appointments',
            tracked.map((t) => ({ id: t.appointment.id, fields: this.repo.toFields({ state: 'available' }, true), ifMatch: t.eTag })),
        );
    }

    /** booked -> done */
    async markDone(id: string): Promise<void> {
        await this.transition(id, 'booked', 'done');
    }

    /**
     * Releases a booking after a phone cancellation: booked -> available,
     * booking data and the application link are removed. The application
     * itself is never touched.
     */
    async cancelBooking(id: string): Promise<void> {
        const cleared = Object.fromEntries(BOOKING_FIELDS.map((f) => [f, undefined]));
        await this.transition(id, 'booked', 'available', cleared);
    }

    private async transition(
        id: string,
        from: AppointmentState,
        to: AppointmentState,
        changes: Partial<Appointment> = {},
    ): Promise<void> {
        const { appointment, eTag } = await this.load(id);
        if (appointment.state !== from) throw new AppointmentError(`Termin ist nicht ${from}, sondern ${appointment.state}`);
        assertTransition(from, to);
        await this.repo.update(id, { ...changes, state: to }, eTag);
    }

    private async load(id: string): Promise<Tracked> {
        const item = await this.site.getItem('appointments', id);
        if (!item) throw new AppointmentError(`Termin ${id} nicht gefunden`);
        return { appointment: this.repo.toEntity(item.id, item.fields), eTag: item.eTag };
    }

    private async loadMany(ids: string[]): Promise<Tracked[]> {
        return Promise.all(ids.map((id) => this.load(id)));
    }
}

function assertTransition(from: AppointmentState, to: AppointmentState): void {
    if (!canTransitionAppointment(from, to)) throw new AppointmentError(`Statuswechsel ${from} → ${to} ist nicht erlaubt`);
}

export function sortAppointments(list: Appointment[]): Appointment[] {
    return [...list].sort(
        (a, b) => a.datetime.localeCompare(b.datetime) || (a.verantwortlicherId ?? '').localeCompare(b.verantwortlicherId ?? ''),
    );
}
