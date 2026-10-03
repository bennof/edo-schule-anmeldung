// Prints the number of items per list (quick check for leftover test data).
// Usage: node scripts/count-items.ts
import { GraphClient, LISTS, SharePointSite, type ListKey } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
for (const key of Object.keys(LISTS) as ListKey[]) {
    if (key === 'assets') continue;
    console.log(`${LISTS[key].name}: ${(await site.listItems(key)).length}`);
}
