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
    /** IP address the booking came from (abuse protection) */
    requestIp?: string;
}

export interface Application {
    id: string;
    procedureId: string;
    formId: string;
    data: unknown;
    state: ApplicationState;
    secretariatComment?: string;
    interviewerComment?: string;
    /** ISO 8601, set on public submission */
    submittedAt?: string;
    /** "Nachname, Vorname" of the child, derived from data (search/list) */
    childName?: string;
    /** contact from the booking; kept when the appointment is cancelled */
    contactName?: string;
    contactEmail?: string;
    /** student id in SVWS once transferred */
    svwsId?: string;
}

export interface FormDefinition {
    id: string;
    formJson: unknown;
    /** ISO 8601 */
    dateLastUpdate: string;
    /** stable key of the form across versions (D3) */
    formKey?: string;
    /** 1, 2, 3 … as text */
    version?: string;
}

/** Reference to an uploaded file, stored in the form data instead of the file. */
export interface UploadRef {
    /** `<applicationId>/<uuid>.<ext>` in the Uploads library */
    id: string;
    name: string;
    contentType: string;
    size: number;
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
