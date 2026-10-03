<!-- Day view (backlog J2, J4, L1): appointments of one day across procedures,
     parallel slots side by side, with appointment and application state. -->
<script lang="ts">
    import type { Appointment, Procedure } from '@anmeldung/domain';
    import type { ApplicationSummary } from '@anmeldung/sharepoint';
    import ApplicationEditor from '../components/ApplicationEditor.svelte';
    import { APPLICATION_STATE_LABEL, APPOINTMENT_STATE_LABEL } from '../labels.ts';
    import { applicationService, appointments, errorText, procedures } from '../services.ts';

    const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local
    const HASH_DATE = /^#tag\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash)?.[1];

    let date = $state(HASH_DATE ?? today());
    let list: Appointment[] = $state([]);
    let applicationsById: Map<string, ApplicationSummary> = $state(new Map());
    let procedureList: Procedure[] = $state([]);
    let message = $state('');
    let busy = $state(false);
    let openId: string | undefined = $state();

    const tracks = $derived([...new Set(list.map((a) => a.verantwortlicherId ?? ''))].sort((a, b) => a.localeCompare(b, 'de')));
    const times = $derived([...new Set(list.map((a) => a.datetime.slice(11, 16)))].sort());
    const cell = (time: string, track: string) => list.find((a) => a.datetime.slice(11, 16) === time && (a.verantwortlicherId ?? '') === track);
    const procedureTitle = (id: string) => procedureList.find((p) => p.id === id)?.info.title ?? '';
    const multipleProcedures = $derived(new Set(list.map((a) => a.procedureId)).size > 1);
    const stats = $derived({
        booked: list.filter((a) => a.state === 'booked').length,
        done: list.filter((a) => a.state === 'done').length,
        free: list.filter((a) => a.state === 'available').length,
    });

    async function load(): Promise<void> {
        message = '';
        try {
            const [day, summaries, procs] = await Promise.all([
                appointments.repo.list(appointments.repo.startsWith('datetime', date)),
                applicationService.listSummaries(),
                procedures.list(),
            ]);
            list = day.filter((a) => a.state !== 'draft');
            applicationsById = new Map(summaries.map((a) => [a.id, a]));
            procedureList = procs;
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        }
    }

    $effect(() => {
        void date;
        history.replaceState(null, '', `#tag/${date}`);
        load();
    });

    function shift(days: number): void {
        const d = new Date(`${date}T12:00`);
        d.setDate(d.getDate() + days);
        date = d.toLocaleDateString('sv-SE');
    }

    async function run(task: () => Promise<void>): Promise<void> {
        busy = true;
        message = '';
        try {
            await task();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
            await load();
        }
    }

    /** J4: family showed up */
    const arrived = (a: Appointment) =>
        run(async () => {
            const { eTag } = await applicationService.load(a.applicationId!);
            await applicationService.markInterview(a.applicationId!, eTag);
        });

    /** L1: phone cancellation; the application stays */
    const cancel = (a: Appointment) => {
        if (!confirm(`Termin ${a.datetime.slice(11, 16)} Uhr von ${a.nameCustomer ?? 'unbekannt'} freigeben? Die Anmeldung bleibt erhalten.`)) return;
        return run(() => appointments.cancelBooking(a.id));
    };
</script>

{#if openId}
    <ApplicationEditor applicationId={openId} onclose={() => ((openId = undefined), load())} />
{:else}
    <section>
        <header class="day">
            <h2>Tagesansicht</h2>
            <button class="secondary" onclick={() => shift(-1)} aria-label="Vorheriger Tag">◀</button>
            <input type="date" bind:value={date} aria-label="Datum" />
            <button class="secondary" onclick={() => shift(1)} aria-label="Nächster Tag">▶</button>
            <button class="secondary" onclick={() => (date = today())}>Heute</button>
            <span class="muted">{stats.booked} offen · {stats.done} erledigt · {stats.free} frei</span>
        </header>
        {#if message}<p class="error" role="alert">{message}</p>{/if}

        {#if !list.length}
            <p class="muted">Keine veröffentlichten Termine an diesem Tag.</p>
        {:else}
            <table class="grid">
                <thead>
                    <tr><th>Uhrzeit</th>{#each tracks as t (t)}<th>{t || 'Termin'}</th>{/each}</tr>
                </thead>
                <tbody>
                    {#each times as time (time)}
                        <tr>
                            <th scope="row">{time}</th>
                            {#each tracks as track (track)}
                                {@const a = cell(time, track)}
                                {@const app = a?.applicationId ? applicationsById.get(a.applicationId) : undefined}
                                <td class="slot {a?.state ?? 'none'}" data-id={a?.id}>
                                    {#if a}
                                        <span class="badge {a.state}">{APPOINTMENT_STATE_LABEL[a.state]}</span>
                                        {#if multipleProcedures}<small class="muted">{procedureTitle(a.procedureId)}</small>{/if}
                                        {#if a.state === 'booked' || a.state === 'done'}
                                            <div class="who">{app?.childName ?? a.nameCustomer ?? ''}</div>
                                            {#if app?.childName && a.nameCustomer}<small class="muted">{a.nameCustomer}</small>{/if}
                                            {#if app}<div><span class="badge state-{app.state}">{APPLICATION_STATE_LABEL[app.state]}</span></div>{/if}
                                            <div class="actions">
                                                {#if a.applicationId}<button onclick={() => (openId = a.applicationId)}>Öffnen</button>{/if}
                                                {#if a.state === 'booked' && app && ['created', 'form_in_progress', 'submitted'].includes(app.state)}
                                                    <button class="secondary" onclick={() => arrived(a)} disabled={busy}>Erschienen</button>
                                                {/if}
                                                {#if a.state === 'booked'}
                                                    <button class="secondary" onclick={() => cancel(a)} disabled={busy}>Absage</button>
                                                {/if}
                                            </div>
                                        {/if}
                                    {/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </section>
{/if}

<style>
    .day {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
    }
    .day h2 {
        margin-right: 1rem;
    }
    .grid th[scope='row'] {
        white-space: nowrap;
    }
    .slot {
        min-width: 11rem;
    }
    .slot.available {
        background: #f6fbf7;
    }
    .slot.done {
        background: #f4f4f4;
    }
    .who {
        font-weight: 600;
        margin-top: 0.2rem;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        margin-top: 0.3rem;
    }
</style>
