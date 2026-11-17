// Targets of a PDF field assignment (FormJson.pdf): which data of a form a
// PDF field can show. Used by the secretariat (selection list) and the
// semantic check.
import type { FieldItem, FormJson, Item } from './types.ts';

export const SPECIAL_TARGETS = [
    { target: 'anmeldung.termin', label: 'Termin des Anmeldegesprächs' },
    { target: 'anmeldung.nummer', label: 'Nummer der Anmeldung' },
] as const;

export interface PdfTarget {
    /** value stored in the assignment */
    target: string;
    /** readable path for the selection */
    label: string;
    /** `check`: a checkbox that is ticked for exactly this value */
    kind: 'text' | 'check';
}

/** Repeat entries offered when a repeat group has no maxItems. */
const DEFAULT_REPEATS = 3;
const MAX_REPEATS = 10;

export function pdfTargets(form: FormJson): PdfTarget[] {
    const out: PdfTarget[] = [];
    const walk = (items: Item[], base: string, trail: string): void => {
        for (const item of items) {
            if (item.kind === 'group') {
                const group = form.groups?.[item.group];
                if (!group) continue;
                const count = item.repeat ? Math.min(item.repeat.maxItems ?? DEFAULT_REPEATS, MAX_REPEATS) : 0;
                if (!item.repeat) walk(group.items, `${base}${item.id}.`, `${trail}${item.label} › `);
                for (let i = 0; i < count; i++)
                    walk(group.items, `${base}${item.id}[${i}].`, `${trail}${item.label} ${i + 1} › `);
                continue;
            }
            addField(item, `${base}${item.id}`, `${trail}${item.label}`);
        }
    };
    const addField = (field: FieldItem, path: string, label: string): void => {
        out.push({ target: path, label, kind: 'text' });
        if (field.type === 'boolean') {
            out.push({ target: `${path}=true`, label: `${label} = Ja (Kästchen)`, kind: 'check' });
            out.push({ target: `${path}=false`, label: `${label} = Nein (Kästchen)`, kind: 'check' });
        }
        for (const option of field.options ?? [])
            if (field.type === 'select' || field.type === 'multiselect' || field.type === 'searchselect')
                out.push({ target: `${path}=${option.key}`, label: `${label} = ${option.value} (Kästchen)`, kind: 'check' });
    };
    walk(form.sections.flatMap((s) => s.items), '', '');
    for (const s of SPECIAL_TARGETS) out.push({ target: s.target, label: s.label, kind: 'text' });
    return out;
}

/** Splits `path=value`; paths never contain `=`. */
export function splitTarget(target: string): { path: string; value?: string } {
    const at = target.indexOf('=');
    return at < 0 ? { path: target } : { path: target.slice(0, at), value: target.slice(at + 1) };
}

/** Problems of the PDF assignment of a form (empty: none or no assignment). */
export function checkPdfAssignment(form: FormJson): string[] {
    if (!form.pdf) return [];
    const fieldAt = (path: string): FieldItem | undefined => {
        let items: Item[] = form.sections.flatMap((s) => s.items);
        const parts = path.replace(/\[\d+\]/g, '').split('.');
        for (const [i, part] of parts.entries()) {
            const item = items.find((x) => x.id === part);
            if (!item) return undefined;
            if (i === parts.length - 1) return item.kind === 'field' ? item : undefined;
            if (item.kind !== 'group') return undefined;
            items = form.groups?.[item.group]?.items ?? [];
        }
        return undefined;
    };
    const errors: string[] = [];
    for (const [name, target] of Object.entries(form.pdf.fields)) {
        if (SPECIAL_TARGETS.some((s) => s.target === target)) continue;
        const { path, value } = splitTarget(target);
        const field = fieldAt(path);
        if (!field) errors.push(`pdf: "${name}" -> unknown data path "${path}"`);
        else if (value !== undefined && field.type === 'boolean' && value !== 'true' && value !== 'false')
            errors.push(`pdf: "${name}" -> "${target}": checkbox of a yes/no field needs =true or =false`);
        else if (value !== undefined && field.options && !field.options.some((o) => o.key === value))
            errors.push(`pdf: "${name}" -> "${target}": "${value}" is not an option`);
    }
    return errors;
}
