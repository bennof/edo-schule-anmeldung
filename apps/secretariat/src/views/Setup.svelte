<script lang="ts">
    import type { ConfigEntry } from '@anmeldung/domain';
    import { LISTS, SCHEMA_VERSION, provision } from '@anmeldung/sharepoint';
    import { requireConfig } from '../config.ts';
    import ConfigEditor from '../components/ConfigEditor.svelte';

    const clientConfig = requireConfig();
    import { config, errorText, site } from '../services.ts';

    let loaded = $state(false);
    let schemaVersion: string | undefined = $state();
    let entries: ConfigEntry[] = $state([]);
    let message = $state('');
    let busy = $state(false);
    let newKey = $state('');

    async function load(): Promise<void> {
        if (!(await site.findListId(LISTS.config.name))) {
            schemaVersion = undefined;
            entries = [];
            return;
        }
        entries = await config.all();
        schemaVersion = entries.find((e) => e.key === 'schemaVersion')?.value;
    }

    async function initialLoad(): Promise<void> {
        try {
            await load();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            loaded = true;
        }
    }

    async function run(task: () => Promise<string | void>): Promise<void> {
        busy = true;
        message = '';
        try {
            message = (await task()) ?? '';
            await load();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    const runProvisioning = () =>
        run(async () => {
            const r = await provision(site);
            return `Fertig. Neue Listen: ${r.createdLists.join(', ') || 'keine'}; neue Spalten: ${r.createdColumns.join(', ') || 'keine'}.`;
        });

    const saveEntry = (entry: ConfigEntry) => run(() => config.set(entry.key, entry.value, entry.isPublic));

    initialLoad();
</script>

<section>
    <h2>SharePoint</h2>
    <p>
        Site: <a href={clientConfig.siteUrl} target="_blank" rel="noreferrer">{clientConfig.siteUrl}</a><br />
        {#if !loaded}
            Schema: wird geprüft …
        {:else}
            Schema: {schemaVersion ? `Version ${schemaVersion}` : 'nicht initialisiert'} (App erwartet Version {SCHEMA_VERSION})
        {/if}
    </p>
    {#if loaded}
        <button onclick={runProvisioning} disabled={busy}>
            {schemaVersion ? 'Schema prüfen und ergänzen' : 'Site initialisieren'}
        </button>
    {/if}
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
                    {@const fixed = entry.key === 'schemaVersion'}
                    <tr>
                        <td>{entry.key}</td>
                        <td><input bind:value={entry.value} disabled={fixed} /></td>
                        <td><input type="checkbox" bind:checked={entry.isPublic} disabled={fixed} /></td>
                        <td>
                            {#if !fixed}<button onclick={() => saveEntry(entry)} disabled={busy}>Speichern</button>{/if}
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

<section>
    <h2>Installationskonfiguration (dieser Browser)</h2>
    <ConfigEditor />
</section>
