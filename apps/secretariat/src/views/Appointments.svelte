<!-- Appointment planning (backlog E2-E5): generate drafts for a procedure,
     edit or delete drafts, publish them for public booking. -->
<script lang="ts">
    import {
        checkScheduleParams,
        generateSchedule,
        type Appointment,
        type AppointmentState,
        type Procedure,
        type ScheduleBreak,
    } from '@anmeldung/domain';
    import { appointments, errorText, procedures } from '../services.ts';

    const STATE_LABEL: Record<AppointmentState, string> = {
        draft: 'Entwurf',
        available: 'Buchbar',
        booked: 'Gebucht',
        done: 'Erledigt',
    };

    let procedureList: Procedure[] = $state([]);
    let procedureId = $state('');
    let list: Appointment[] = $state([]);
    let message = $state('');
    let busy = $state(false);

    // generator
    let date = $state('');
    let start = $state('08:00');
    let end = $state('12:00');
    let intervalMinutes = $state(10);
    let breaks: ScheduleBreak[] = $state([]);
    let verantwortlicheText = $state('');

    // inline editing of a draft
    let editing: { id: string; time: string; verantwortlicher: string } | undefined = $state();

    const verantwortliche = $derived(
        verantwortlicheText
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
    );
    const params = $derived({ procedureId, date, start, end, intervalMinutes, breaks, verantwortliche });
    const paramErrors = $derived(checkScheduleParams(params));
    const existingKeys = $derived(new Set(list.map(slotKey)));
    const preview = $derived.by(() => {
        if (paramErrors.length || !procedureId) return { all: 0, fresh: [] as ReturnType<typeof generateSchedule> };
        const all = generateSchedule(params);
        return { all: all.length, fresh: all.filter((s) => !existingKeys.has(slotKey(s))) };
    });

    const days = $derived.by(() => {
        const map = new Map<string, Appointment[]>();
        for (const a of list) {
            const d = a.datetime.slice(0, 10);
            map.set(d, [...(map.get(d) ?? []), a]);
        }
        return [...map.entries()];
    });
    const counts = $derived(
        Object.fromEntries((Object.keys(STATE_LABEL) as AppointmentState[]).map((s) => [s, list.filter((a) => a.state === s).length])),
    );

    function slotKey(a: { datetime: string; verantwortlicherId?: string }): string {
        return `${a.datetime}|${a.verantwortlicherId ?? ''}`;
    }

    function formatDay(d: string): string {
        return new Date(`${d}T12:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    async function loadProcedures(): Promise<void> {
        procedureList = (await procedures.list()).sort((a, b) => b.startDate.localeCompare(a.startDate));
        procedureId ||= procedureList[0]?.id ?? '';
    }

    async function load(): Promise<void> {
        list = procedureId ? await appointments.listForProcedure(procedureId) : [];
    }

    $effect(() => {
        void procedureId;
        editing = undefined;
        load().catch((e) => (message = `Fehler: ${errorText(e)}`));
    });

    async function run(task: () => Promise<string>): Promise<void> {
        busy = true;
        message = '';
        try {
            message = await task();
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
            await load().catch(() => {});
        }
    }

    const createDrafts = () =>
        run(async () => {
            const fresh = preview.fresh;
            await appointments.createDrafts(fresh);
            const skipped = preview.all - fresh.length;
            return `${fresh.length} Entwürfe angelegt${skipped ? `, ${skipped} bereits vorhandene übersprungen` : ''}.`;
        });

    const drafts = (items: Appointment[]) => items.filter((a) => a.state === 'draft').map((a) => a.id);

    const publish = (items: Appointment[]) =>
        run(async () => {
            const ids = drafts(items);
            await appointments.publish(ids);
            return `${ids.length} Termine veröffentlicht.`;
        });

    const removeDrafts = (items: Appointment[]) => {
        const ids = drafts(items);
        if (!confirm(`${ids.length} Entwürfe löschen?`)) return;
        return run(async () => {
            await appointments.deleteDrafts(ids);
            return `${ids.length} Entwürfe gelöscht.`;
        });
    };

    /** L1: phone cancellation; the application stays */
    const cancelBooking = (a: Appointment) => {
        if (!confirm(`Termin ${a.datetime.slice(11)} Uhr von ${a.nameCustomer ?? 'unbekannt'} freigeben? Die Anmeldung bleibt erhalten.`)) return;
        return run(async () => {
            await appointments.cancelBooking(a.id);
            return 'Termin freigegeben.';
        });
    };

    const saveEdit = () => {
        const e = editing!;
        const a = list.find((x) => x.id === e.id)!;
        return run(async () => {
            await appointments.updateDraft(e.id, {
                datetime: `${a.datetime.slice(0, 10)}T${e.time}`,
                verantwortlicherId: e.verantwortlicher.trim() || undefined,
            });
            editing = undefined;
            return 'Termin geändert.';
        });
    };

    loadProcedures().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

<section>
    <h2>Termine</h2>
    <p class="actions">
        <label for="procedure">Verfahren</label>
        <select id="procedure" bind:value={procedureId}>
            {#each procedureList as p (p.id)}<option value={p.id}>{p.info.title}</option>{/each}
        </select>
    </p>
    {#if !procedureList.length}<p class="muted">Zuerst unter „Verfahren“ ein Verfahren anlegen.</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
</section>

{#if procedureId}
    <section class="generator">
        <h3>Terminplan erzeugen</h3>
        <div class="grid">
            <label>Datum <input type="date" bind:value={date} /></label>
            <label>Anfang <input type="time" bind:value={start} /></label>
            <label>Ende <input type="time" bind:value={end} /></label>
            <label>
                Intervall (Minuten)
                <input type="number" min="1" step="1" bind:value={intervalMinutes} list="intervals" />
                <datalist id="intervals"><option value="5"></option><option value="10"></option><option value="15"></option><option value="20"></option><option value="30"></option></datalist>
            </label>
        </div>
        <label class="wide">
            Verantwortliche / parallele Gespräche (kommagetrennt, optional)
            <input bind:value={verantwortlicheText} placeholder="z. B. Raum 1, Raum 2" />
        </label>
        <div class="breaks">
            <span>Pausen</span>
            {#each breaks as b, i (i)}
                <span class="break">
                    <input type="time" bind:value={b.start} aria-label="Pause von" /> –
                    <input type="time" bind:value={b.end} aria-label="Pause bis" />
                    <button type="button" class="secondary" onclick={() => breaks.splice(i, 1)}>Entfernen</button>
                </span>
            {/each}
            <button type="button" class="secondary" onclick={() => breaks.push({ start: '10:00', end: '10:20' })}>Pause hinzufügen</button>
        </div>
        {#if date && paramErrors.length}
            <p class="error">{paramErrors.join(' · ')}</p>
        {:else if date}
            <p>
                {preview.all} Termine
                {#if preview.all !== preview.fresh.length}({preview.all - preview.fresh.length} davon bereits vorhanden){/if}
            </p>
        {/if}
        <button onclick={createDrafts} disabled={busy || !date || paramErrors.length > 0 || preview.fresh.length === 0}>
            Entwürfe anlegen
        </button>
    </section>

    <section>
        <h3>Terminplan</h3>
        <p class="summary">
            {#each Object.entries(STATE_LABEL) as [state, label] (state)}
                <span class="badge {state}">{label}: {counts[state]}</span>
            {/each}
            {#if counts.draft}
                <button onclick={() => publish(list)} disabled={busy}>Alle Entwürfe veröffentlichen</button>
            {/if}
        </p>
        {#each days as [day, items] (day)}
            <div class="day" data-day={day}>
                <h4>
                    {formatDay(day)}
                    {#if drafts(items).length}
                        <button class="secondary" onclick={() => publish(items)} disabled={busy}>Entwürfe veröffentlichen</button>
                        <button class="secondary" onclick={() => removeDrafts(items)} disabled={busy}>Entwürfe löschen</button>
                    {/if}
                </h4>
                <table>
                    <thead><tr><th>Uhrzeit</th><th>Verantwortlich</th><th>Status</th><th>Gebucht von</th><th></th></tr></thead>
                    <tbody>
                        {#each items as a (a.id)}
                            <tr data-id={a.id}>
                                {#if editing?.id === a.id}
                                    <td><input type="time" bind:value={editing.time} aria-label="Uhrzeit" /></td>
                                    <td><input bind:value={editing.verantwortlicher} aria-label="Verantwortlich" /></td>
                                    <td>{STATE_LABEL[a.state]}</td>
                                    <td></td>
                                    <td>
                                        <button onclick={saveEdit} disabled={busy}>Speichern</button>
                                        <button class="secondary" onclick={() => (editing = undefined)}>Abbrechen</button>
                                    </td>
                                {:else}
                                    <td>{a.datetime.slice(11)}</td>
                                    <td>{a.verantwortlicherId ?? ''}</td>
                                    <td><span class="badge {a.state}">{STATE_LABEL[a.state]}</span></td>
                                    <td>
                                        {#if a.nameCustomer}
                                            {a.nameCustomer} <small class="muted">{a.emailCustomer}</small>
                                            {#if a.requestIp}<br /><small class="muted" title="IP-Adresse der Buchung">IP {a.requestIp}</small>{/if}
                                        {/if}
                                    </td>
                                    <td>
                                        {#if a.state === 'booked'}
                                            <button class="secondary" onclick={() => cancelBooking(a)} disabled={busy}>Absage</button>
                                        {/if}
                                        {#if a.state === 'draft'}
                                            <button class="secondary" onclick={() => (editing = { id: a.id, time: a.datetime.slice(11), verantwortlicher: a.verantwortlicherId ?? '' })} disabled={busy || !!editing}>Ändern</button>
                                            <button class="secondary" onclick={() => removeDrafts([a])} disabled={busy}>Löschen</button>
                                        {/if}
                                    </td>
                                {/if}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {:else}
            <p class="muted">Noch keine Termine für dieses Verfahren.</p>
        {/each}
    </section>
{/if}

<style>
    .generator {
        border: 1px solid #ccc;
        border-radius: 6px;
        padding: 0 1rem 1rem;
    }
    .grid {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
    }
    label {
        display: grid;
        gap: 0.2rem;
    }
    .wide {
        margin: 0.75rem 0;
        max-width: 30rem;
    }
    .breaks {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.75rem;
    }
    .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
    }
    .badge {
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: #eee;
        font-size: 0.85rem;
    }
    .badge.available {
        background: #dff3e4;
    }
    .badge.booked {
        background: #dde8fb;
    }
    .badge.draft {
        background: #fff3cd;
    }
    h4 {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0;
    }
</style>
