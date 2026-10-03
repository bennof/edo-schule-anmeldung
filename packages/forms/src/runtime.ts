// Framework-independent form runtime (backlog C2): initial data, conditions,
// visibility, validation, repeatable groups and copying between groups.
// Data layout is described in types.ts.
import type { Condition, FieldItem, FormJson, GroupItem, Item, Scalar } from './types.ts';

export type FormData = Record<string, unknown>;

export interface ValidationError {
    /** e.g. `sorgeberechtigter1.nachname` or `schulen[1].von` */
    path: string;
    code: string;
    message: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()/-]{3,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function joinPath(base: string, part: string | number): string {
    if (typeof part === 'number') return `${base}[${part}]`;
    return base ? `${base}.${part}` : part;
}

export function groupItems(form: FormJson, item: GroupItem): Item[] {
    const def = form.groups?.[item.group];
    if (!def) throw new Error(`Unknown group "${item.group}"`);
    return def.items;
}

function rootItems(form: FormJson): Item[] {
    return form.sections.flatMap((s) => s.items);
}

// --- initial data and normalization ---

/** Empty data for one instance of a group (nested non-repeat groups as objects). */
export function emptyGroupData(form: FormJson, item: GroupItem): FormData {
    return normalizeItems(form, groupItems(form, item), {});
}

export function initialData(form: FormJson): FormData {
    return normalizeData(form, {});
}

/**
 * Ensures group containers exist (objects, arrays with at least minItems
 * entries) without touching existing values. Works on a copy.
 */
export function normalizeData(form: FormJson, data: FormData): FormData {
    return normalizeItems(form, rootItems(form), clone(data));
}

function normalizeItems(form: FormJson, items: Item[], scope: FormData): FormData {
    for (const item of items) {
        if (item.kind !== 'group') continue;
        const inner = groupItems(form, item);
        if (item.repeat) {
            const list = Array.isArray(scope[item.id]) ? (scope[item.id] as FormData[]) : [];
            while (list.length < (item.repeat.minItems ?? 0)) list.push({});
            scope[item.id] = list.map((entry) => normalizeItems(form, inner, isObject(entry) ? entry : {}));
        } else {
            const entry = scope[item.id];
            scope[item.id] = normalizeItems(form, inner, isObject(entry) ? entry : {});
        }
    }
    return scope;
}

/** Deep copy of JSON data; also works on reactive proxies (unlike structuredClone). */
export function clone<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isObject(value: unknown): value is FormData {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- conditions ---

export interface Scope {
    /** data object of the current group instance (or root) */
    local: FormData;
    root: FormData;
}

export function resolveRef(ref: string, scope: Scope): unknown {
    if (!ref.startsWith('/')) return scope.local[ref];
    let current: unknown = scope.root;
    for (const part of ref.slice(1).split('/')) {
        if (!isObject(current)) return undefined;
        current = current[part];
    }
    return current;
}

function matches(value: unknown, target: Scalar): boolean {
    return Array.isArray(value) ? value.includes(target) : value === target;
}

export function evaluateCondition(cond: Condition, scope: Scope): boolean {
    if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, scope));
    if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, scope));
    if ('not' in cond) return !evaluateCondition(cond.not, scope);
    const value = resolveRef(cond.field, scope);
    if ('equals' in cond) return matches(value, cond.equals);
    if ('notEquals' in cond) return !matches(value, cond.notEquals);
    if ('in' in cond) return cond.in.some((t) => matches(value, t));
    return isEmpty(value) !== cond.filled;
}

export function isVisible(item: { visibleIf?: Condition }, scope: Scope): boolean {
    return !item.visibleIf || evaluateCondition(item.visibleIf, scope);
}

export function isRequired(field: FieldItem, scope: Scope): boolean {
    return (
        field.required === true ||
        field.mustAccept === true ||
        (field.requiredIf !== undefined && evaluateCondition(field.requiredIf, scope))
    );
}

// --- validation ---

/**
 * Validates visible items only: a hidden field is never required
 * (required-if-visible), values of hidden fields are ignored.
 */
export function validateForm(form: FormJson, data: FormData): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const section of form.sections) {
        const scope = { local: data, root: data };
        if (!isVisible(section, scope)) continue;
        validateItems(form, section.items, scope, '', errors);
    }
    return errors;
}

function validateItems(form: FormJson, items: Item[], scope: Scope, base: string, errors: ValidationError[]): void {
    for (const item of items) {
        if (!isVisible(item, scope)) continue;
        const path = joinPath(base, item.id);
        if (item.kind === 'field') {
            const error = validateField(item, scope.local[item.id], scope);
            if (error) errors.push({ path, ...error });
            continue;
        }
        const inner = groupItems(form, item);
        const value = scope.local[item.id];
        if (item.repeat) {
            const list = Array.isArray(value) ? (value as FormData[]) : [];
            const { minItems = 0, maxItems } = item.repeat;
            if (list.length < minItems)
                errors.push({ path, code: 'minItems', message: `Mindestens ${minItems} Einträge erforderlich` });
            if (maxItems !== undefined && list.length > maxItems)
                errors.push({ path, code: 'maxItems', message: `Höchstens ${maxItems} Einträge erlaubt` });
            list.forEach((entry, i) =>
                validateItems(form, inner, { local: entry ?? {}, root: scope.root }, joinPath(path, i), errors),
            );
        } else {
            validateItems(form, inner, { local: isObject(value) ? value : {}, root: scope.root }, path, errors);
        }
    }
}

