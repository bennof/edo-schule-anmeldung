// Idempotent schema provisioning (backlog B2): creates missing lists and
// columns, never deletes or alters existing ones, then records schemaVersion.
import { ConfigStore } from './config.ts';
import { DEFAULT_CONFIG, LISTS, SCHEMA_VERSION, columnDefinition, type ListSpec } from './schema.ts';
import type { SharePointSite } from './site.ts';

export interface ProvisionReport {
    createdLists: string[];
    createdColumns: string[];
    createdConfig: string[];
    schemaVersion: number;
}

export async function provision(site: SharePointSite): Promise<ProvisionReport> {
    const report: ProvisionReport = { createdLists: [], createdColumns: [], createdConfig: [], schemaVersion: SCHEMA_VERSION };
    const configExists = (await site.findListId(LISTS.config.name)) !== undefined;
    if (configExists) {
        const stored = Number(await new ConfigStore(site).get('schemaVersion'));
        if (stored > SCHEMA_VERSION) {
            throw new Error(`Site has schema version ${stored}, this app only knows ${SCHEMA_VERSION}`);
        }
    }

    for (const spec of Object.values(LISTS) as ListSpec[]) {
        const listId = await site.findListId(spec.name);
        if (listId) {
            await addMissingColumns(site, listId, spec, report);
        } else {
            await createList(site, spec);
            report.createdLists.push(spec.name);
        }
    }

    const config = new ConfigStore(site);
    const existing = new Set((await config.all()).map((e) => e.key));
    for (const entry of DEFAULT_CONFIG) {
        if (existing.has(entry.key)) continue;
        await config.set(entry.key, entry.value, entry.isPublic);
        report.createdConfig.push(entry.key);
    }
    await config.set('schemaVersion', String(SCHEMA_VERSION), false);
    return report;
}

async function createList(site: SharePointSite, spec: ListSpec): Promise<void> {
    const custom = spec.columns.filter((c) => c.name !== 'Title');
    const created = await site.graph.json<{ id: string }>('POST', `/sites/${site.siteId}/lists`, {
        body: {
            displayName: spec.name,
            columns: custom.map(columnDefinition),
            list: { template: spec.template },
        },
    });
    site.rememberListId(spec.name, created.id);
    await indexTitleIfNeeded(site, created.id, spec);
}

async function addMissingColumns(
    site: SharePointSite,
    listId: string,
    spec: ListSpec,
    report: ProvisionReport,
): Promise<void> {
    const existing = await site.graph.collect<{ name: string }>(
        `/sites/${site.siteId}/lists/${listId}/columns?$select=name`,
    );
    const names = new Set(existing.map((c) => c.name));
    for (const col of spec.columns) {
        if (names.has(col.name)) continue;
        await site.graph.json('POST', `/sites/${site.siteId}/lists/${listId}/columns`, {
            body: columnDefinition(col),
        });
        report.createdColumns.push(`${spec.name}.${col.name}`);
    }
    await indexTitleIfNeeded(site, listId, spec);
}

/** The built-in Title column cannot be created, only indexed afterwards. */
async function indexTitleIfNeeded(site: SharePointSite, listId: string, spec: ListSpec): Promise<void> {
    const title = spec.columns.find((c) => c.name === 'Title');
    if (!title?.indexed) return;
    const cols = await site.graph.collect<{ id: string; name: string; indexed: boolean }>(
        `/sites/${site.siteId}/lists/${listId}/columns?$select=id,name,indexed`,
    );
    const col = cols.find((c) => c.name === 'Title');
    if (col && !col.indexed) {
        await site.graph.json('PATCH', `/sites/${site.siteId}/lists/${listId}/columns/${col.id}`, {
            body: { indexed: true },
        });
    }
}
