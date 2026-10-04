<!-- Applications panel (backlog K1-K4): all applications independent of
     appointments, name search, status filter, open in the full editor. -->
<script lang="ts">
    import { APPLICATION_STATES, type Appointment, type ApplicationState, type Procedure } from '@anmeldung/domain';
    import type { ApplicationSummary } from '@anmeldung/sharepoint';
    import ApplicationEditor from '../components/ApplicationEditor.svelte';
    import { APPLICATION_STATE_LABEL, formatDateTime } from '../labels.ts';
    import { applicationService, applications, appointments, errorText, procedures, svws } from '../services.ts';

    let list: ApplicationSummary[] = $state([]);
    let appointmentByApplication: Map<string, Appointment> = $state(new Map());
    let procedureList: Procedure[] = $state([]);
    let loading = $state(true);
    let message = $state('');
    let busy = $state(false);
    let query = $state('');
    let stateFilter: ApplicationState[] = $state([]);
    let openId: string | undefined = $state();
    let newProcedureId = $state('');

    // M2: selection of released applications for the SVWS transfer
    let selected: string[] = $state([]);
    let transferMessage = $state('');
    const released = $derived(list.filter((a) => a.state === 'ready_for_svws'));

    function toggleSelected(id: string): void {
        selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    }

    async function transfer(): Promise<void> {
        busy = true;
        transferMessage = '';
        try {
            const items = await Promise.all(
                selected.map(async (id) => {
                    const { application } = await applicationService.load(id);
                    return { applicationId: id, formId: application.formId, data: application.data };
                }),
            );
            const results = await svws.transfer(items);
            let ok = 0;
            for (const r of results.filter((r) => r.ok)) {
                // imported only after a confirmed transfer
                await applicationService.transition(r.applicationId, 'imported', (await applicationService.load(r.applicationId)).eTag);
                ok++;
            }
            const failed = results.filter((r) => !r.ok);
            transferMessage = `${ok} übertragen${failed.length ? `, ${failed.length} nicht übertragen: ${[...new Set(failed.map((f) => f.message))].join(' ')}` : ''}.`;
            if (ok) {
                selected = [];
                await load();
            }
        } catch (e) {
            transferMessage = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    /** case- and accent-insensitive */
    const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const procedureTitle = (id: string) => procedureList.find((p) => p.id === id)?.info.title ?? `Verfahren ${id}`;
    const counts = $derived(Object.fromEntries(APPLICATION_STATES.map((s) => [s, list.filter((a) => a.state === s).length])));
    const visible = $derived.by(() => {
        const terms = normalize(query).split(/\s+/).filter(Boolean);
        return list.filter((a) => {
            if (stateFilter.length && !stateFilter.includes(a.state)) return false;
            const haystack = normalize(`${a.childName ?? ''} ${a.contactName ?? ''} ${a.contactEmail ?? ''}`);
            return terms.every((t) => haystack.includes(t));
        });
    });

    async function load(): Promise<void> {
        try {
            const [summaries, allAppointments, procs] = await Promise.all([
                applicationService.listSummaries(),
                appointments.repo.list(undefined, ['applicationId', 'datetime', 'state', 'verantwortlicherId']),
                procedures.list(),
            ]);
            list = summaries.sort((a, b) => (a.childName ?? a.contactName ?? '').localeCompare(b.childName ?? b.contactName ?? '', 'de'));
            appointmentByApplication = new Map(allAppointments.filter((a) => a.applicationId).map((a) => [a.applicationId!, a]));
            procedureList = procs;
            newProcedureId ||= procs[0]?.id ?? '';
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            loading = false;
        }
    }

    function toggleState(state: ApplicationState): void {
        stateFilter = stateFilter.includes(state) ? stateFilter.filter((s) => s !== state) : [...stateFilter, state];
    }

    /** For registrations without a digital form (e.g. on paper). */
    async function createEmpty(): Promise<void> {
        const procedure = procedureList.find((p) => p.id === newProcedureId);
        if (!procedure) return;
        busy = true;
        try {
            const app = await applications.create({ procedureId: procedure.id, formId: procedure.formId, data: {}, state: 'created' });
            openId = app.id;
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }

    load();
</script>

{#if openId}
    <ApplicationEditor applicationId={openId} onclose={() => ((openId = undefined), load())} />
{:else}
    <section>
        <h2>Anmeldungen</h2>
        {#if message}<p class="error">{message}</p>{/if}
        <div class="tools">
            <input type="search" placeholder="Name des Kindes oder der Eltern suchen …" bind:value={query} aria-label="Suche" />
            <span class="actions">
                <select bind:value={newProcedureId} aria-label="Verfahren">
                    {#each procedureList as p (p.id)}<option value={p.id}>{p.info.title}</option>{/each}
                </select>
                <button class="secondary" onclick={createEmpty} disabled={busy || !newProcedureId}>Leere Anmeldung anlegen</button>
            </span>
        </div>
        <div class="filters" role="group" aria-label="Statusfilter">
            {#each APPLICATION_STATES as state (state)}
                <button type="button" class="chip" aria-pressed={stateFilter.includes(state)} onclick={() => toggleState(state)}>
                    {APPLICATION_STATE_LABEL[state]} ({counts[state]})
                </button>
            {/each}
        </div>

        {#if released.length}
            <div class="svws" data-testid="svws-transfer">
                <strong>SVWS-Übertragung</strong>
                <span class="muted">{svws.status()}</span>
                <span>{selected.length} von {released.length} freigegebenen Anmeldungen ausgewählt</span>
                <button class="secondary" onclick={() => (selected = released.map((a) => a.id))} disabled={busy}>Alle freigegebenen auswählen</button>
                <button onclick={transfer} disabled={busy || selected.length === 0}>Ausgewählte an SVWS übertragen</button>
                {#if transferMessage}<p role="status">{transferMessage}</p>{/if}
            </div>
        {/if}

        {#if loading}
            <p>Wird geladen …</p>
        {:else}
            <p class="muted">{visible.length} von {list.length} Anmeldungen</p>
            <table>
                <thead><tr><th></th><th>Kind</th><th>Kontakt</th><th>Termin</th><th>Verfahren</th><th>Status</th><th></th></tr></thead>
                <tbody>
                    {#each visible as a (a.id)}
                        {@const appt = appointmentByApplication.get(a.id)}
                        <tr data-id={a.id}>
                            <td>
                                {#if a.state === 'ready_for_svws'}
                                    <input
                                        type="checkbox"
                                        aria-label="Für SVWS-Übertragung auswählen"
                                        checked={selected.includes(a.id)}
                                        onchange={() => toggleSelected(a.id)}
                                    />
                                {/if}
                            </td>
                            <td>{a.childName ?? '–'}</td>
                            <td>{a.contactName ?? ''} {#if a.contactEmail}<br /><small class="muted">{a.contactEmail}</small>{/if}</td>
                            <td>{appt ? formatDateTime(appt.datetime) : '–'}</td>
                            <td>{procedureTitle(a.procedureId)}</td>
                            <td><span class="badge state-{a.state}">{APPLICATION_STATE_LABEL[a.state]}</span></td>
                            <td><button onclick={() => (openId = a.id)}>Öffnen</button></td>
                        </tr>
                    {:else}
                        <tr><td colspan="7" class="muted">Keine Anmeldungen gefunden.</td></tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </section>
{/if}

<style>
    .tools {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        justify-content: space-between;
    }
    .tools input[type='search'] {
        flex: 1;
        min-width: 16rem;
        padding: 0.4rem 0.6rem;
    }
    .svws {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: center;
        background: #f4f6fa;
        border-radius: 6px;
        padding: 0.6rem 0.8rem;
        margin: 0.75rem 0;
    }
    .svws p {
        flex-basis: 100%;
        margin: 0;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0.75rem 0;
    }
    .chip {
        border: 1px solid #ccc;
        border-radius: 999px;
        padding: 0.15rem 0.6rem;
        font-size: 0.85rem;
        background: white;
        color: inherit;
    }
    .chip[aria-pressed='true'] {
        background: #dde8fb;
        border-color: #2456a6;
    }
</style>