type FieldError = { code: string; message: string } | undefined;

export function validateField(field: FieldItem, value: unknown, scope: Scope): FieldError {
    if (isEmpty(value)) {
        return isRequired(field, scope) ? { code: 'required', message: 'Pflichtfeld' } : undefined;
    }
    const invalid = (message: string) => ({ code: 'invalid', message });
    switch (field.type) {
        case 'text':
        case 'email':
        case 'phone': {
            if (typeof value !== 'string') return invalid('Ungültiger Wert');
            if (field.type === 'email' && !EMAIL.test(value)) return invalid('Keine gültige E-Mail-Adresse');
            if (field.type === 'phone' && !PHONE.test(value)) return invalid('Keine gültige Telefonnummer');
            if (field.minLength !== undefined && value.length < field.minLength)
                return { code: 'minLength', message: `Mindestens ${field.minLength} Zeichen` };
            if (field.maxLength !== undefined && value.length > field.maxLength)
                return { code: 'maxLength', message: `Höchstens ${field.maxLength} Zeichen` };
            if (field.pattern !== undefined && !new RegExp(field.pattern).test(value))
                return { code: 'pattern', message: 'Ungültiges Format' };
            return undefined;
        }
        case 'date': {
            if (typeof value !== 'string' || !isValidDate(value)) return invalid('Kein gültiges Datum');
            if (typeof field.min === 'string' && value < field.min) return { code: 'min', message: `Frühestens ${formatDate(field.min)}` };
            if (typeof field.max === 'string' && value > field.max) return { code: 'max', message: `Spätestens ${formatDate(field.max)}` };
            return undefined;
        }
        case 'year':
        case 'integer': {
            if (typeof value !== 'number' || !Number.isInteger(value)) return invalid('Keine ganze Zahl');
            if (field.type === 'year' && (value < 1000 || value > 9999)) return invalid('Jahr bitte vierstellig angeben');
            if (typeof field.min === 'number' && value < field.min) return { code: 'min', message: `Mindestens ${field.min}` };
            if (typeof field.max === 'number' && value > field.max) return { code: 'max', message: `Höchstens ${field.max}` };
            return undefined;
        }
        case 'boolean':
            if (typeof value !== 'boolean') return invalid('Ungültiger Wert');
            if (field.mustAccept && value !== true) return { code: 'required', message: 'Bitte bestätigen' };
            return undefined;
        case 'select':
        case 'searchselect':
            if (typeof value !== 'string') return invalid('Ungültiger Wert');
            if (field.options && !field.options.some((o) => o.key === value)) return invalid('Ungültige Auswahl');
            return undefined;
        case 'multiselect': {
            if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return invalid('Ungültiger Wert');
            if (field.options && value.some((v) => !field.options!.some((o) => o.key === v)))
                return invalid('Ungültige Auswahl');
            if (field.minItems !== undefined && value.length < field.minItems)
                return { code: 'minItems', message: `Mindestens ${field.minItems} auswählen` };
            if (field.maxItems !== undefined && value.length > field.maxItems)
                return { code: 'maxItems', message: `Höchstens ${field.maxItems} auswählen` };
            return undefined;
        }
    }
}

function isValidDate(value: string): boolean {
    if (!DATE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function formatDate(value: string): string {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
}

// --- hidden values ---

/** Copy of the data without values of hidden items (e.g. before submission). */
export function withoutHidden(form: FormJson, data: FormData): FormData {
    const result: FormData = {};
    for (const section of form.sections) {
        const scope = { local: data, root: data };
        if (isVisible(section, scope)) stripItems(form, section.items, scope, result);
    }
    return result;
}

function stripItems(form: FormJson, items: Item[], scope: Scope, target: FormData): void {
    for (const item of items) {
        const value = scope.local[item.id];
        if (!isVisible(item, scope) || value === undefined) continue;
        if (item.kind === 'field') {
            target[item.id] = clone(value);
            continue;
        }
        const inner = groupItems(form, item);
        const strip = (entry: unknown): FormData => {
            const out: FormData = {};
            stripItems(form, inner, { local: isObject(entry) ? entry : {}, root: scope.root }, out);
            return out;
        };
        target[item.id] = Array.isArray(value) ? value.map(strip) : strip(value);
    }
}

// --- repeatable groups and copying ---

export function canAddRepeat(item: GroupItem, list: unknown[]): boolean {
    return item.repeat?.maxItems === undefined || list.length < item.repeat.maxItems;
}

export function canRemoveRepeat(item: GroupItem, list: unknown[]): boolean {
    return list.length > (item.repeat?.minItems ?? 0);
}

/**
 * One-time copy of a group instance into another (backlog: "einmaliges
 * Kopieren"); afterwards both are independent.
 */
export function copyGroupData(source: unknown): FormData {
    return isObject(source) ? clone(source) : {};
}
