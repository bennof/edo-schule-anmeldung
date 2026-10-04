import { describe, expect, it } from 'vitest';
import full from './valid/full.json' with { type: 'json' };
import files from './valid/files.json' with { type: 'json' };
import {
    fileRefs,
    canAddRepeat,
    canRemoveRepeat,
    copyGroupData,
    evaluateCondition,
    initialData,
    normalizeData,
    validateField,
    validateForm,
    withoutHidden,
    type FormData,
} from '../src/runtime.ts';
import type { FieldItem, FormJson, GroupItem } from '../src/types.ts';

const form = full as FormJson;
const paths = (data: FormData) => validateForm(form, data).map((e) => `${e.path}:${e.code}`);

function validData(): FormData {
    const data = initialData(form);
    Object.assign(data, { nachname: 'Muster', geburtsdatum: '2015-04-01', zweiterSorgeberechtigter: false });
    Object.assign(data.adresse as FormData, { strasse: 'Weg 1', plz: '12345', ort: 'Stadt' });
    Object.assign(data.sorgeberechtigter1 as FormData, { nachname: 'Muster', vorname: 'Eva' });
    return data;
}

describe('initial data', () => {
    it('creates group objects and minItems repeat entries', () => {
        const data = initialData(form);
        expect(data.sorgeberechtigter1).toEqual({ adresse: {} });
        expect(data.schulen).toEqual([{}]);
    });

    it('normalizes stored data without losing values', () => {
        const data = normalizeData(form, { nachname: 'A', schulen: [{ von: 2020 }, { von: 2022 }] });
        expect(data.nachname).toBe('A');
        expect(data.schulen).toEqual([{ von: 2020 }, { von: 2022 }]);
        expect(data.sorgeberechtigter2).toEqual({ adresse: {} });
    });
});

describe('conditions', () => {
    const scope = (local: FormData, root: FormData = local) => ({ local, root });

    it('evaluates operators', () => {
        const s = scope({ a: 'x', b: ['en', 'fr'], c: '' });
        expect(evaluateCondition({ field: 'a', equals: 'x' }, s)).toBe(true);
        expect(evaluateCondition({ field: 'a', notEquals: 'x' }, s)).toBe(false);
        expect(evaluateCondition({ field: 'a', in: ['y', 'x'] }, s)).toBe(true);
        expect(evaluateCondition({ field: 'b', equals: 'fr' }, s)).toBe(true);
        expect(evaluateCondition({ field: 'c', filled: false }, s)).toBe(true);
        expect(evaluateCondition({ all: [{ field: 'a', equals: 'x' }, { not: { field: 'c', filled: true } }] }, s)).toBe(true);
        expect(evaluateCondition({ any: [{ field: 'a', equals: 'y' }, { field: 'missing', filled: true }] }, s)).toBe(false);
    });

    it('resolves absolute paths from the root', () => {
        const root = { p: { name: 'Eva' } };
        expect(evaluateCondition({ field: '/p/name', equals: 'Eva' }, scope({}, root))).toBe(true);
        expect(evaluateCondition({ field: '/p/missing/x', filled: true }, scope({}, root))).toBe(false);
    });
});

