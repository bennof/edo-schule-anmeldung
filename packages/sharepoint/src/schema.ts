// SharePoint schema of the system (backlog B2). Provisioning only ever adds
// lists and columns; it never removes or changes existing ones.
import { APPLICATION_STATES, APPOINTMENT_STATES } from '@anmeldung/domain';

/** Bump when lists or columns are added. Stored in Config as `schemaVersion`. */
export const SCHEMA_VERSION = 5;

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
            { name: 'SubmittedAt', prop: 'submittedAt', type: 'text' },
            // denormalized for the applications panel and name search (K1/K2)
            { name: 'ChildName', prop: 'childName', type: 'text', indexed: true },
            { name: 'ContactName', prop: 'contactName', type: 'text', indexed: true },
            { name: 'ContactEmail', prop: 'contactEmail', type: 'text' },
            // SHA-256 of the family's access token (public form); never the token itself
            { name: 'AccessTokenHash', prop: 'accessTokenHash', type: 'text' },
        ],
    },
    forms: {
        name: 'Forms',
        template: 'genericList',
        // saved versions are never changed (D3); a change is a new item with
        // the same FormKey and the next Version
        columns: [
            { name: 'FormJson', prop: 'formJson', type: 'json' },
            { name: 'DateLastUpdate', prop: 'dateLastUpdate', type: 'text' },
            { name: 'FormKey', prop: 'formKey', type: 'text', indexed: true },
            { name: 'FormVersion', prop: 'version', type: 'text' },
        ],
    },
    uploads: {
        // files of applications (photo, documents), one folder per application
        name: 'Uploads',
        template: 'documentLibrary',
        columns: [],
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
    // confirmation mail (H1); no mail is sent while mailSender is empty
    { key: 'mailSender', value: '', isPublic: false },
    { key: 'confirmationMailSubject', value: 'Ihr Termin zur Schulanmeldung', isPublic: false },
    {
        key: 'confirmationMailText',
        value: [
            'Guten Tag {name},',
            '',
            'vielen Dank für Ihre Terminbuchung.',
            '',
            'Verfahren: {verfahren}',
            'Termin: {datum}, {uhrzeit} Uhr',
            '',
            'Bitte füllen Sie vor dem Termin das Anmeldeformular aus. Über diesen Link können Sie es auch auf einem anderen Gerät fortsetzen:',
            '{link}',
            '',
            'Bei Fragen oder für eine Absage wenden Sie sich bitte telefonisch an das Sekretariat.',
            '',
            'Mit freundlichen Grüßen',
            'Ihr Sekretariat',
        ].join('\n'),
        isPublic: false,
    },
    // address of the public SPA, used for links in mails
    { key: 'publicUrl', value: '', isPublic: false },
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
