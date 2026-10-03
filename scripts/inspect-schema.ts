// Prints the provisioned lists with their custom columns and index flags.
// Usage: node scripts/inspect-schema.ts
import { GraphClient, LISTS, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);

for (const spec of Object.values(LISTS)) {
    const id = await site.findListId(spec.name);
    if (!id) {
        console.log(`${spec.name}: missing`);
        continue;
    }
    const cols = await site.graph.collect<{ name: string; indexed: boolean; text?: { allowMultipleLines?: boolean } }>(
        `/sites/${site.siteId}/lists/${id}/columns`,
    );
    const wanted = new Set<string>(spec.columns.map((c) => c.name));
    const shown = cols
        .filter((c) => wanted.has(c.name))
        .map((c) => `${c.name}${c.indexed ? '*' : ''}${c.text?.allowMultipleLines ? '(note)' : ''}`);
    console.log(`${spec.name}: ${shown.join(', ') || '(library)'}`);
}
