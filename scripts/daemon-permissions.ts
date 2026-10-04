// Manages the SharePoint permissions of the public daemon (backlog F1).
//
// Target: the daemon only gets list-level grants instead of site-wide write.
//   node scripts/daemon-permissions.ts show         current site and list grants
//   node scripts/daemon-permissions.ts grant        add list grants (safe, idempotent)
//   node scripts/daemon-permissions.ts revoke-site  remove the site-wide grant
//   node scripts/daemon-permissions.ts restore-site re-add site-wide write (rollback)
//
// List grants only take effect once the daemon app registration has the
// application permission Lists.SelectedOperations.Selected (admin consent in
// Entra). Run revoke-site only after that, then `pnpm test:integration`.
// Uses the app identity, which has fullcontrol on the site.
import { GraphClient, LISTS, SharePointSite, type ListKey } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';

/** Minimal grants: read public data, write appointments, applications and uploads. */
const LIST_ROLES: Record<Exclude<ListKey, never>, 'read' | 'write'> = {
    config: 'read',
    assets: 'read',
    forms: 'read',
    procedures: 'read',
    appointments: 'write',
    applications: 'write',
    uploads: 'write',
};

interface Permission {
    id: string;
    roles: string[];
    grantedToIdentitiesV2?: { application?: { id: string; displayName?: string } }[];
    grantedToV2?: { application?: { id: string; displayName?: string } };
}

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const graph = site.graph;
const daemon = { id: env.DAEMON_CLIENT_ID, displayName: env.DAEMON_NAME || 'Public Daemon' };

const appIds = (p: Permission) =>
    [...(p.grantedToIdentitiesV2 ?? []).map((g) => g.application?.id), p.grantedToV2?.application?.id].filter(Boolean);
const forDaemon = (perms: Permission[]) => perms.filter((p) => appIds(p).includes(daemon.id));

async function sitePermissions(): Promise<Permission[]> {
    return graph.collect<Permission>(`/sites/${site.siteId}/permissions`);
}

async function listPermissions(listId: string): Promise<Permission[]> {
    return graph.collect<Permission>(`/sites/${site.siteId}/lists/${listId}/permissions`);
}

async function show(): Promise<void> {
    const siteGrants = forDaemon(await sitePermissions());
    console.log(`site: ${siteGrants.map((p) => p.roles.join('+')).join(', ') || '-'}`);
    for (const key of Object.keys(LIST_ROLES) as ListKey[]) {
        const grants = forDaemon(await listPermissions(await site.listId(key)));
        console.log(`${LISTS[key].name}: ${grants.map((p) => p.roles.join('+')).join(', ') || '-'} (target ${LIST_ROLES[key]})`);
    }
}

async function grant(): Promise<void> {
    for (const key of Object.keys(LIST_ROLES) as ListKey[]) {
        const listId = await site.listId(key);
        const existing = forDaemon(await listPermissions(listId));
        const role = LIST_ROLES[key];
        if (existing.some((p) => p.roles.length === 1 && p.roles[0] === role)) {
            console.log(`${LISTS[key].name}: ${role} already granted`);
            continue;
        }
        for (const p of existing) await graph.request('DELETE', `/sites/${site.siteId}/lists/${listId}/permissions/${p.id}`);
        await graph.json('POST', `/sites/${site.siteId}/lists/${listId}/permissions`, {
            body: { roles: [role], grantedTo: { application: daemon } },
        });
        console.log(`${LISTS[key].name}: granted ${role}`);
    }
}

async function revokeSite(): Promise<void> {
    const grants = forDaemon(await sitePermissions());
    for (const p of grants) await graph.request('DELETE', `/sites/${site.siteId}/permissions/${p.id}`);
    console.log(`removed ${grants.length} site-wide grant(s)`);
}

async function restoreSite(): Promise<void> {
    if (forDaemon(await sitePermissions()).length) return console.log('site grant exists');
    await graph.json('POST', `/sites/${site.siteId}/permissions`, {
        body: { roles: ['write'], grantedToIdentities: [{ application: daemon }] },
    });
    console.log('site-wide write restored');
}

const commands: Record<string, () => Promise<void>> = { show, grant, 'revoke-site': revokeSite, 'restore-site': restoreSite };
const command = commands[process.argv[2] ?? 'show'];
if (!command) {
    console.log(`usage: node scripts/daemon-permissions.ts ${Object.keys(commands).join('|')}`);
    process.exit(2);
}
await command();
