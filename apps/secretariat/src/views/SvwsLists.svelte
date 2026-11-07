<!-- Option lists from SVWS: reads a fixed SVWS catalog or a school table,
     the user picks the key and value columns, the result is saved as a file
     (e.g. laender.json) under "Dateien" and used by forms via optionsSource. -->
<script lang="ts">
    import { isAssetKey } from '@anmeldung/sharepoint';
    import { columnsOf, SVWS_CATALOGS, SVWS_TABLES, toOptionList, type OptionListSource, type SvwsRow } from '@anmeldung/svws';
    import { ask } from '../dialogs.svelte.ts';
    import { errorText, site, svws } from '../services.ts';
    import { svwsCredentials, svwsLogin } from '../svws-credentials.svelte.ts';

    type Kind = 'nationalitaeten' | 'verkehrssprachen' | 'table';

    let file = $state('laender.json');
    let kind = $state<Kind>('nationalitaeten');
    let tableId = $state('');
    let rows: SvwsRow[] = $state([]);
    let key = $state('');
    let value = $state('');
    let busy = $state(false);
    let message = $state('');
    let error = $state('');

    const source = $derived<OptionListSource | undefined>(
        kind === 'table' ? SVWS_TABLES.find((t) => t.id === tableId) : SVWS_CATALOGS.find((c) => c.id === kind),
    );
    const columns = $derived(columnsOf(rows));
    const fileValid = $derived(isAssetKey(file) && file.endsWith('.json'));
    const preview = $derived(rows.length && key && value ? toOptionList(rows, key, value) : []);
    const canLoad = $derived(svws.ready && !!svwsLogin.user.trim() && !!source);

    /** loads the rows of the chosen source and suggests columns and file name */
    async function load(): Promise<void> {
        rows = [];
        key = '';
        value = '';
        error = '';
        message = '';
        if (!canLoad || !source) return;
        busy = true;
        try {
            rows = await svws.readRows(source.path, svwsCredentials());
            key = columns.includes(source.key) ? source.key : (columns[0] ?? '');
            value = columns.includes(source.value) ? source.value : (columns[1] ?? '');
            if (source.file) file = source.file;
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    function choose(next: Kind): void {
        kind = next;
        if (next !== 'table') void load();
        else rows = [];
    }

    /** reads the list with the chosen columns and saves it as a file */
    async function read(): Promise<void> {
        if (!fileValid || !preview.length) return;
        error = '';
        message = '';
        busy = true;
        try {
            const exists = (await site.listAssets()).some((a) => a.key === file);
            if (exists && !(await ask(`„${file}“ gibt es schon. Durch ${preview.length} Einträge aus SVWS ersetzen?`, 'Ersetzen'))) return;
            await site.putAsset(file, new Blob([JSON.stringify(preview)], { type: 'application/json' }));
            message = `„${file}“ mit ${preview.length} Einträgen aus „${source?.label}“ gespeichert.`;
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    function cancel(): void {
        file = 'laender.json';
        kind = 'nationalitaeten';
        tableId = '';
        rows = [];
        key = '';
        value = '';
        error = '';
        message = '';
    }

    const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
</script>

<section>
    <h2>Aus SVWS</h2>
    <p class="muted">
        Erzeugt Auswahllisten für Formulare aus SVWS, z. B. <code>laender.json</code>. Die Datei wird unter „Dateien“ gespeichert; ein Formularfeld nutzt sie
        über ihren Namen (Auswahlliste aus Datei). So passen die Werte zu den Katalogen von SVWS und SchILD-NRW.
    </p>

    {#if !svws.ready}
        <p class="warning" role="alert">{svws.status()}</p>
    {:else}
        <div class="login">
            <label>SVWS-Benutzer <input bind:value={svwsLogin.user} autocomplete="username" /></label>
            <label>Passwort <input type="password" bind:value={svwsLogin.password} autocomplete="current-password" /></label>
        </div>

        <label>Dateiname <input bind:value={file} aria-invalid={!fileValid} placeholder="z. B. laender.json" /></label>
        {#if !fileValid}<p class="error">Der Name muss auf .json enden und darf nur Buchstaben, Ziffern, Punkt, - und _ enthalten.</p>{/if}

        <fieldset>
            <legend>Quelle</legend>
            {#each SVWS_CATALOGS as c (c.id)}
                <label class="choice"
                    ><input type="radio" name="kind" checked={kind === c.id} onchange={() => choose(c.id as Kind)} disabled={busy} /> {c.label}</label
                >
            {/each}
            <label class="choice"><input type="radio" name="kind" checked={kind === 'table'} onchange={() => choose('table')} disabled={busy} /> Tabelle der Schule</label>
            {#if kind === 'table'}
                <label
                    >Tabelle
                    <select bind:value={tableId} onchange={load} disabled={busy}>
                        <option value="" disabled>bitte wählen</option>
                        {#each SVWS_TABLES as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
                    </select></label
                >
            {/if}
            {#if source && !rows.length}<button class="secondary" onclick={load} disabled={busy || !canLoad}>Laden</button>{/if}
        </fieldset>

        {#if busy}<p class="muted">Wird geladen …</p>{/if}

        {#if rows.length}
            <p class="muted">{rows.length} Zeilen in SVWS, drei als Beispiel:</p>
            <div class="scroll">
                <table data-testid="svws-sample">
                    <thead><tr>{#each columns as c (c)}<th class:picked={c === key || c === value}>{c}</th>{/each}</tr></thead>
                    <tbody>
                        {#each rows.slice(0, 3) as row, i (i)}
                            <tr>{#each columns as c (c)}<td class:picked={c === key || c === value}>{cell(row[c])}</td>{/each}</tr>
                        {/each}
                    </tbody>
                </table>
            </div>

            <div class="columns">
                <label
                    >Schlüssel (key)
                    <select bind:value={key}>{#each columns as c (c)}<option value={c}>{c}</option>{/each}</select></label
                >
                <label
                    >Anzeige (value)
                    <select bind:value={value}>{#each columns as c (c)}<option value={c}>{c}</option>{/each}</select></label
                >
            </div>
            <p class="muted">
                Ergebnis: {preview.length} Einträge{#if preview.length}, z. B. {#each preview.slice(0, 3) as o, i (o.key)}{i ? ', ' : ''}<code>{o.key}</code> → {o.value}{/each}{/if}.
                Ausgeblendete und abgelaufene Einträge sowie Zeilen ohne Schlüssel oder Anzeige fallen weg.
            </p>
        {/if}

        <p class="actions">
            <button onclick={read} disabled={busy || !fileValid || !preview.length}>Lesen und speichern</button>
            <button class="secondary" onclick={cancel} disabled={busy}>Abbrechen</button>
        </p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
    section {
        display: grid;
        gap: 0.75rem;
        max-width: 60rem;
    }
    .login,
    .columns {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
    }
    fieldset {
        display: grid;
        gap: 0.4rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.75rem 1rem;
    }
    .choice {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }
    .scroll {
        overflow-x: auto;
    }
    table {
        font-size: 0.85rem;
        border-collapse: collapse;
    }
    th,
    td {
        padding: 0.25rem 0.5rem;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
        text-align: left;
    }
    .picked {
        background: var(--info-bg);
    }
    .warning {
        background: var(--warn-bg);
        border-radius: var(--radius);
        padding: 0.6rem 0.9rem;
    }
</style>
