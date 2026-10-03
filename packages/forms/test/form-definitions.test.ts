import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import schema from '../schema/form.schema.json' with { type: 'json' };
import { checkFormDefinition } from '../src/check.ts';
import type { FormJson } from '../src/types.ts';

const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true }).compile(schema);
const dir = path.dirname(new URL(import.meta.url).pathname);

function load(sub: string): [string, unknown][] {
    const d = path.join(dir, sub);
    return fs.readdirSync(d).map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]);
}

describe('valid definitions', () => {
    it.each(load('valid'))('%s passes schema and semantic checks', (_name, form) => {
        expect(validate(form), JSON.stringify(validate.errors, null, 1)).toBe(true);
        expect(checkFormDefinition(form as FormJson)).toEqual([]);
    });
});

describe('schema-invalid definitions', () => {
    it.each(load('invalid/schema'))('%s is rejected by the schema', (_name, form) => {
        expect(validate(form)).toBe(false);
    });
});

describe('semantically invalid definitions', () => {
    it.each(load('invalid/semantic'))('%s passes the schema but fails semantic checks', (_name, form) => {
        expect(validate(form), JSON.stringify(validate.errors, null, 1)).toBe(true);
        expect(checkFormDefinition(form as FormJson)).not.toEqual([]);
    });
});
