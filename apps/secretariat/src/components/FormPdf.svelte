<!-- Print version of a form: a PDF with form fields (made in Word, PDFgear, …)
     and the assignment of its fields to the fields of the form. Saving creates a
     new form version (saved versions are never changed). -->
<script lang="ts">
    import { untrack } from 'svelte';
    import { photoFieldPath, templateFields, type PdfFieldInfo } from '@anmeldung/pdf';
    import { pdfTargets, type FormJson } from '@anmeldung/forms';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { nextVersionLabel, type FormFamily, type FormVersion } from '@anmeldung/sharepoint';
    import { errorText, formService, site } from '../services.ts';

    interface Props {
        family: FormFamily;
        version: FormVersion;
        onsaved: (message: string) => void;
        oncancel: () => void;
    }
    let { family, version, onsaved, oncancel }: Props = $props();

    // the component is created per version, the props do not change
    const form = untrack(() => version.formJson as FormJson);
    const initialFamily = untrack(() => family);
    const targets = pdfTargets(form);
    const photoPath = photoFieldPath(form);

    let fields: PdfFieldInfo[] = $state([]);
    /** PDF field name -> target ('' = not assigned) */
    let assignment: Record<string, string> = $state({});
    let asset = form.pdf?.asset ?? '';
    /** a newly chosen PDF, uploaded when saving */
    let newPdf: File | undefined = $state();
    let label = $state(nextVersionLabel(initialFamily.versions));
    let error = $state('');
    let busy = $state(false);

    /** Selectable targets of a PDF field type. */
    function choices(type: PdfFieldInfo['type']) {
        if (type === 'button') return targets.filter((t) => t.target === photoPath);
        if (type === 'checkbox') return targets;
        return targets.filter((t) => t.kind === 'text');
    }

    function load(info: PdfFieldInfo[], previous: Record<string, string>): void {
        fields = info;
        // keep an existing assignment; otherwise take field names that already are targets
        assignment = Object.fromEntries(
            info.map((f) => [f.name, previous[f.name] ?? (targets.some((t) => t.target === f.name) ? f.name : '')]),
        );
    }

    async function init(): Promise<void> {
        if (!asset) return;
        const blob = await site.getAsset(asset);
        if (!blob) throw new Error(`Die Datei „${asset}“ fehlt in den Dateien.`);
        load(await templateFields(await blob.arrayBuffer()), form.pdf?.fields ?? {});
    }

    async function pick(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        error = '';
        try {
            const info = await templateFields(await file.arrayBuffer());
            if (!info.length) throw new Error('Das PDF hat keine Formularfelder.');
            newPdf = file;
            load(info, {});
        } catch (err) {
            error = err instanceof Error && err.message.startsWith('Das PDF') ? err.message : 'Die Datei ist kein lesbares PDF mit Formularfeldern.';
        }
    }

    const assigned = $derived(Object.values(assignment).filter(Boolean).length);

    async function save(remove = false): Promise<void> {
        error = '';
        busy = true;
        try {
            const { pdf: _, ...rest } = form;
            let json: FormJson = rest;
            if (!remove) {
                let key = asset;
                if (newPdf) {
                    // a new key per upload: older versions keep their PDF
                    key = `${family.formKey}-${new Date().toISOString().slice(0, 16).replace(/\D/g, '')}.pdf`;
                    await site.putAsset(key, newPdf);
                }
                json = { ...rest, pdf: { asset: key, fields: Object.fromEntries(Object.entries(assignment).filter(([, t]) => t)) } };
            }
            const problems = validateFormDefinition(json);
            if (problems.length) throw new Error(problems.join('; '));
            const saved = await formService.saveVersion(json, family.formKey, label);
            onsaved(`Version ${saved.version} von „${family.title}“ ${remove ? 'ohne' : 'mit'} PDF gespeichert (ID ${saved.id}). Im Verfahren die neue Version auswählen.`);
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    init().catch((e) => (error = errorText(e)));
</script>

<section>
    <h2>PDF zuweisen: {family.title} (Version {version.version})</h2>
    <p class="muted">
        Das PDF mit Formularfeldern wird in Word oder PDFgear erstellt und hier ausgewählt. Jedes PDF-Feld wird einem Feld des
        Formulars zugeordnet. Nach dem Absenden wird das ausgefüllte PDF per E-Mail an die Familie geschickt. Das Speichern ergibt eine
        neue Formularversion.
    </p>
    <p>
        <label class="button">
            {asset || newPdf ? 'Anderes PDF wählen' : 'PDF wählen'}
            <input type="file" accept="application/pdf,.pdf" onchange={pick} hidden />
        </label>
        {#if newPdf}<span>Neu: {newPdf.name}</span>{:else if asset}<span>Aktuell: <code>{asset}</code></span>{/if}
    </p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if fields.length}
        <p>{assigned} von {fields.length} PDF-Feldern zugeordnet.</p>
        <table>
            <thead><tr><th>PDF-Feld</th><th>Typ</th><th>Zuordnung im Formular</th></tr></thead>
            <tbody>
                {#each fields as f (f.name)}
                    <tr class:open={!assignment[f.name]}>
                        <td><code>{f.name}</code></td>
                        <td>{f.type}{#if f.options}<br /><small class="muted">{f.options.join(', ')}</small>{/if}</td>
                        <td>
                            <select bind:value={assignment[f.name]} aria-label={`Zuordnung für ${f.name}`}>
                                <option value="">– nicht zugeordnet –</option>
                                {#each choices(f.type) as t (t.target)}<option value={t.target}>{t.label}</option>{/each}
                            </select>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
        <p>
            <label class="version">Neue Version <input bind:value={label} placeholder="z. B. 2026/27" /></label>
            <button onclick={() => save()} disabled={busy || !label.trim() || (!asset && !newPdf)}>Speichern → neue Version</button>
            <button class="secondary" onclick={oncancel} disabled={busy}>Abbrechen</button>
            {#if form.pdf}<button class="secondary danger" onclick={() => save(true)} disabled={busy || !label.trim()}>PDF entfernen → neue Version</button>{/if}
        </p>
    {:else}
        <p><button class="secondary" onclick={oncancel}>Abbrechen</button></p>
    {/if}
</section>

<style>
    tr.open td {
        color: var(--muted, #666);
    }
    select {
        max-width: 28rem;
    }
    button.danger {
        color: var(--danger);
    }
</style>
