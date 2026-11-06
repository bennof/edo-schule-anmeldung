// Writes the SharePoint schema for setup-tenant.ps1 (make tenant-schema).
// A changed schema needs a new entry in SCHEMA_HISTORY (packages/sharepoint/src/schema.ts).
import fs from 'node:fs';
import { schemaExport } from '../../packages/sharepoint/src/schema.ts';

const file = new URL('sharepoint-schema.json', import.meta.url);
const next = schemaExport();
if (fs.existsSync(file)) {
    const { history: _, ...stored } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { history: __, ...current } = JSON.parse(JSON.stringify(next));
    if (stored.schemaVersion === current.schemaVersion && JSON.stringify(stored) !== JSON.stringify(current)) {
        console.error(`Schema geändert, aber Version ${current.schemaVersion} unverändert: neuen Eintrag in SCHEMA_HISTORY anlegen.`);
        process.exit(1);
    }
}
fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
console.log(`written: ${file.pathname} (version ${next.schemaVersion})`);
