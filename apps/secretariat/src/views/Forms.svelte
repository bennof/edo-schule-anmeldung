<!-- Form definitions: list, import from JSON, preview. The designer follows in D2. -->
<script lang="ts">
    import type { FormDefinition } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, type FormJson } from '@anmeldung/forms';
    import testForm from '@anmeldung/forms/examples/test-form.json';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { errorText, forms } from '../services.ts';

    let list: FormDefinition[] = $state([]);
    let message = $state('');
    let problems: string[] = $state([]);
    let busy = $state(false);
    let preview: FormDefinition | undefined = $state();
    let previewData = $state({});

    async function load(): Promise<void> {
        list = (await forms.list()).sort((a, b) => b.dateLastUpdate.localeCompare(a.dateLastUpdate));
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
            message = `Formular „${(json as FormJson).title}“ angelegt (ID ${created.id}).`;
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
        <button onclick={() => importJson(testForm)} disabled={busy}>Testformular anlegen</button>
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
                    <td>{(form.formJson as FormJson).title}</td>
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
            <FormRenderer form={preview.formJson as FormJson} data={previewData} mode="secretariat" />
        {/key}
    </section>
{/if}
