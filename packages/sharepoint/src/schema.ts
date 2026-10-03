// SharePoint schema of the system (backlog B2). Provisioning only ever adds
// lists and columns; it never removes or changes existing ones.
import { APPLICATION_STATES, APPOINTMENT_STATES } from '@anmeldung/domain';

/** Bump when lists or columns are added. Stored in Config as `schemaVersion`. */
export const SCHEMA_VERSION = 2;

export type ColumnType = 'text' | 'note' | 'json' | 'boolean' | 'choice';

export interface ColumnSpec {
    /** SharePoint column name (internal name). */
    name: string;
    /** Property name on the domain object. */
    prop: string;
    type: ColumnType;
    indexed?: boolean;
    choices?: readonly string[];
}

export interface ListSpec {
    name: string;
    template: 'genericList' | 'documentLibrary';
    columns: ColumnSpec[];
}

export const LISTS = {
    config: {
        name: 'Config',
        template: 'genericList',
        // the key is stored in the built-in Title column
        columns: [
            { name: 'Title', prop: 'key', type: 'text', indexed: true },
            { name: 'Value', prop: 'value', type: 'note' },
            { name: 'IsPublic', prop: 'isPublic', type: 'boolean' },
        ],
    },
    assets: {
        name: 'Assets',
        template: 'documentLibrary',
        columns: [],
    },
    appointments: {
        name: 'Appointments',
        template: 'genericList',
        columns: [
            { name: 'ProcedureId', prop: 'procedureId', type: 'text', indexed: true },
            { name: 'ApplicationId', prop: 'applicationId', type: 'text', indexed: true },
            { name: 'VerantwortlicherId', prop: 'verantwortlicherId', type: 'text' },
            { name: 'SlotDatetime', prop: 'datetime', type: 'text', indexed: true },
            { name: 'State', prop: 'state', type: 'choice', indexed: true, choices: APPOINTMENT_STATES },
            { name: 'EmailCustomer', prop: 'emailCustomer', type: 'text' },
            { name: 'NameCustomer', prop: 'nameCustomer', type: 'text' },
            { name: 'RequestTime', prop: 'requestTime', type: 'text' },
            { name: 'RequestIp', prop: 'requestIp', type: 'text', indexed: true },
        ],
    },
    applications: {
        name: 'Applications',
        template: 'genericList',
        columns: [
            { name: 'ProcedureId', prop: 'procedureId', type: 'text', indexed: true },
            { name: 'FormId', prop: 'formId', type: 'text' },
            { name: 'Data', prop: 'data', type: 'json' },
            { name: 'State', prop: 'state', type: 'choice', indexed: true, choices: APPLICATION_STATES },
            { name: 'SecretariatComment', prop: 'secretariatComment', type: 'note' },
            { name: 'InterviewerComment', prop: 'interviewerComment', type: 'note' },
        ],
    },
    forms: {
        name: 'Forms',
        template: 'genericList',
        columns: [
            { name: 'FormJson', prop: 'formJson', type: 'json' },
            { name: 'DateLastUpdate', prop: 'dateLastUpdate', type: 'text' },
        ],
    },
    procedures: {
        name: 'Procedures',
        template: 'genericList',
        columns: [
            { name: 'FormId', prop: 'formId', type: 'text' },
            { name: 'Info', prop: 'info', type: 'json' },
            { name: 'StartDate', prop: 'startDate', type: 'text', indexed: true },
            { name: 'EndDate', prop: 'endDate', type: 'text', indexed: true },
        ],
    },
} as const satisfies Record<string, ListSpec>;

export type ListKey = keyof typeof LISTS;

/**
 * Config entries created by provisioning when missing; existing values are
 * never overwritten.
 */
export const DEFAULT_CONFIG = [
    {
        key: 'consentText',
        value: 'Ich bin einverstanden, dass meine Angaben zur Terminvergabe und Anmeldung gespeichert werden. (Platzhalter – Text in der Config-Liste anpassen.)',
        isPublic: true,
    },
    // bookings per IP address and procedure; 0 = unlimited
    { key: 'maxBookingsPerIp', value: '3', isPublic: false },
] as const;

/** Graph columnDefinition for a column spec. */
export function columnDefinition(col: ColumnSpec): Record<string, unknown> {
    const def: Record<string, unknown> = { name: col.name, indexed: col.indexed ?? false };
    switch (col.type) {
        case 'text':
            def.text = { maxLength: 255 };
            break;
        case 'note':
        case 'json':
            def.text = { allowMultipleLines: true, textType: 'plain' };
            break;
        case 'boolean':
            def.boolean = {};
            break;
        case 'choice':
            def.choice = { choices: col.choices, allowTextEntry: false, displayAs: 'dropDownMenu' };
            break;
    }
    return def;
}
