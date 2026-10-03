// Application service for the secretariat (backlog J3-J6, K1-K5): checked
// state transitions, saving with eTag so concurrent edits are detected.
import { canTransitionApplication, type Application, type ApplicationState } from '@anmeldung/domain';
import { AppointmentService } from './appointments.ts';
import { GraphError } from './graph.ts';
import { Repository } from './repository.ts';
import type { SharePointSite } from './site.ts';

export class ApplicationError extends Error {}

/** Thrown when the application was changed by someone else since loading. */
export class ConflictError extends ApplicationError {}

export type ApplicationSummary = Omit<Application, 'data' | 'secretariatComment' | 'interviewerComment'>;

export interface EditableFields {
    data?: unknown;
    secretariatComment?: string;
    interviewerComment?: string;
}

/**
 * "Nachname, Vorname" from form data. Convention: the child's name is in the
 * top-level fields `nachname` and `vorname` of the form.
 */
export function childNameOf(data: unknown): string | undefined {
    const d = (data ?? {}) as Record<string, unknown>;
    const parts = [d.nachname, d.vorname].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return parts.length ? parts.map((p) => p.trim()).join(', ') : undefined;
}

const SUMMARY_PROPS = ['procedureId', 'formId', 'state', 'submittedAt', 'childName', 'contactName', 'contactEmail'] as const;

export class ApplicationService {
    readonly repo: Repository<Application>;
    private readonly appointments: AppointmentService;

    constructor(site: SharePointSite) {
        this.repo = new Repository<Application>(site, 'applications');
        this.appointments = new AppointmentService(site);
    }

    /** All applications without form data and comments (fast list for K1). */
    async listSummaries(): Promise<ApplicationSummary[]> {
        return this.repo.list(undefined, [...SUMMARY_PROPS]);
    }

    async load(id: string): Promise<{ application: Application; eTag: string }> {
        const tracked = await this.repo.getTracked(id);
        if (!tracked) throw new ApplicationError(`Anmeldung ${id} nicht gefunden`);
        return { application: tracked.entity, eTag: tracked.eTag };
    }

    /** Saves data and/or comments; returns the new eTag (J5, J6). */
    async save(id: string, fields: EditableFields, eTag: string): Promise<string> {
        const changes: Partial<Application> = { ...fields };
        if ('data' in fields) changes.childName = childNameOf(fields.data);
        return this.update(id, changes, eTag);
    }

    /** Explicit state change by the secretariat (K5); returns the new eTag. */
    async transition(id: string, to: ApplicationState, eTag: string): Promise<string> {
        const { application } = await this.load(id);
        if (!canTransitionApplication(application.state, to))
            throw new ApplicationError(`Statuswechsel ${application.state} → ${to} ist nicht erlaubt`);
        return this.update(id, { state: to }, eTag);
    }

    /**
     * J4: the family showed up. Application -> interview; the booked
     * appointment of this application (if any) -> done.
     */
    async markInterview(id: string, eTag: string): Promise<string> {
        const next = await this.transition(id, 'interview', eTag);
        const [appointment] = await this.appointments.repo.list(this.appointments.repo.filter('applicationId', id));
        if (appointment?.state === 'booked') await this.appointments.markDone(appointment.id);
        return next;
    }

    private async update(id: string, changes: Partial<Application>, eTag: string): Promise<string> {
        try {
            return await this.repo.update(id, changes, eTag);
        } catch (e) {
            if (e instanceof GraphError && e.status === 412)
                throw new ConflictError('Die Anmeldung wurde zwischenzeitlich von jemand anderem geändert.');
            throw e;
        }
    }
}
