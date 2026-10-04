// TypeScript view of schema/form.schema.json (format version 1).
//
// Application data mirrors the item tree, sections are not part of it:
//   { [fieldId]: value, [groupId]: { ...group data } | Array<{ ...group data }> }
// Values: text/email/phone/searchselect/select -> string (option key),
// multiselect -> string[], integer/year -> number, boolean -> boolean,
// date -> "YYYY-MM-DD" (no time zone), file -> FileRef | FileRef[] (multiple).

export type FieldType =
    | 'text'
    | 'email'
    | 'phone'
    | 'date'
    | 'year'
    | 'integer'
    | 'boolean'
    | 'select'
    | 'multiselect'
    | 'searchselect'
    | 'file';

export interface Option {
    key: string;
    value: string;
}

export type Scalar = string | number | boolean;

export type Condition =
    | { field: string; equals: Scalar }
    | { field: string; notEquals: Scalar }
    | { field: string; in: Scalar[] }
    | { field: string; filled: boolean }
    | { all: Condition[] }
    | { any: Condition[] }
    | { not: Condition };

export interface FieldItem {
    kind: 'field';
    id: string;
    type: FieldType;
    label: string;
    help?: string;
    required?: boolean;
    /** boolean only: must be true (acknowledgement checkbox) */
    mustAccept?: true;
    requiredIf?: Condition;
    visibleIf?: Condition;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number | string;
    max?: number | string;
    minItems?: number;
    maxItems?: number;
    options?: Option[];
    optionsSource?: string;
    /** file only */
    accept?: FileContentType[];
    multiple?: boolean;
    maxFiles?: number;
    /** 'photo': the student photo */
    role?: 'photo';
}

export type FileContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

/** Value of a file field: a reference to the stored file, never the file itself. */
export interface FileRef {
    /** `<applicationId>/<file>` in the Uploads library */
    id: string;
    name: string;
    contentType: string;
    size: number;
}

export interface GroupItem {
    kind: 'group';
    id: string;
    group: string;
    label: string;
    visibleIf?: Condition;
    repeat?: { minItems?: number; maxItems?: number; itemLabel?: string };
    copyFrom?: string[];
}

export type Item = FieldItem | GroupItem;

export interface GroupDefinition {
    description?: string;
    items: Item[];
}

export interface Section {
    id: string;
    title: string;
    description?: string;
    visibleIf?: Condition;
    items: Item[];
}

export interface FormJson {
    formatVersion: 1;
    title: string;
    groups?: Record<string, GroupDefinition>;
    sections: Section[];
}
