import type { FormJson, GroupItem } from '@anmeldung/forms';
import { validateFormDefinition } from '@anmeldung/forms/validate';
import { describe, expect, it } from 'vitest';
import {
    addField,
    addGroupDefinition,
    addGroupItem,
    addSection,
    changeFieldType,
    emptyForm,
    move,
    renameGroup,
    uniqueId,
    unusedGroups,
} from './designer.ts';

describe('form designer operations (D2)', () => {
    it('starts with a valid form', () => {
        expect(validateFormDefinition(emptyForm())).toEqual([]);
    });

    it('adds elements with unique ids across the shared scope', () => {
        const form = emptyForm();
        addSection(form);
        const i = addField(form, { type: 'section', index: 1 });
        // feld1 exists in section 1; sections share one data scope
        expect(form.sections[1].items[i].id).toBe('feld2');
        expect(uniqueId('feld1', new Set(['feld1', 'feld2']))).toBe('feld3');
        expect(validateFormDefinition(form)).toEqual([]);
    });

    it('adds group definitions and instances that validate', () => {
        const form = emptyForm();
        const name = addGroupDefinition(form);
        addGroupItem(form, { type: 'section', index: 0 });
        expect((form.sections[0].items[1] as GroupItem).group).toBe(name);
        addField(form, { type: 'group', name });
        expect(validateFormDefinition(form)).toEqual([]);
    });

    it('renames groups including references', () => {
        const form = emptyForm();
        const name = addGroupDefinition(form);
        addGroupItem(form, { type: 'section', index: 0 });
        renameGroup(form, name, 'person');
        expect(Object.keys(form.groups!)).toEqual(['person']);
        expect((form.sections[0].items[1] as GroupItem).group).toBe('person');
        expect(unusedGroups(form)).toEqual([]);
    });

    it('moves elements within bounds', () => {
        const list = ['a', 'b', 'c'];
        expect(move(list, 0, 1)).toBe(1);
        expect(list).toEqual(['b', 'a', 'c']);
        expect(move(list, 0, -1)).toBe(0);
    });

    it('drops properties that do not fit a new field type', () => {
        const form: FormJson = emptyForm();
        const field = form.sections[0].items[0];
        if (field.kind !== 'field') throw new Error();
        field.maxLength = 20;
        changeFieldType(field, 'select');
        expect(field.maxLength).toBeUndefined();
        expect(field.options).toHaveLength(1);
        expect(validateFormDefinition(form)).toEqual([]);
        changeFieldType(field, 'file');
        expect(field.options).toBeUndefined();
        expect(validateFormDefinition(form)).toEqual([]);
    });
});
