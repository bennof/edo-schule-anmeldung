// Pure editing operations of the form designer (backlog D2). The designer
// edits a FormJson in place; saving always creates a new version (D3).
import type { FieldItem, FieldType, FormJson, GroupItem, Item, Section } from '@anmeldung/forms';

/** Where a list of items lives: in a section or in a group definition. */
export type Container = { type: 'section'; index: number } | { type: 'group'; name: string };

export function emptyForm(title = 'Neues Formular'): FormJson {
    return {
        formatVersion: 1,
        title,
        sections: [{ id: 'abschnitt1', title: 'Abschnitt 1', items: [newField('feld1')] }],
    };
}

export function itemsOf(form: FormJson, c: Container): Item[] {
    if (c.type === 'section') return form.sections[c.index].items;
    return form.groups![c.name].items;
}

/** Ids sharing one data scope: all sections together, or one group definition. */
export function scopeIds(form: FormJson, c: Container): Set<string> {
    const items = c.type === 'section' ? form.sections.flatMap((s) => s.items) : itemsOf(form, c);
    return new Set(items.map((i) => i.id));
}

export function uniqueId(base: string, taken: Set<string>): string {
    const stem = base.replace(/\d+$/, '') || 'feld';
    for (let n = 1; ; n++) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
}

export function newField(id: string, type: FieldType = 'text'): FieldItem {
    return { kind: 'field', id, type, label: 'Neues Feld' };
}

export function addField(form: FormJson, c: Container): number {
    const items = itemsOf(form, c);
    items.push(newField(uniqueId('feld1', scopeIds(form, c))));
    return items.length - 1;
}

/** Adds an instance of a group definition; creates a definition if none exists. */
export function addGroupItem(form: FormJson, c: Container): number {
    form.groups ??= {};
    let name = Object.keys(form.groups).find((g) => !(c.type === 'group' && g === c.name));
    if (!name) name = addGroupDefinition(form);
    const items = itemsOf(form, c);
    const item: GroupItem = { kind: 'group', id: uniqueId(`${name}1`, scopeIds(form, c)), group: name, label: 'Neue Gruppe' };
    items.push(item);
    return items.length - 1;
}

export function addGroupDefinition(form: FormJson): string {
    form.groups ??= {};
    const name = uniqueId('gruppe1', new Set(Object.keys(form.groups)));
    form.groups[name] = { items: [newField('feld1')] };
    return name;
}

export function addSection(form: FormJson): number {
    const id = uniqueId('abschnitt1', new Set(form.sections.map((s) => s.id)));
    form.sections.push({ id, title: `Abschnitt ${form.sections.length + 1}`, items: [] } satisfies Section);
    return form.sections.length - 1;
}

/** Moves an element one position; returns its new index. */
export function move<T>(list: T[], index: number, delta: -1 | 1): number {
    const target = index + delta;
    if (target < 0 || target >= list.length) return index;
    [list[index], list[target]] = [list[target], list[index]];
    return target;
}

export function remove<T>(list: T[], index: number): void {
    list.splice(index, 1);
}

/** Renames a group definition and all instances referring to it. */
export function renameGroup(form: FormJson, from: string, to: string): void {
    if (!form.groups?.[from] || from === to || form.groups[to]) return;
    form.groups[to] = form.groups[from];
    delete form.groups[from];
    const all = [...form.sections.flatMap((s) => s.items), ...Object.values(form.groups).flatMap((g) => g.items)];
    for (const item of all) if (item.kind === 'group' && item.group === from) item.group = to;
}

/** Group definitions not used by any instance. */
export function unusedGroups(form: FormJson): string[] {
    const all = [...form.sections.flatMap((s) => s.items), ...Object.values(form.groups ?? {}).flatMap((g) => g.items)];
    const used = new Set(all.filter((i): i is GroupItem => i.kind === 'group').map((i) => i.group));
    return Object.keys(form.groups ?? {}).filter((g) => !used.has(g));
}

/** Properties that do not fit a field type are removed when the type changes. */
export function changeFieldType(field: FieldItem, type: FieldType): void {
    field.type = type;
    const keep: Record<string, FieldType[]> = {
        minLength: ['text', 'email', 'phone'],
        maxLength: ['text', 'email', 'phone'],
        pattern: ['text', 'email', 'phone'],
        min: ['date', 'year', 'integer'],
        max: ['date', 'year', 'integer'],
        options: ['select', 'multiselect', 'searchselect'],
        optionsSource: ['select', 'multiselect', 'searchselect'],
        minItems: ['multiselect'],
        maxItems: ['multiselect'],
        mustAccept: ['boolean'],
        accept: ['file'],
        multiple: ['file'],
        maxFiles: ['file'],
        role: ['file'],
    };
    const props = field as unknown as Record<string, unknown>;
    for (const [prop, types] of Object.entries(keep)) if (!types.includes(type)) delete props[prop];
    if (['select', 'multiselect', 'searchselect'].includes(type) && !field.options && !field.optionsSource) {
        field.options = [{ key: 'option1', value: 'Option 1' }];
    }
    if (type === 'date' || type === 'year' || type === 'integer') {
        delete props.min;
        delete props.max;
    }
}
