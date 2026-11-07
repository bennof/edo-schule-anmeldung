<!-- Procedure management (backlog D1): create, list, edit and delete procedures. -->
<script lang="ts">
    import { ask } from '../dialogs.svelte.ts';
    import type { Procedure } from '@anmeldung/domain';
    import type { FormJson } from '@anmeldung/forms';
    import { deleteProcedure, newestFirst, type FormVersion } from '@anmeldung/sharepoint';
    import { errorText, formService, procedures, site } from '../services.ts';

    interface Draft {
        id?: string;
        title: string;
        description: string;
        startDate: string;
        endDate: string;
        formId: string;
    }

    let list: Procedure[] = $state([]);
    let formList: FormVersion[] = $state([]);
    let draft: Draft | undefined = $state();
    let message = $state('');
    let busy = $state(false);

    const formTitle = (id: string) => {
        const f = formList.find((x) => x.id === id);
        return f ? `${(f.formJson as FormJson).title} · Version ${f.version}` : `unbekannt (ID ${id})`;
    };
    /** a newer version of the procedure's form exists (D3) */
    const newerVersion = (id: string) => {
        const f = formList.find((x) => x.id === id);
        return f && formList.find((x) => x.formKey === f.formKey && newestFirst(x, f) < 0);
    };
    const formatDate = (d: string) => d.split('-').reverse().join('.');

    const draftErrors = $derived.by(() => {
        if (!draft) return [];
        const errors: string[] = [];
        if (!draft.title.trim()) errors.push('Titel fehlt');
        if (!draft.startDate || !draft.endDate) errors.push('Zeitraum fehlt');
        else if (draft.startDate > draft.endDate) errors.push('Beginn liegt nach dem Ende');
        if (!draft.formId) errors.push('Formular fehlt');
        return errors;
    });

    async function load(): Promise<void> {
        [list, formList] = await Promise.all([procedures.list(), formService.listVersions()]);
        formList.sort((a, b) => a.formKey.localeCompare(b.formKey) || newestFirst(a, b));
        list.sort((a, b) => b.startDate.localeCompare(a.startDate));
    }

    function edit(p?: Procedure): void {
        message = '';
        draft = p
            ? { id: p.id, title: p.info.title, description: p.info.description ?? '', startDate: p.startDate, endDate: p.endDate, formId: p.formId }
            : { title: '', description: '', startDate: '', endDate: '', formId: formList[0]?.id ?? '' };
    }

    async function save(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (!draft || draftErrors.length) return;
        busy = true;
        const values = {
            info: { title: draft.title.trim(), ...(draft.description.trim() && { description: draft.description.trim() }) },
            startDate: draft.startDate,
            endDate: draft.endDate,
            formId: draft.formId,
        };
        try {
            if (draft.id) await procedures.update(draft.id, values);
            else await procedures.create(values);
            message = `Verfahren „${values.info.title}“ gespeichert.`;
            draft = undefined;
            await load();
        } catch (err) {
            message = `Fehler: ${errorText(err)}`;
        } finally {
            busy = false;
        }
    }

    /** Deletes the procedure with its appointments, applications and uploads; forms stay. */
    async function remove(p: Procedure): Promise<void> {
        const question =
            `Verfahren „${p.info.title}“ endgültig löschen?\n\n` +
            'Alle Termine, Anmeldungen und hochgeladenen Dateien dieses Verfahrens werden mitgelöscht. Die Formulare bleiben erhalten.';
        if (!(await ask(question, 'Löschen'))) return;
        busy = true;
        message = '';
        try {
            const n = await deleteProcedure(site, p.id);
            message = `Verfahren „${p.info.title}“ gelöscht, mit ${n.applications} Anmeldung(en) und ${n.appointments} Termin(en).`;
            await load();
        } catch (err) {
            message = `Fehler: ${errorText(err)}`;
        } finally {
            busy = false;
        }
    }

    load().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

<section>
    <h2>Anmeldeverfahren</h2>
    <button onclick={() => edit()} disabled={!!draft}>Neues Verfahren</button>
    {#if message}<p>{message}</p>{/if}

    {#if draft}
        <form class="editor" onsubmit={save} novalidate>
            <h3>{draft.id ? 'Verfahren bearbeiten' : 'Neues Verfahren'}</h3>
            <label>Titel <input bind:value={draft.title} required /></label>
            <label>Beschreibung <textarea bind:value={draft.description} rows="3"></textarea></label>
            <div class="row">
                <label>Beginn <input type="date" bind:value={draft.startDate} required /></label>
                <label>Ende <input type="date" bind:value={draft.endDate} required /></label>
            </div>
            <label>
                Formular
                <select bind:value={draft.formId}>
                    <option value="">– bitte wählen –</option>
                    {#each formList as f (f.id)}<option value={f.id}>{formTitle(f.id)}</option>{/each}
                </select>
            </label>
            {#if !formList.length}<p class="muted">Zuerst unter „Formulare“ ein Formular anlegen.</p>{/if}
            {#if draftErrors.length}<p class="error">{draftErrors.join(' · ')}</p>{/if}
            <p>
                <button type="submit" disabled={busy || draftErrors.length > 0}>Speichern</button>
                <button type="button" class="secondary" onclick={() => (draft = undefined)}>Abbrechen</button>
            </p>
        </form>
    {/if}

    <table>
        <thead><tr><th>Titel</th><th>Zeitraum</th><th>Formular</th><th></th></tr></thead>
        <tbody>
            {#each list as p (p.id)}
                <tr>
                    <td>{p.info.title}{#if p.info.description}<br /><small class="muted">{p.info.description}</small>{/if}</td>
                    <td>{formatDate(p.startDate)} – {formatDate(p.endDate)}</td>
                    <td>
                        {formTitle(p.formId)}
                        {#if newerVersion(p.formId)}<br /><small class="muted">Neuere Version {newerVersion(p.formId)?.version} vorhanden – über „Bearbeiten“ wählbar</small>{/if}
                    </td>
                    <td class="actions">
                        <button onclick={() => edit(p)} disabled={!!draft || busy}>Bearbeiten</button>
                        <button class="danger" onclick={() => remove(p)} disabled={!!draft || busy}>Löschen</button>
                    </td>
                </tr>
            {:else}
                <tr><td colspan="4" class="muted">Noch keine Verfahren.</td></tr>
            {/each}
        </tbody>
    </table>
</section>

<style>
    .editor {
        display: grid;
        gap: 0.6rem;
        max-width: 32rem;
        background: var(--surface);
        border-radius: var(--radius-lg);
        padding: 0.25rem 1.25rem 1.25rem;
        margin: 1rem 0;
    }
    .editor label {
        display: grid;
        gap: 0.2rem;
    }
    .row {
        display: flex;
        gap: 1rem;
    }
    .actions {
        white-space: nowrap;
    }
    .actions button + button {
        margin-left: 0.25rem;
    }
    button.danger {
        color: var(--danger);
    }
</style>