describe('validation', () => {
    it('accepts complete data', () => {
        expect(paths(validData())).toEqual([]);
    });

    it('reports required fields in groups and repeat entries', () => {
        expect(paths(initialData(form))).toEqual([
            'nachname:required',
            'geburtsdatum:required',
            'adresse.strasse:required',
            'adresse.plz:required',
            'adresse.ort:required',
            'sorgeberechtigter1.nachname:required',
            'sorgeberechtigter1.vorname:required',
        ]);
    });

    it('requires fields only while visible (required-if-visible)', () => {
        const data = validData();
        // nested address of guardian 1 is hidden -> not required
        expect(paths(data)).toEqual([]);
        (data.sorgeberechtigter1 as FormData).andereAdresse = true;
        expect(paths(data)).toContain('sorgeberechtigter1.adresse.strasse:required');

        // guardian 2 becomes visible -> its required fields apply
        data.zweiterSorgeberechtigter = true;
        expect(paths(data)).toContain('sorgeberechtigter2.nachname:required');
    });

    it('applies requiredIf with conditions across scopes', () => {
        const data = validData();
        data.foerderbedarf = 'ja';
        expect(paths(data)).toEqual(['foerderschwerpunkt:required']);
        data.foerderschwerpunkt = 'Lernen';
        expect(paths(data)).toEqual([]);
    });

    it('ignores invalid values of hidden fields', () => {
        const data = validData();
        data.foerderschwerpunkt = 42; // hidden while foerderbedarf != ja
        expect(paths(data)).toEqual([]);
    });

    it('validates repeat entries individually and enforces min/max', () => {
        const data = validData();
        data.schulen = [{ von: 2020 }, { von: 1999 }];
        expect(paths(data)).toEqual(['schulen[1].von:min']);
        data.schulen = [];
        expect(paths(data)).toEqual(['schulen:minItems']);
        data.schulen = Array.from({ length: 7 }, () => ({}));
        expect(paths(data)).toEqual(['schulen:maxItems']);
    });

    it('checks field types', () => {
        const s = { local: {}, root: {} };
        const f = (field: Partial<FieldItem>) => ({ kind: 'field', id: 'x', label: 'X', ...field }) as FieldItem;
        expect(validateField(f({ type: 'email' }), 'a@b', s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'email' }), 'a@b.de', s)).toBeUndefined();
        expect(validateField(f({ type: 'phone' }), '0221 12345', s)).toBeUndefined();
        expect(validateField(f({ type: 'phone' }), 'abc', s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'date' }), '2015-02-30', s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'date', max: '2020-01-01' }), '2021-01-01', s)?.code).toBe('max');
        expect(validateField(f({ type: 'year' }), 99, s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'integer' }), 1.5, s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'boolean', required: true }), false, s)).toBeUndefined();
        expect(validateField(f({ type: 'boolean', mustAccept: true }), false, s)?.code).toBe('required');
        expect(validateField(f({ type: 'boolean', mustAccept: true }), undefined, s)?.code).toBe('required');
        expect(validateField(f({ type: 'boolean', mustAccept: true }), true, s)).toBeUndefined();
        expect(validateField(f({ type: 'text', maxLength: 3 }), 'abcd', s)?.code).toBe('maxLength');
        const options = [
            { key: 'a', value: 'A' },
            { key: 'b', value: 'B' },
        ];
        expect(validateField(f({ type: 'select', options }), 'c', s)?.code).toBe('invalid');
        expect(validateField(f({ type: 'multiselect', options, maxItems: 1 }), ['a', 'b'], s)?.code).toBe('maxItems');
        expect(validateField(f({ type: 'multiselect', required: true, options }), [], s)?.code).toBe('required');
    });
});

describe('hidden values', () => {
    it('removes values of hidden items', () => {
        const data = validData();
        data.foerderschwerpunkt = 'alt';
        (data.sorgeberechtigter2 as FormData).nachname = 'Alt';
        const clean = withoutHidden(form, data);
        expect(clean.foerderschwerpunkt).toBeUndefined();
        expect(clean.sorgeberechtigter2).toBeUndefined();
        expect(clean.nachname).toBe('Muster');
        expect((clean.sorgeberechtigter1 as FormData).adresse).toBeUndefined();
    });
});

describe('repeat groups and copy', () => {
    const schulen = form.sections[2].items[0] as GroupItem;

    it('respects repeat limits', () => {
        expect(canRemoveRepeat(schulen, [{}])).toBe(false);
        expect(canRemoveRepeat(schulen, [{}, {}])).toBe(true);
        expect(canAddRepeat(schulen, Array(6).fill({}))).toBe(false);
        expect(canAddRepeat(schulen, Array(5).fill({}))).toBe(true);
    });

    it('copies a group once, without linking both instances', () => {
        const data = validData();
        (data.sorgeberechtigter1 as FormData).adresse = { ort: 'Köln' };
        data.sorgeberechtigter2 = copyGroupData(data.sorgeberechtigter1);
        expect(data.sorgeberechtigter2).toEqual(data.sorgeberechtigter1);

        ((data.sorgeberechtigter2 as FormData).adresse as FormData).ort = 'Bonn';
        expect(((data.sorgeberechtigter1 as FormData).adresse as FormData).ort).toBe('Köln');
    });
});

describe('file fields', () => {
    const form = files as FormJson;
    const ref = (name: string, contentType = 'image/jpeg') => ({ id: `7/${name}`, name, contentType, size: 1000 });

    it('validates references, types and limits', () => {
        const ok = { passfoto: ref('a.jpg'), zeugnis: ref('z.pdf', 'application/pdf'), weitere: [ref('1.png', 'image/png')] };
        expect(validateForm(form, ok)).toEqual([]);
        expect(validateForm(form, {}).map((e) => `${e.path}:${e.code}`)).toEqual(['zeugnis:required']);
        expect(validateForm(form, { ...ok, passfoto: ref('a.pdf', 'application/pdf') }).map((e) => e.path)).toEqual(['passfoto']);
        expect(validateForm(form, { ...ok, weitere: [ref('1'), ref('2'), ref('3'), ref('4')] }).map((e) => e.code)).toEqual(['maxItems']);
        expect(validateForm(form, { ...ok, zeugnis: 'z.pdf' }).map((e) => e.code)).toEqual(['invalid']);
    });

    it('finds file references and the photo', () => {
        const data = { passfoto: ref('a.jpg'), zeugnis: ref('z.pdf', 'application/pdf'), weitere: [ref('1.png', 'image/png')] };
        expect(fileRefs(form, data).map((r) => r.name)).toEqual(['a.jpg', 'z.pdf', '1.png']);
        expect(fileRefs(form, data, 'photo').map((r) => r.name)).toEqual(['a.jpg']);
    });
});
