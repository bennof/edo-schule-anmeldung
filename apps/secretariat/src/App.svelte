<script lang="ts">
    import type { ConfigEntry } from '@anmeldung/domain';
    import {
        ConfigStore,
        GraphClient,
        GraphError,
        LISTS,
        SCHEMA_VERSION,
        SharePointSite,
        provision,
    } from '@anmeldung/sharepoint';
    import type { AccountInfo } from '@azure/msal-browser';
    import { getToken, initAuth, login, logout } from './auth.ts';
    import { clientConfig } from './config.ts';

    type Status = 'loading' | 'signedOut' | 'denied' | 'ready' | 'error';

    let status: Status = $state('loading');
    let account: AccountInfo | null = $state(null);
    let message = $state('');
    let schemaVersion: string | undefined = $state();
    let entries: ConfigEntry[] = $state([]);
    let busy = $state(false);

    const site = new SharePointSite(new GraphClient(getToken), clientConfig.siteId);
    const config = new ConfigStore(site);

    async function start(): Promise<void> {
        try {
            account = await initAuth();
            if (!account) {
                status = 'signedOut';
                return;
            }
            // authorization = the user's access to the site
            await site.graph.json('GET', `/sites/${clientConfig.siteId}?$select=id`);
            status = 'ready';
            await loadConfig();
        } catch (e) {
            if (e instanceof GraphError && (e.status === 401 || e.status === 403 || e.status === 404)) {
                status = 'denied';
            } else {
                status = 'error';
                message = String(e);
            }
        }
    }

    async function loadConfig(): Promise<void> {
        if (!(await site.findListId(LISTS.config.name))) {
            schemaVersion = undefined;
            entries = [];
            return;
        }
        entries = await config.all();
        schemaVersion = entries.find((e) => e.key === 'schemaVersion')?.value;
    }

    async function runProvisioning(): Promise<void> {
        busy = true;
        message = '';
        try {
            const report = await provision(site);
            message = `Fertig. Neue Listen: ${report.createdLists.join(', ') || 'keine'}; neue Spalten: ${report.createdColumns.join(', ') || 'keine'}.`;
            await loadConfig();
        } catch (e) {
            message = `Fehler: ${e}`;
        } finally {
            busy = false;
        }
    }

    async function saveEntry(entry: ConfigEntry): Promise<void> {
        busy = true;
        try {
            await config.set(entry.key, entry.value, entry.isPublic);
            await loadConfig();
        } catch (e) {
            message = `Fehler: ${e}`;
        } finally {
            busy = false;
        }
    }

    let newKey = $state('');

    start();
</script>

<main>
    <h1>Sekretariat</h1>

    {#if status === 'loading'}
        <p>Wird geladen …</p>
    {:else if status === 'signedOut'}
        <p>Bitte mit dem Microsoft-365-Konto der Schule anmelden.</p>
        <button onclick={login}>Anmelden</button>
    {:else if status === 'denied'}
        <p>Das Konto <strong>{account?.username}</strong> hat keinen Zugriff auf die SharePoint-Site des Anmeldesystems.</p>
        <button onclick={logout}>Abmelden</button>
    {:else if status === 'error'}
        <p class="error">{message}</p>
    {:else}
        <header>
            <span>Angemeldet als <strong>{account?.name ?? account?.username}</strong></span>
            <button onclick={logout}>Abmelden</button>
        </header>

        <section>
            <h2>SharePoint</h2>
            <p>
                Site: <a href={clientConfig.siteUrl} target="_blank" rel="noreferrer">{clientConfig.siteUrl}</a><br />
                Schema: {schemaVersion ? `Version ${schemaVersion}` : 'nicht initialisiert'} (App erwartet Version {SCHEMA_VERSION})
            </p>
            <button onclick={runProvisioning} disabled={busy}>
                {schemaVersion ? 'Schema prüfen und ergänzen' : 'Site initialisieren'}
            </button>
            {#if message}<p>{message}</p>{/if}
        </section>

        {#if schemaVersion}
            <section>
                <h2>Konfiguration</h2>
                <p class="muted">Keine Geheimnisse eintragen – öffentliche Einträge sind für jeden sichtbar.</p>
                <table>
                    <thead><tr><th>Schlüssel</th><th>Wert</th><th>Öffentlich</th><th></th></tr></thead>
                    <tbody>
                        {#each entries as entry (entry.key)}
                            <tr>
                                <td>{entry.key}</td>
                                <td><input bind:value={entry.value} disabled={entry.key === 'schemaVersion'} /></td>
                                <td><input type="checkbox" bind:checked={entry.isPublic} disabled={entry.key === 'schemaVersion'} /></td>
                                <td>
                                    {#if entry.key !== 'schemaVersion'}
                                        <button onclick={() => saveEntry(entry)} disabled={busy}>Speichern</button>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
                <form
                    onsubmit={(e) => {
                        e.preventDefault();
                        if (newKey.trim()) saveEntry({ key: newKey.trim(), value: '', isPublic: false });
                        newKey = '';
                    }}
                >
                    <input placeholder="Neuer Schlüssel" bind:value={newKey} />
                    <button disabled={busy}>Hinzufügen</button>
                </form>
            </section>
        {/if}
    {/if}
</main>

<style>
    main {
        font-family: system-ui, sans-serif;
        max-width: 50rem;
        margin: 2rem auto;
        padding: 0 1rem;
    }
    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    table {
        border-collapse: collapse;
        margin-bottom: 1rem;
    }
    th,
    td {
        text-align: left;
        padding: 0.25rem 0.5rem;
    }
    .muted {
        color: #666;
    }
    .error {
        color: #b00;
    }
</style>
