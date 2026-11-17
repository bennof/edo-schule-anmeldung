import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFormDefinition } from '../src/check.ts';
import { pdfTargets } from '../src/pdf-targets.ts';
import type { FormJson } from '../src/types.ts';
import { validateFormDefinition } from '../src/validate-definition.ts';
const dir = path.dirname(fileURLToPath(import.meta.url));

function load(sub: string): [string, unknown][] {
    const d = path.join(dir, sub);
    return fs.readdirSync(d).map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]);
}

describe('valid definitions', () => {
    it.each([...load('valid'), ...load('../examples').filter(([name]) => !name.includes('.mergefields.'))])('%s passes schema and semantic checks', (_name, form) => {
        expect(validateFormDefinition(form)).toEqual([]);
    });
});

describe('schema-invalid definitions', () => {
    it.each(load('invalid/schema'))('%s is rejected by the schema', (_name, form) => {
        const errors = validateFormDefinition(form);
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('semantically invalid definitions', () => {
    it.each(load('invalid/semantic'))('%s passes the schema but fails semantic checks', (_name, form) => {
        // schema passes, so all reported problems come from the semantic checks
        expect(validateFormDefinition(form)).toEqual(checkFormDefinition(form as FormJson));
        expect(checkFormDefinition(form as FormJson)).not.toEqual([]);
    });
});

describe('PDF assignment of a form', () => {
    function minimalForm(): FormJson {
        return {
            formatVersion: 1 as const,
            title: 'T',
            groups: { person: { items: [{ kind: 'field', id: 'name', type: 'text', label: 'Name' }] } },
            sections: [
                {
                    id: 's',
                    title: 'S',
                    items: [
                        { kind: 'field', id: 'sex', type: 'select', label: 'Geschlecht', options: [{ key: 'w', value: 'weiblich' }, { key: 'm', value: 'männlich' }] },
                        { kind: 'field', id: 'bus', type: 'boolean', label: 'Bus' },
                        { kind: 'group', id: 'eltern', group: 'person', label: 'Eltern', repeat: { maxItems: 2 } },
                    ],
                },
            ],
        };
    }
    const base = minimalForm();
    const withPdf = (fields: Record<string, string>): FormJson => ({ ...base, pdf: { asset: 'form.pdf', fields } });

    it('accepts valid targets and rejects wrong ones', () => {
        expect(validateFormDefinition(withPdf({ A: 'sex', B: 'sex=w', C: 'bus=true', D: 'eltern[1].name', E: 'anmeldung.termin' }))).toEqual([]);
        expect(validateFormDefinition(withPdf({ A: 'unbekannt' })).join()).toMatch(/unknown data path/);
        expect(validateFormDefinition(withPdf({ A: 'sex=x' })).join()).toMatch(/not an option/);
        expect(validateFormDefinition(withPdf({ A: 'bus=ja' })).join()).toMatch(/=true or =false/);
        expect(validateFormDefinition({ ...base, pdf: { asset: '../x', fields: {} } }).length).toBeGreaterThan(0);
    });

    it('lists the targets for the selection', () => {
        const targets = pdfTargets(base).map((t) => t.target);
        expect(targets).toEqual(expect.arrayContaining(['sex', 'sex=w', 'sex=m', 'bus', 'bus=true', 'bus=false', 'eltern[0].name', 'eltern[1].name', 'anmeldung.termin']));
        expect(targets).not.toContain('eltern[2].name');
        expect(pdfTargets(base).find((t) => t.target === 'eltern[1].name')?.label).toBe('Eltern 2 › Name');
    });
});
