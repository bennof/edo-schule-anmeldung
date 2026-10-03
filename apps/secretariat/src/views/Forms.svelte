<!-- Form definitions: list, import from JSON, preview. The designer follows in D2. -->
<script lang="ts">
    import type { FormDefinition } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, type FormJson } from '@anmeldung/forms';
    import schoolForm from '@anmeldung/forms/examples/anmeldung-klasse5.json';
    import testForm from '@anmeldung/forms/examples/test-form.json';
    import laender from '@anmeldung/forms/catalogs/laender.json';
    import sprachen from '@anmeldung/forms/catalogs/sprachen.json';
    import staatsangehoerigkeiten from '@anmeldung/forms/catalogs/staatsangehoerigkeiten.json';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { errorText, forms, loadOptions, site } from '../services.ts';

    /** Catalogs bundled with the app (generated, see packages/forms/scripts). */
    const CATALOGS: Record<string, unknown> = {
        'laender.json': laender,
        'sprachen.json': sprachen,
        'staatsangehoerigkeiten.json': staatsangehoerigkeiten,
    };

    let list: FormDefinition[] = $state([]);
    let message = $state('');
    let problems: string[] = $state([]);
    let busy = $state(false);
    let preview: FormDefinition | undefined = $state();
    let previewData = $state({});
    let assetKeys: Set<string> = $state(new Set());

    /** optionsSource keys used by a form definition. */
    function optionSources(json: unknown): string[] {
        const keys = new Set<string>();
        const walk = (v: unknown): void => {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') {
                const o = v as Record<string, unknown>;
                if (typeof o.optionsSource === 'string') keys.add(o.optionsSource);
                Object.values(o).forEach(walk);
            }
        };
        walk(json);
        return [...keys];
    }

    const missingAssets = (form: FormDefinition) => optionSources(form.formJson).filter((k) => !assetKeys.has(k));

    async function uploadCatalogs(keys: string[]): Promise<string[]> {
        const uploaded: string[] = [];
        for (const key of keys) {
            if (!CATALOGS[key]) continue;
            await site.putAsset(key, new Blob([JSON.stringify(CATALOGS[key])], { type: 'application/json' }));
            uploaded.push(key);
        }
        return uploaded;
    }

    async function load(): Promise<void> {
        const [all, assets] = await Promise.all([forms.list(), site.listAssets()]);
        list = all.sort((a, b) => b.dateLastUpdate.localeCompare(a.dateLastUpdate));
        assetKeys = new Set(assets.map((a) => a.key));
    }

    async function importJson(json: unknown): Promise<void> {
        problems = validateFormDefinition(json);
        if (problems.length) {
            message = 'Das Formular ist ungültig:';
            return;
        }
        busy = true;
        try {
            const created = await forms.create({ formJson: json, dateLastUpdate: new Date().toISOString() });
            const catalogs = await uploadCatalogs(optionSources(json));
            message = `Formular „${(json as FormJson).title}“ angelegt (ID ${created.id}).`;
            if (catalogs.length) message += ` Kataloge aktualisiert: ${catalogs.join(', ')}.`;
            await load();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    async function importFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        try {
            await importJson(JSON.parse(await file.text()));
        } catch {
            problems = [];
            message = 'Die Datei enthält kein gültiges JSON.';
        }
    }

    function showPreview(form: FormDefinition): void {
        preview = form;
        previewData = initialData(form.formJson as FormJson);
    }

    load().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

<section>
    <h2>Formulare</h2>
    <p class="actions">
        <label class="button">
            JSON-Datei importieren
            <input type="file" accept="application/json,.json" onchange={importFile} disabled={busy} hidden />
        </label>
        <button onclick={() => importJson(schoolForm)} disabled={busy}>Schulformular anlegen</button>
        <button class="secondary" onclick={() => importJson(testForm)} disabled={busy}>Testformular anlegen</button>
    </p>
    {#if message}
        <p>{message}</p>
        {#if problems.length}<ul class="error">{#each problems as p}<li>{p}</li>{/each}</ul>{/if}
    {/if}

    <table>
        <thead><tr><th>ID</th><th>Titel</th><th>Stand</th><th></th></tr></thead>
        <tbody>
            {#each list as form (form.id)}
                <tr>
                    <td>{form.id}</td>
                    <td>
                        {(form.formJson as FormJson).title}
                        {#if missingAssets(form).length}
                            <br /><small class="error">Fehlende Kataloge: {missingAssets(form).join(', ')}</small>
                        {/if}
                    </td>
                    <td>{new Date(form.dateLastUpdate).toLocaleString('de-DE')}</td>
                    <td><button onclick={() => showPreview(form)}>Vorschau</button></td>
                </tr>
            {:else}
                <tr><td colspan="4" class="muted">Noch keine Formulare.</td></tr>
            {/each}
        </tbody>
    </table>
</section>

{#if preview}
    <section>
        <h2>Vorschau: {(preview.formJson as FormJson).title}</h2>
        <button onclick={() => (preview = undefined)}>Schließen</button>
        {#key preview.id}
            <FormRenderer form={preview.formJson as FormJson} data={previewData} mode="secretariat" {loadOptions} />
        {/key}
    </section>
{/if}
