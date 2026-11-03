<!-- Forms with versions (backlog D2, D3): list form families and versions,
     open a version in the designer (saves a new version), import/export JSON,
     preview. Saved versions are never changed. -->
<script lang="ts">
    import type { Procedure } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, optionSources, type FormJson } from '@anmeldung/forms';
    import schoolForm from '@anmeldung/forms/examples/anmeldung-klasse5.json';
    import testForm from '@anmeldung/forms/examples/test-form.json';
    import laender from '@anmeldung/forms/catalogs/laender.json';
    import sprachen from '@anmeldung/forms/catalogs/sprachen.json';
    import staatsangehoerigkeiten from '@anmeldung/forms/catalogs/staatsangehoerigkeiten.json';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import type { FormFamily, FormVersion } from '@anmeldung/sharepoint';
    import FormDesigner from '../components/designer/FormDesigner.svelte';
    import { emptyForm } from '../components/designer/designer.ts';
    import { errorText, formService, loadOptions, procedures, site, uploadDefaultTemplate } from '../services.ts';

    /** Catalogs bundled with the app (generated, see packages/forms/scripts). */
    const CATALOGS: Record<string, unknown> = {
        'laender.json': laender,
        'sprachen.json': sprachen,
        'staatsangehoerigkeiten.json': staatsangehoerigkeiten,
    };

    let families: FormFamily[] = $state([]);
    let procedureList: Procedure[] = $state([]);
    let message = $state('');
    let problems: string[] = $state([]);
    let busy = $state(false);
    let preview: FormVersion | undefined = $state();
    let previewData = $state({});
    let assetKeys: Set<string> = $state(new Set());
    let designer: { initial: FormJson; formKey?: string; nextVersion: number } | undefined = $state();

    const usedBy = (formId: string) => procedureList.filter((p) => p.formId === formId).map((p) => p.info.title);
    const missingAssets = (v: FormVersion) => optionSources(v.formJson).filter((k) => !assetKeys.has(k));
    const titleOf = (v: FormVersion) => (v.formJson as FormJson).title;

    async function load(): Promise<void> {
        const [fams, procs, assets] = await Promise.all([formService.families(), procedures.list(), site.listAssets()]);
        families = fams;
        procedureList = procs;
        assetKeys = new Set(assets.map((a) => a.key));
    }

    async function uploadCatalogs(keys: string[]): Promise<string[]> {
        const uploaded: string[] = [];
        for (const key of keys) {
            if (!CATALOGS[key]) continue;
            await site.putAsset(key, new Blob([JSON.stringify(CATALOGS[key])], { type: 'application/json' }));
            uploaded.push(key);
        }
        return uploaded;
    }

    /** Saves a definition; same title as an existing form = its next version. */
    async function importJson(json: unknown): Promise<void> {
        problems = validateFormDefinition(json);
        if (problems.length) {
            message = 'Das Formular ist ungültig:';
            return;
        }
        busy = true;
        try {
            const title = (json as FormJson).title;
            const family = families.find((f) => f.title === title);
            const saved = await formService.saveVersion(json, family?.formKey);
            const catalogs = await uploadCatalogs(optionSources(json));
            const template = json === schoolForm && (await uploadDefaultTemplate());
            message =
                `Formular „${title}“ als Version ${saved.version} angelegt (ID ${saved.id}).` +
                (catalogs.length ? ` Kataloge aktualisiert: ${catalogs.join(', ')}.` : '') +
                (template ? ' Anmeldebogen-Vorlage hochgeladen.' : '');
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

    function exportJson(v: FormVersion): void {
        const url = URL.createObjectURL(new Blob([JSON.stringify(v.formJson, null, 2)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `${v.formKey}-v${v.version}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function showPreview(v: FormVersion): void {
        preview = v;
        previewData = initialData(v.formJson as FormJson);
    }

    function edit(family: FormFamily, v: FormVersion): void {
        designer = { initial: v.formJson as FormJson, formKey: family.formKey, nextVersion: Number(family.versions[0].version) + 1 };
    }

    load().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

{#if designer}
    <FormDesigner
        initial={designer.initial}
        formKey={designer.formKey}
        nextVersion={designer.nextVersion}
        oncancel={() => (designer = undefined)}
        onsaved={async (id) => {
            designer = undefined;
            message = `Neue Version gespeichert (ID ${id}).`;
            await load();
        }}
    />
{:else}
    <section>
        <h2>Formulare</h2>
        <p class="muted">Gespeicherte Versionen werden nie verändert: Änderungen im Designer ergeben eine neue Version. Anmeldungen behalten die Version, mit der sie angelegt wurden.</p>
        <p class="actions">
            <button onclick={() => (designer = { initial: emptyForm(), nextVersion: 1 })} disabled={busy}>Neues Formular</button>
            <label class="button">
                JSON-Datei importieren
                <input type="file" accept="application/json,.json" onchange={importFile} disabled={busy} hidden />
            </label>
            <button class="secondary" onclick={() => importJson(schoolForm)} disabled={busy}>Schulformular anlegen</button>
            <button class="secondary" onclick={() => importJson(testForm)} disabled={busy}>Testformular anlegen</button>
        </p>
        {#if message}
            <p role="status">{message}</p>
            {#if problems.length}<ul class="error">{#each problems as p}<li>{p}</li>{/each}</ul>{/if}
        {/if}

        {#each families as family (family.formKey)}
            <div class="family" data-form-key={family.formKey}>
                <h3>{family.title} <small class="muted">{family.formKey}</small></h3>
                <table>
                    <thead><tr><th>Version</th><th>ID</th><th>Stand</th><th>Verwendet von</th><th></th></tr></thead>
                    <tbody>
                        {#each family.versions as v, i (v.id)}
                            <tr data-id={v.id}>
                                <td>
                                    {v.version}{#if i === 0} <span class="badge">neueste</span>{/if}
                                    {#if titleOf(v) !== family.title}<br /><small class="muted">{titleOf(v)}</small>{/if}
                                    {#if missingAssets(v).length}<br /><small class="error">Fehlende Kataloge: {missingAssets(v).join(', ')}</small>{/if}
                                </td>
                                <td>{v.id}</td>
                                <td>{new Date(v.dateLastUpdate).toLocaleString('de-DE')}</td>
                                <td>{usedBy(v.id).join(', ') || '–'}</td>
                                <td class="tools">
                                    <button class="secondary" onclick={() => showPreview(v)}>Vorschau</button>
                                    <button class="secondary" onclick={() => edit(family, v)}>Bearbeiten → Version {Number(family.versions[0].version) + 1}</button>
                                    <button class="secondary" onclick={() => exportJson(v)}>JSON</button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {:else}
            <p class="muted">Noch keine Formulare.</p>
        {/each}
    </section>

    {#if preview}
        <section>
            <h2>Vorschau: {titleOf(preview)} (Version {preview.version})</h2>
            <button onclick={() => (preview = undefined)}>Schließen</button>
            {#key preview.id}
                <FormRenderer form={preview.formJson as FormJson} data={previewData} mode="secretariat" {loadOptions} />
            {/key}
        </section>
    {/if}
{/if}

<style>
    .family {
        margin: 1rem 0;
    }
    .family h3 {
        margin-bottom: 0;
    }
    .tools {
        white-space: nowrap;
    }
</style>
