<!-- Public registration flow (backlog G2-G5): appointment -> contact data ->
     booking -> form -> submission. A stored session resumes at the form. -->
<script lang="ts">
    import { FormRenderer } from '@anmeldung/form-ui';
    import { normalizeData, validateForm, withoutHidden, type FormData, type FormJson } from '@anmeldung/forms';
    import { api, ApiError, formatDay, loadOptions, type PublicProcedure, type Slot } from './api.ts';
    import { session, type Session } from './session.ts';
    import SlotPicker from './SlotPicker.svelte';
    import { untrack } from 'svelte';

    interface Props {
        procedure: PublicProcedure;
        /** from the public config entry `consentText` */
        consentText?: string;
        /** continue a booking made earlier on this device */
        resume?: Session;
    }

    let { procedure, consentText, resume }: Props = $props();
    // the session only sets the starting point; the component is keyed per procedure
    const resumed = untrack(() => resume);
    const FALLBACK_CONSENT = 'Ich bin einverstanden, dass meine Angaben zur Terminvergabe gespeichert werden.';

    type Step = 'slots' | 'contact' | 'booked' | 'form' | 'submitted';
    let step: Step = $state(resumed ? 'booked' : 'slots');
    let current: Session | undefined = $state(resumed);
    let slots: Slot[] = $state([]);
    let loading = $state(!resumed);
    let selected: Slot | undefined = $state();
    let name = $state('');
    let email = $state('');
    let consent = $state(false);
    let error = $state('');
    let busy = $state(false);
    let form: FormJson | undefined = $state();
    let data: FormData = $state({});
    let submitAttempted = $state(false);
    let keepOnDevice = $state(session.isPersistent());

    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const contactValid = $derived(name.trim().length >= 2 && EMAIL.test(email.trim()) && consent);
    const formErrors = $derived(form ? validateForm(form, data) : []);

    // keep a local draft while the form is filled in
    $effect(() => {
        if (step !== 'form' || !current) return;
        const json = JSON.stringify(data);
        const id = current.applicationId;
        const persistent = keepOnDevice;
        const timer = setTimeout(() => session.saveDraft(id, JSON.parse(json), persistent), 400);
        return () => clearTimeout(timer);
    });

    async function loadSlots(): Promise<void> {
        loading = true;
        try {
            slots = await api.slots(procedure.id);
        } catch (e) {
            error = message(e);
        } finally {
            loading = false;
        }
    }

    function choose(slot: Slot): void {
        selected = slot;
        error = '';
        step = 'contact';
    }

    async function book(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (!selected || !contactValid) return;
        busy = true;
        error = '';
        try {
            const booking = await api.book(selected.id, name.trim(), email.trim());
            if (booking.applicationId && booking.token) {
                current = { applicationId: booking.applicationId, token: booking.token, procedureId: booking.procedureId, datetime: booking.datetime };
                session.save(current, keepOnDevice);
            } else {
                error = 'Ihr Termin ist gebucht, das Formular konnte aber nicht vorbereitet werden. Bitte wenden Sie sich an das Sekretariat.';
            }
            selected = { id: booking.id, datetime: booking.datetime };
            step = 'booked';
        } catch (err) {
            if (err instanceof ApiError && err.code === 'taken') {
                error = 'Dieser Termin wurde gerade vergeben. Bitte wählen Sie einen anderen Termin.';
                step = 'slots';
                await loadSlots();
            } else {
                error = message(err);
            }
        } finally {
            busy = false;
        }
    }

    async function openForm(): Promise<void> {
        if (!current) return;
        busy = true;
        error = '';
        try {
            const [{ form: definition }] = await Promise.all([
                api.applicationForm(current.applicationId, current.token),
                api.start(current.applicationId, current.token),
            ]);
            form = definition;
            data = normalizeData(definition, session.loadDraft(current.applicationId) ?? {});
            step = 'form';
        } catch (e) {
            if (e instanceof ApiError && e.code === 'already_submitted') {
                session.clear();
                step = 'submitted';
            } else {
                error = message(e);
            }
        } finally {
            busy = false;
        }
    }

    async function submit(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        if (!form || !current) return;
        submitAttempted = true;
        error = '';
        if (formErrors.length) {
            document.querySelector(`[data-path="${CSS.escape(formErrors[0].path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        busy = true;
        try {
            await api.submit(current.applicationId, current.token, withoutHidden(form, $state.snapshot(data)));
            session.clear();
            step = 'submitted';
        } catch (err) {
            if (err instanceof ApiError && err.code === 'already_submitted') {
                session.clear();
                step = 'submitted';
            } else {
                error = message(err);
            }
        } finally {
            busy = false;
        }
    }

    function message(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    function toggleKeep(): void {
        session.setPersistent(keepOnDevice);
    }

    const when = (datetime: string) => `${formatDay(datetime.slice(0, 10))}, ${datetime.slice(11)} Uhr`;

    if (!resumed) loadSlots();
</script>

{#snippet keepOption()}
    <label class="keep">
        <input type="checkbox" bind:checked={keepOnDevice} onchange={toggleKeep} />
        <span>
            Eingaben auf diesem Gerät speichern, bis die Anmeldung abgeschickt ist.
            <small>Nicht an gemeinsam genutzten Geräten verwenden. Ohne Häkchen bleiben die Eingaben nur erhalten, solange dieser Browser-Tab geöffnet ist.</small>
        </span>
    </label>
{/snippet}

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if step === 'slots'}
    {#if loading}<p>Termine werden geladen …</p>{:else}<SlotPicker {slots} onselect={choose} />{/if}
{:else if step === 'contact' && selected}
    <h2>Termin buchen</h2>
    <p class="chosen">Gewählter Termin: <strong>{when(selected.datetime)}</strong></p>
    <form class="contact" onsubmit={book} novalidate>
        <label>Name (sorgeberechtigte Person) <input bind:value={name} autocomplete="name" required /></label>
        <label>E-Mail-Adresse <input type="email" bind:value={email} autocomplete="email" required /></label>
        <label class="consent">
            <input type="checkbox" bind:checked={consent} />
            <span data-testid="consent-text">{consentText?.trim() || FALLBACK_CONSENT}</span>
        </label>
        <p>
            <button type="submit" disabled={busy || !contactValid}>Termin verbindlich buchen</button>
            <button type="button" class="secondary" onclick={() => (step = 'slots')} disabled={busy}>Anderen Termin wählen</button>
        </p>
    </form>
{:else if step === 'booked'}
    <h2>{resumed ? 'Willkommen zurück' : 'Ihr Termin ist gebucht'}</h2>
    {#if current}
        <p class="chosen"><strong>{when(current.datetime)}</strong></p>
        <p>Bitte füllen Sie jetzt das Anmeldeformular aus.</p>
        {@render keepOption()}
        <button onclick={openForm} disabled={busy}>{resumed ? 'Anmeldeformular fortsetzen' : 'Weiter zum Anmeldeformular'}</button>
    {:else if selected}
        <p class="chosen"><strong>{when(selected.datetime)}</strong></p>
    {/if}
{:else if step === 'form' && form && current}
    <h2>{form.title}</h2>
    <p class="chosen">Ihr Termin: {when(current.datetime)}</p>
    {@render keepOption()}
    <form onsubmit={submit} novalidate>
        <FormRenderer {form} {data} showAllErrors={submitAttempted} {loadOptions} />
        {#if submitAttempted && formErrors.length}
            <p class="error" role="alert">Bitte prüfen Sie die markierten Angaben ({formErrors.length}).</p>
        {/if}
        <p><button type="submit" disabled={busy}>Anmeldung absenden</button></p>
    </form>
{:else if step === 'submitted'}
    <h2>Vielen Dank – Ihre Anmeldung ist eingegangen</h2>
    {#if current}<p class="chosen">Ihr Termin: <strong>{when(current.datetime)}</strong></p>{/if}
    <p>
        Beim Anmeldegespräch wird der ausgedruckte Anmeldebogen von den Erziehungsberechtigten unterschrieben. Bitte bringen
        Sie die im Einladungsschreiben genannten Unterlagen mit.
    </p>
{/if}

<style>
    .contact {
        display: grid;
        gap: 0.75rem;
        max-width: 30rem;
    }
    .contact label {
        display: grid;
        gap: 0.25rem;
    }
    .contact label.consent {
        display: flex;
        gap: 0.5rem;
        align-items: start;
    }
    .chosen {
        font-size: 1.1rem;
    }
    .keep {
        display: flex;
        gap: 0.5rem;
        align-items: start;
        background: #f4f6fa;
        padding: 0.6rem 0.8rem;
        border-radius: 4px;
        margin: 0.75rem 0 1rem;
    }
    .keep small {
        display: block;
        color: #555;
    }
</style>
