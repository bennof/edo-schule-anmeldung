import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_HISTORY, SCHEMA_VERSION, schemaExport } from './schema.ts';

describe('schema', () => {
    it('history numbers versions 1, 2, 3, … with date and description', () => {
        SCHEMA_HISTORY.forEach((entry, i) => {
            expect(entry.version).toBe(i + 1);
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(entry.changes.trim()).not.toBe('');
        });
        expect(SCHEMA_VERSION).toBe(SCHEMA_HISTORY.length);
    });

    it('matches scripts/tenant/sharepoint-schema.json (make tenant-schema)', () => {
        const file = new URL('../../../scripts/tenant/sharepoint-schema.json', import.meta.url);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(schemaExport())));
    });
});
