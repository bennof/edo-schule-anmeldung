<!-- Public registration flow: appointment -> contact data -> booking -> form
     (backlog G2-G4). Submission of the form follows in Sprint 4. -->
<script lang="ts">
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, type FormData, type FormJson } from '@anmeldung/forms';
    import { api, ApiError, formatDay, type Booking, type PublicProcedure, type Slot } from './api.ts';
    import SlotPicker from './SlotPicker.svelte';

    interface Props {
        procedure: PublicProcedure;
        /** from the public config entry `consentText` */
        consentText?: string;
    }

    let { procedure, consentText }: Props = $props();
    const FALLBACK_CONSENT = 'Ich bin einverstanden, dass meine Angaben zur Terminvergabe gespeichert werden.';

    type Step = 'slots' | 'contact' | 'booked' | 'form';
    let step: Step = $state('slots');
    let slots: Slot[] = $state([]);
    let loading = $state(true);
    let selected: Slot | undefined = $state();
    let name = $state('');
    let email = $state('');
    let consent = $state(false);
    let error = $state('');
    let busy = $state(false);
    let booking: Booking | undefined = $state();
    let form: FormJson | undefined = $state();
    let data: FormData = $state({});

    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const contactValid = $derived(name.trim().length >= 2 && EMAIL.test(email.trim()) && consent);

    async function loadSlots(): Promise<void> {
        loading = true;
        try {
            slots = await api.slots(procedure.id);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
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
            booking = await api.book(selected.id, name.trim(), email.trim());
            step = 'booked';
        } catch (err) {
            if (err instanceof ApiError && err.code === 'limit') {
                error = err.message;
            } else if (err instanceof ApiError && err.code === 'taken') {
                error = 'Dieser Termin wurde gerade vergeben. Bitte wählen Sie einen anderen Termin.';
                step = 'slots';
                await loadSlots();
            } else {
                error = err instanceof Error ? err.message : String(err);
            }
        } finally {
            busy = false;
        }
    }

    async function openForm(): Promise<void> {
        busy = true;
        try {
            form = (await api.form(procedure.id)).form;
            data = initialData(form);
            step = 'form';
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    const when = (s: { datetime: string }) => `${formatDay(s.datetime.slice(0, 10))}, ${s.datetime.slice(11)} Uhr`;

    loadSlots();
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if step === 'slots'}
    {#if loading}<p>Termine werden geladen …</p>{:else}<SlotPicker {slots} onselect={choose} />{/if}
{:else if step === 'contact' && selected}
    <h2>Termin buchen</h2>
    <p class="chosen">Gewählter Termin: <strong>{when(selected)}</strong></p>
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
{:else if step === 'booked' && booking}
    <h2>Ihr Termin ist gebucht</h2>
    <p class="chosen"><strong>{when(booking)}</strong></p>
    <p>Bitte füllen Sie jetzt das Anmeldeformular aus.</p>
    <button onclick={openForm} disabled={busy}>Weiter zum Anmeldeformular</button>
{:else if step === 'form' && form && booking}
    <h2>{form.title}</h2>
    <p class="chosen">Ihr Termin: {when(booking)}</p>
    <p class="notice">Testversion: Das Absenden des Formulars ist noch nicht möglich.</p>
    <FormRenderer {form} {data} />
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
    .notice {
        background: #fff3cd;
        padding: 0.5rem 0.75rem;
        border-radius: 4px;
    }
</style>
