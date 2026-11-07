<!-- Forms with versions (backlog D2, D3): list form families and versions,
     open a version in the designer (saves a new version), import/export JSON,
     preview, delete forms no procedure uses. Saved versions are never changed. -->
<script lang="ts">
    import { ask } from '../dialogs.svelte.ts';
    import type { Procedure } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, optionSources, type FormJson } from '@anmeldung/forms';
    import testForm from '@anmeldung/forms/examples/test-form.json';
    import laender from '@anmeldung/forms/catalogs/laender.json';
    import sprachen from '@anmeldung/forms/catalogs/sprachen.json';
    import staatsangehoerigkeiten from '@anmeldung/forms/catalogs/staatsangehoerigkeiten.json';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { nextVersionLabel, type FormFamily, type FormVersion } from '@anmeldung/sharepoint';
    import FormDesigner from '../components/designer/FormDesigner.svelte';
    import { emptyForm } from '../components/designer/designer.ts';
    import { errorText, formService, loadOptions, procedures, site } from '../services.ts';

    /** Catalogs bundled with the app (generated, see packages/forms/scripts). */
    const CATALOGS: Record<string, unknown> = {
        'laender.json': laender,
        'sprachen.json': sprachen,
        'staatsangehoerigkeiten.json': staatsangehoerigkeiten,
    };

    let families: FormFamily[] = $state([]);
    let procedureList: Procedure[] = $state([]);
    let message = $state('');
    /** why a form cannot be deleted: the procedures using it */
    let warning = $state('');
    let problems: string[] = $state([]);
    let busy = $state(false);
    let preview: FormVersion | undefined = $state();
    let previewData = $state({});
    let assetKeys: Set<string> = $state(new Set());
    let designer: { initial: FormJson; formKey?: string; nextVersion: string } | undefined = $state();

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
            // only missing files: lists made under "Aus SVWS" are kept
            if (!CATALOGS[key] || assetKeys.has(key)) continue;
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
            message =
                `Formular „${title}“ als Version ${saved.version} angelegt (ID ${saved.id}).` +
                (catalogs.length ? ` Kataloge angelegt: ${catalogs.join(', ')}.` : '');
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
        const a = Object.assign(document.createElement('a'), { href: url, download: `${v.formKey}-${v.version.replace(/[^A-Za-z0-9._-]+/g, '-')}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    /** Deletes one version; refused with the names of the procedures still using it. */
    async function removeVersion(family: FormFamily, v: FormVersion): Promise<void> {
        message = '';
        warning = '';
        problems = [];
        busy = true;
        try {
            const used = await formService.usedByVersions([v.id]);
            if (used.length) {
                const names = used.map((id) => `„${procedureList.find((p) => p.id === id)?.info.title ?? `Verfahren ${id}`}“`);
                warning =
                    `Version ${v.version} von „${family.title}“ kann nicht gelöscht werden. Sie wird noch verwendet von: ${names.join(', ')}. ` +
                    'Dort zuerst eine andere Version wählen oder das Verfahren löschen.';
                return;
            }
            const last = family.versions.length === 1;
            if (!(await ask(`Version ${v.version} von „${family.title}“ endgültig löschen?${last ? ' Es ist die einzige Version, das Formular wird damit entfernt.' : ''}`, 'Löschen'))) return;
            await formService.deleteVersion(v.id);
            message = `Version ${v.version} von „${family.title}“ gelöscht.`;
            if (preview?.id === v.id) preview = undefined;
            await load();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    function showPreview(v: FormVersion): void {
        preview = v;
        previewData = initialData(v.formJson as FormJson);
    }

    function edit(family: FormFamily, v: FormVersion): void {
        designer = { initial: v.formJson as FormJson, formKey: family.formKey, nextVersion: nextVersionLabel(family.versions) };
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
            <button onclick={() => (designer = { initial: emptyForm(), nextVersion: '1' })} disabled={busy}>Neues Formular</button>
            <label class="button">
                JSON-Datei importieren
                <input type="file" accept="application/json,.json" onchange={importFile} disabled={busy} hidden />
            </label>
            <button class="secondary" onclick={() => importJson(testForm)} disabled={busy}>Testformular anlegen</button>
        </p>
        {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
        {#if message}
            <p role="status">{message}</p>
            {#if problems.length}<ul class="error">{#each problems as p}<li>{p}</li>{/each}</ul>{/if}
        {/if}

        {#each families as family (family.formKey)}
            <div class="family" data-form-key={family.formKey}>
                <div class="head">
                    <h3>{family.title} <small class="muted">{family.formKey}</small></h3>
                </div>
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
                                    <button class="secondary" onclick={() => edit(family, v)}>Bearbeiten → neue Version</button>
                                    <button class="secondary" onclick={() => exportJson(v)}>JSON</button>
                                    <button class="secondary danger" onclick={() => removeVersion(family, v)} disabled={busy}>Löschen</button>
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
        margin: 0;
    }
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.25rem;
    }
    .warning {
        background: var(--warn-bg);
        border-radius: var(--radius);
        padding: 0.6rem 0.9rem;
    }
    button.danger {
        color: var(--danger);
    }
    /* buttons wrap in narrow windows, so "Löschen" at the end stays visible */
    .tools button {
        white-space: nowrap;
        margin: 0.1rem 0;
    }
</style>
