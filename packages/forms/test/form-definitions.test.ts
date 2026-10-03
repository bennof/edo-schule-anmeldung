import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFormDefinition } from '../src/check.ts';
import type { FormJson } from '../src/types.ts';
import { validateFormDefinition } from '../src/validate-definition.ts';
const dir = path.dirname(new URL(import.meta.url).pathname);

function load(sub: string): [string, unknown][] {
    const d = path.join(dir, sub);
    return fs.readdirSync(d).map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]);
}

describe('valid definitions', () => {
    it.each([...load('valid'), ...load('../examples')])('%s passes schema and semantic checks', (_name, form) => {
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
