// Application data -> values for PDF form fields (backlog I3). PDF field
// names are data paths of the form (e.g. `erziehungsberechtigter1.telefonMobil`,
// `weitereSchulen[0].schule.name`). Checkboxes are named `path=value`
// (`geschlecht=w`, `foerderbedarf=true`). The PDF is a presentation only;
// the application data stay the source.
import { formatDate, groupItems, joinPath, type FieldItem, type FormData, type FormJson, type Item, type Option } from '@anmeldung/forms';

export interface PdfValues {
    /** display text per data path */
    text: Map<string, string>;
    /** raw value per data path (for `path=value` checkboxes) */
    raw: Map<string, unknown>;
}

/** Option lists of `optionsSource` fields, by source key. */
export type OptionLists = Record<string, Option[]>;

export function pdfValues(form: FormJson, data: FormData, options: OptionLists = {}): PdfValues {
    const values: PdfValues = { text: new Map(), raw: new Map() };
    walk(form, form.sections.flatMap((s) => s.items), data, '', options, values);
    return values;
}

function walk(form: FormJson, items: Item[], scope: unknown, base: string, options: OptionLists, out: PdfValues): void {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return;
    const local = scope as FormData;
    for (const item of items) {
        const value = local[item.id];
        if (value === undefined || value === null || value === '') continue;
        const path = joinPath(base, item.id);
        if (item.kind === 'field') {
            out.raw.set(path, value);
            out.text.set(path, displayText(item, value, options));
        } else if (Array.isArray(value)) {
            value.forEach((entry, i) => walk(form, groupItems(form, item), entry, joinPath(path, i), options, out));
        } else {
            walk(form, groupItems(form, item), value, path, options, out);
        }
    }
}

export function displayText(field: FieldItem, value: unknown, options: OptionLists = {}): string {
    const list = field.options ?? (field.optionsSource ? options[field.optionsSource] : undefined) ?? [];
    const label = (key: unknown) => list.find((o) => o.key === key)?.value ?? String(key);
    switch (field.type) {
        case 'date':
            return typeof value === 'string' ? formatDate(value) : String(value);
        case 'boolean':
            return value === true ? 'Ja' : value === false ? 'Nein' : '';
        case 'select':
        case 'searchselect':
            return label(value);
        case 'multiselect':
            return Array.isArray(value) ? value.map(label).join(', ') : '';
        default:
            return String(value);
    }
}

/** Whether a `path=expected` checkbox is ticked for a raw value. */
export function isChecked(raw: unknown, expected: string): boolean {
    if (expected === 'true') return raw === true;
    if (expected === 'false') return raw === false;
    if (Array.isArray(raw)) return raw.map(String).includes(expected);
    return raw !== undefined && String(raw) === expected;
}
