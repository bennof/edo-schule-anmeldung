// Semantic checks that JSON Schema cannot express: unique ids, group
// references, copy sources and condition targets. Run after schema validation.
import type { Condition, FormJson, Item } from './types.ts';

export function checkFormDefinition(form: FormJson): string[] {
    const errors: string[] = [];
    const groups = form.groups ?? {};

    // group cycles
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, path: string[]): void => {
        if (done.has(name) || !groups[name]) return;
        if (visiting.has(name)) {
            errors.push(`group cycle: ${[...path, name].join(' -> ')}`);
            return;
        }
        visiting.add(name);
        for (const item of groups[name].items) if (item.kind === 'group') visit(item.group, [...path, name]);
        visiting.delete(name);
        done.add(name);
    };
    for (const name of Object.keys(groups)) visit(name, []);
    if (errors.length) return errors;

    const sectionIds = new Set<string>();
    for (const s of form.sections) {
        if (sectionIds.has(s.id)) errors.push(`duplicate section id "${s.id}"`);
        sectionIds.add(s.id);
    }

    // all section items share the root data scope
    const rootItems = form.sections.flatMap((s) => s.items);
    const resolve = (ref: string, scope: Item[]): Item | undefined => {
        if (!ref.startsWith('/')) return scope.find((i) => i.id === ref);
        let items: Item[] | undefined = rootItems;
        let found: Item | undefined;
        for (const part of ref.slice(1).split('/')) {
            found = items?.find((i) => i.id === part);
            if (!found) return undefined;
            // absolute paths must not step into repeatable groups (ambiguous)
            items = found.kind === 'group' && !found.repeat ? groups[found.group]?.items : undefined;
        }
        return found;
    };

    const checkCondition = (cond: Condition | undefined, scope: Item[], where: string): void => {
        if (!cond) return;
        if ('all' in cond) return cond.all.forEach((c) => checkCondition(c, scope, where));
        if ('any' in cond) return cond.any.forEach((c) => checkCondition(c, scope, where));
        if ('not' in cond) return checkCondition(cond.not, scope, where);
        const target = resolve(cond.field, scope);
        if (!target) errors.push(`${where}: condition references unknown field "${cond.field}"`);
        else if (target.kind !== 'field') errors.push(`${where}: condition references group "${cond.field}"`);
    };

    const checkScope = (items: Item[], where: string): void => {
        const ids = new Set<string>();
        for (const item of items) {
            const at = `${where}/${item.id}`;
            if (ids.has(item.id)) errors.push(`${at}: duplicate id`);
            ids.add(item.id);
            checkCondition(item.visibleIf, items, at);

            if (item.kind === 'field') {
                checkCondition(item.requiredIf, items, at);
                if (item.required && item.requiredIf) errors.push(`${at}: both required and requiredIf`);
                if (item.mustAccept && (item.required || item.requiredIf)) errors.push(`${at}: mustAccept implies required`);
                if (item.minLength !== undefined && item.maxLength !== undefined && item.minLength > item.maxLength)
                    errors.push(`${at}: minLength > maxLength`);
                if (item.minItems !== undefined && item.maxItems !== undefined && item.minItems > item.maxItems)
                    errors.push(`${at}: minItems > maxItems`);
                if (item.min !== undefined && item.max !== undefined && item.min > item.max)
                    errors.push(`${at}: min > max`);
                if (item.pattern !== undefined) {
                    try {
                        new RegExp(item.pattern);
                    } catch {
                        errors.push(`${at}: invalid pattern`);
                    }
                }
                if (item.options) {
                    const keys = item.options.map((o) => o.key);
                    if (new Set(keys).size !== keys.length) errors.push(`${at}: duplicate option keys`);
                }
                continue;
            }

            if (!groups[item.group]) {
                errors.push(`${at}: unknown group "${item.group}"`);
                continue;
            }
            const r = item.repeat;
            if (r?.minItems !== undefined && r.maxItems !== undefined && r.minItems > r.maxItems)
                errors.push(`${at}: repeat.minItems > repeat.maxItems`);
            for (const source of item.copyFrom ?? []) {
                const other = items.find((i) => i.id === source);
                if (source === item.id) errors.push(`${at}: copyFrom references itself`);
                else if (!other || other.kind !== 'group' || other.group !== item.group)
                    errors.push(`${at}: copyFrom "${source}" is not an instance of group "${item.group}"`);
            }
        }
    };

    for (const s of form.sections) checkCondition(s.visibleIf, rootItems, `/${s.id}`);
    checkScope(rootItems, '');
    for (const [name, def] of Object.entries(groups)) checkScope(def.items, `group:${name}`);
    return errors;
}
