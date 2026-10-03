// Full validation of a form definition: JSON schema plus semantic checks.
// Separate entry point (@anmeldung/forms/validate) so the public SPA does not
// bundle the schema validator.
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../schema/form.schema.json' with { type: 'json' };
import { checkFormDefinition } from './check.ts';
import type { FormJson } from './types.ts';

const validateSchema = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true }).compile(
    schema,
);

/** Returns a list of problems; empty means the definition is valid. */
export function validateFormDefinition(json: unknown): string[] {
    if (!validateSchema(json)) {
        return (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message}`);
    }
    return checkFormDefinition(json as unknown as FormJson);
}
