// Domain models shared by both SPAs. No SharePoint or SVWS specifics here.
import type { AppointmentState, ApplicationState } from './states.ts';

export interface ConfigEntry {
    key: string;
    value: string;
    /** Only public entries may be delivered to the public SPA. */
    isPublic: boolean;
}

export interface Asset {
    key: string;
    contentType: string;
    data: Blob;
}

export interface Appointment {
    id: string;
    procedureId: string;
    applicationId?: string;
    verantwortlicherId?: string;
    /** Local date-time without zone, YYYY-MM-DDTHH:mm */
    datetime: string;
    state: AppointmentState;
    emailCustomer?: string;
    nameCustomer?: string;
    /** Time of the booking request (ISO 8601) */
    requestTime?: string;
}

export interface Application {
    id: string;
    procedureId: string;
    formId: string;
    data: unknown;
    state: ApplicationState;
    secretariatComment?: string;
    interviewerComment?: string;
}

export interface FormDefinition {
    id: string;
    formJson: unknown;
    /** ISO 8601 */
    dateLastUpdate: string;
}

/** Descriptive data of a procedure, stored as JSON (`info`). */
export interface ProcedureInfo {
    title: string;
    description?: string;
}

export interface Procedure {
    id: string;
    formId: string;
    info: ProcedureInfo;
    /** YYYY-MM-DD */
    startDate: string;
    /** YYYY-MM-DD */
    endDate: string;
}
