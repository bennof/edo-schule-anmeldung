<!-- Applications: open an existing application in the full secretariat form
     and save it (backlog C4). Search, filters and autosave follow in Sprint 5. -->
<script lang="ts">
    import type { Application, FormDefinition, Procedure } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { normalizeData, type FormData, type FormJson } from '@anmeldung/forms';
    import { applications, errorText, forms, loadOptions, procedures } from '../services.ts';

    let list: Application[] = $state([]);
    let procedureList: Procedure[] = $state([]);
    let message = $state('');
    let busy = $state(false);
    let newProcedureId = $state('');

    let current: { app: Application; form: FormJson } | undefined = $state();
    let data: FormData = $state({});
    let savedJson = $state('');
    const dirty = $derived(current !== undefined && JSON.stringify(data) !== savedJson);

    const procedureTitle = (id: string) => procedureList.find((p) => p.id === id)?.info.title ?? `Verfahren ${id}`;

    async function load(): Promise<void> {
        [list, procedureList] = await Promise.all([applications.list(), procedures.list()]);
        list.sort((a, b) => Number(b.id) - Number(a.id));
        newProcedureId ||= procedureList[0]?.id ?? '';
    }

    async function open(app: Application): Promise<void> {
        if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
        message = '';
        const def: FormDefinition | undefined = await forms.get(app.formId);
        if (!def) {
            message = `Formular ${app.formId} nicht gefunden.`;
            return;
        }
        const form = def.formJson as FormJson;
        data = normalizeData(form, (app.data ?? {}) as FormData);
        savedJson = JSON.stringify(data);
        current = { app, form };
    }

    async function save(): Promise<void> {
        if (!current) return;
        busy = true;
        try {
            const snapshot = $state.snapshot(data);
            await applications.update(current.app.id, { data: snapshot });
            savedJson = JSON.stringify(snapshot);
            message = 'Gespeichert.';
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    /** For registrations without a digital form (e.g. on paper). */
    async function createEmpty(): Promise<void> {
        const procedure = procedureList.find((p) => p.id === newProcedureId);
        if (!procedure) return;
        busy = true;
        try {
            const app = await applications.create({ procedureId: procedure.id, formId: procedure.formId, data: {}, state: 'created' });
            await load();
            await open(app);
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    const childName = (app: Application) => {
        const d = (app.data ?? {}) as Record<string, unknown>;
        return [d.vorname, d.nachname].filter(Boolean).join(' ') || '–';
    };

    load().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

{#if current}
    <section>
        <header class="bar">
            <button class="secondary" onclick={() => { if (!dirty || confirm('Ungespeicherte Änderungen verwerfen?')) current = undefined; }}>
                ← Zur Liste
            </button>
            <h2>Anmeldung {current.app.id} · {procedureTitle(current.app.procedureId)}</h2>
            <span class="state">Status: {current.app.state}</span>
            {#if current.app.submittedAt}<span class="muted">abgeschickt {new Date(current.app.submittedAt).toLocaleString('de-DE')}</span>{/if}
            <button onclick={save} disabled={busy || !dirty}>Speichern</button>
            {#if dirty}<span class="muted">Ungespeicherte Änderungen</span>{:else if message}<span>{message}</span>{/if}
        </header>
        {#key current.app.id}
            <FormRenderer form={current.form} {data} mode="secretariat" {loadOptions} />
        {/key}
    </section>
{:else}
    <section>
        <h2>Anmeldungen</h2>
        {#if message}<p>{message}</p>{/if}
        <p class="actions">
            <select bind:value={newProcedureId} aria-label="Verfahren">
                {#each procedureList as p (p.id)}<option value={p.id}>{p.info.title}</option>{/each}
            </select>
            <button onclick={createEmpty} disabled={busy || !newProcedureId}>Leere Anmeldung anlegen</button>
        </p>
        <table>
            <thead><tr><th>ID</th><th>Kind</th><th>Verfahren</th><th>Status</th><th></th></tr></thead>
            <tbody>
                {#each list as app (app.id)}
                    <tr>
                        <td>{app.id}</td>
                        <td>{childName(app)}</td>
                        <td>{procedureTitle(app.procedureId)}</td>
                        <td>{app.state}</td>
                        <td><button onclick={() => open(app)}>Öffnen</button></td>
                    </tr>
                {:else}
                    <tr><td colspan="5" class="muted">Noch keine Anmeldungen.</td></tr>
                {/each}
            </tbody>
        </table>
    </section>
{/if}

<style>
    .bar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        position: sticky;
        top: 0;
        background: white;
        padding: 0.5rem 0;
        z-index: 1;
    }
    .bar h2 {
        margin: 0;
        font-size: 1.2rem;
    }
</style>
