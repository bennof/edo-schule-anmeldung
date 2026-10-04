<!-- Full secretariat editing of one application (backlog J3-J6, K3, K5):
     all form fields, comments, autosave with conflict detection, explicit
     state transitions. -->
<script lang="ts">
    import type { Application, ApplicationState, Appointment } from '@anmeldung/domain';
    import { FormRenderer } from '@anmeldung/form-ui';
    import { normalizeData, optionSources, withoutHidden, type FormData, type FormJson } from '@anmeldung/forms';
    import fontUrl from '@anmeldung/pdf/fonts/DejaVuSans.ttf?url';
    import { ConflictError } from '@anmeldung/sharepoint';
    import { APPLICATION_STATE_LABEL, formatDateTime } from '../labels.ts';
    import { applicationService, appointments, errorText, forms, loadOptions, procedures, site } from '../services.ts';

    interface Props {
        applicationId: string;
        onclose: () => void;
        /** called after a state change, e.g. to refresh a list */
        onchange?: () => void;
    }

    let { applicationId, onclose, onchange }: Props = $props();

    const AUTOSAVE_DELAY = 1500;

    /** next step offered for each state (K5); checked -> ready_for_svws only explicitly */
    const NEXT: Partial<Record<ApplicationState, { to: ApplicationState; label: string; confirm?: string }>> = {
        created: { to: 'interview', label: 'Gespräch angetreten' },
        form_in_progress: { to: 'interview', label: 'Gespräch angetreten' },
        submitted: { to: 'interview', label: 'Gespräch angetreten' },
        interview: { to: 'in_review', label: 'Prüfung beginnen' },
        in_review: { to: 'checked', label: 'Als geprüft markieren' },
        checked: {
            to: 'ready_for_svws',
            label: 'Für SVWS freigeben',
            confirm: 'Liegt der unterschriebene Anmeldebogen vor? Die Anmeldung wird für die Übernahme nach SVWS freigegeben.',
        },
    };

    let application: Application | undefined = $state();
    let eTag = '';
    let form: FormJson | undefined = $state();
    let procedureTitle = $state('');
    let appointment: Appointment | undefined = $state();
    let data: FormData = $state({});
    let secretariatComment = $state('');
    let interviewerComment = $state('');
    let error = $state('');

    type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
    let saveStatus: SaveStatus = $state('saved');
    let savedAt: Date | undefined = $state();
    let savedJson = '';
    let busy = $state(false);

    const snapshot = () => JSON.stringify({ data, secretariatComment, interviewerComment });

    async function load(): Promise<void> {
        error = '';
        const loaded = await applicationService.load(applicationId);
        const definition = await forms.get(loaded.application.formId);
        if (!definition) throw new Error(`Formular ${loaded.application.formId} nicht gefunden`);
        const [procedure, [linked]] = await Promise.all([
            procedures.get(loaded.application.procedureId),
            appointments.repo.list(appointments.repo.filter('applicationId', applicationId)),
        ]);
        application = loaded.application;
        eTag = loaded.eTag;
        form = definition.formJson as FormJson;
        procedureTitle = procedure?.info.title ?? '';
        appointment = linked;
        data = normalizeData(form, (loaded.application.data ?? {}) as FormData);
        secretariatComment = loaded.application.secretariatComment ?? '';
        interviewerComment = loaded.application.interviewerComment ?? '';
        savedJson = snapshot();
        saveStatus = 'saved';
    }

    // J5: debounced autosave of form data and comments
    $effect(() => {
        if (!application) return;
        const json = snapshot();
        if (json === savedJson || saveStatus === 'conflict' || saveStatus === 'saving') return;
        saveStatus = 'pending';
        const timer = setTimeout(save, AUTOSAVE_DELAY);
        return () => clearTimeout(timer);
    });

    async function save(): Promise<void> {
        if (!application || saveStatus === 'saving' || saveStatus === 'conflict') return;
        const json = snapshot();
        if (json === savedJson) {
            saveStatus = 'saved';
            return;
        }
        saveStatus = 'saving';
        try {
            const values = JSON.parse(json);
            eTag = await applicationService.save(application.id, values, eTag);
            savedJson = json;
            savedAt = new Date();
            // changes made while saving trigger the effect again
            saveStatus = snapshot() === savedJson ? 'saved' : 'pending';
        } catch (e) {
            saveStatus = e instanceof ConflictError ? 'conflict' : 'error';
            error = errorText(e);
        }
    }

    async function advance(): Promise<void> {
        if (!application) return;
        const step = NEXT[application.state];
        if (!step || (step.confirm && !confirm(step.confirm))) return;
        busy = true;
        try {
            await save();
            if (saveStatus === 'conflict' || saveStatus === 'error') return;
            eTag =
                step.to === 'interview'
                    ? await applicationService.markInterview(application.id, eTag)
                    : await applicationService.transition(application.id, step.to, eTag);
            await load();
            onchange?.();
        } catch (e) {
            if (e instanceof ConflictError) saveStatus = 'conflict';
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    /** I5: the same registration form PDF, from the current data. */
    async function downloadPdf(): Promise<void> {
        if (!application || !form) return;
        busy = true;
        try {
            const { fillRegistrationPdf, saveAs, pdfFileName, PDF_TEMPLATE_KEY } = await import('@anmeldung/pdf');
            const [template, font] = await Promise.all([
                site.getAsset(PDF_TEMPLATE_KEY).then((b) => b?.arrayBuffer()),
                fetch(fontUrl).then((r) => r.arrayBuffer()),
            ]);
            if (!template) {
                error = 'Keine PDF-Vorlage vorhanden. Unter „Dateien“ den Standard-Anmeldebogen hochladen.';
                return;
            }
            const sources = optionSources(form);
            const lists = await Promise.all(sources.map((s) => loadOptions(s)));
            const bytes = await fillRegistrationPdf({
                template,
                font,
                form,
                data: withoutHidden(form, $state.snapshot(data)),
                options: Object.fromEntries(sources.map((s, i) => [s, lists[i]])),
                extra: {
                    'anmeldung.termin': appointment ? formatDateTime(appointment.datetime) : '',
                    'anmeldung.nummer': application.id,
                    'anmeldung.kontakt': [application.contactName, application.contactEmail].filter(Boolean).join(', '),
                },
            });
            saveAs(bytes, pdfFileName(application.childName));
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    async function close(): Promise<void> {
        if (saveStatus === 'pending') await save();
        if ((saveStatus === 'error' || saveStatus === 'conflict') && !confirm('Änderungen sind nicht gespeichert. Trotzdem schließen?')) return;
        onclose();
    }

    function warnUnsaved(e: BeforeUnloadEvent): void {
        if (saveStatus !== 'saved') e.preventDefault();
    }

    load().catch((e) => (error = errorText(e)));
</script>

<svelte:window onbeforeunload={warnUnsaved} />

<section class="editor">
    <header class="bar">
        <button class="secondary" onclick={close}>← Zurück</button>
        <h2>{application?.childName ?? 'Anmeldung'} <small class="muted">#{applicationId}</small></h2>
        {#if application}
            <span class="badge state-{application.state}" data-testid="application-state">{APPLICATION_STATE_LABEL[application.state]}</span>
            {#if NEXT[application.state]}
                <button onclick={advance} disabled={busy}>{NEXT[application.state]?.label}</button>
            {/if}
        {/if}
        {#if application}<button class="secondary" onclick={downloadPdf} disabled={busy}>Anmeldebogen (PDF)</button>{/if}
        <span class="save {saveStatus}" role="status" data-testid="save-status">
            {#if saveStatus === 'saved'}{savedAt ? `Gespeichert ${savedAt.toLocaleTimeString('de-DE')}` : 'Alles gespeichert'}
            {:else if saveStatus === 'pending'}Ungespeicherte Änderungen …
            {:else if saveStatus === 'saving'}Speichert …
            {:else if saveStatus === 'conflict'}Konflikt
            {:else}Nicht gespeichert{/if}
        </span>
    </header>

    {#if error}
        <p class="error" role="alert">
            {error}
            {#if saveStatus === 'conflict'}
                <button class="secondary" onclick={() => load().catch((e) => (error = errorText(e)))}>Neu laden (eigene Änderungen verwerfen)</button>
            {:else if saveStatus === 'error'}
                <button class="secondary" onclick={save}>Erneut speichern</button>
            {/if}
        </p>
    {/if}

    {#if application}
        <dl class="facts">
            <dt>Verfahren</dt><dd>{procedureTitle}</dd>
            <dt>Termin</dt>
            <dd>{appointment ? `${formatDateTime(appointment.datetime)}${appointment.verantwortlicherId ? ` · ${appointment.verantwortlicherId}` : ''}` : 'kein Termin'}</dd>
            <dt>Kontakt</dt><dd>{application.contactName ?? '–'} {#if application.contactEmail}<small class="muted">{application.contactEmail}</small>{/if}</dd>
            <dt>Online abgeschickt</dt><dd>{application.submittedAt ? new Date(application.submittedAt).toLocaleString('de-DE') : 'nein'}</dd>
        </dl>

        <div class="comments">
            <label>Kommentar Sekretariat <textarea bind:value={secretariatComment} rows="3"></textarea></label>
            <label>Kommentar Gesprächsführung <textarea bind:value={interviewerComment} rows="3"></textarea></label>
        </div>

        {#if form}
            {#key application.id}
                <FormRenderer {form} {data} mode="secretariat" {loadOptions} />
            {/key}
        {/if}
    {:else if !error}
        <p>Wird geladen …</p>
    {/if}
</section>

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
        z-index: 2;
        border-bottom: 1px solid #eee;
    }
    .bar h2 {
        margin: 0;
        font-size: 1.25rem;
    }
    .save {
        margin-left: auto;
        font-size: 0.9rem;
        color: #555;
    }
    .save.error,
    .save.conflict {
        color: #b00020;
        font-weight: 600;
    }
    .facts {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.2rem 1rem;
    }
    .facts dt {
        color: #555;
    }
    .facts dd {
        margin: 0;
    }
    .comments {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        margin: 1rem 0;
    }
    .comments label {
        display: grid;
        gap: 0.2rem;
    }
    :global(.badge) {
        padding: 0.1rem 0.55rem;
        border-radius: 999px;
        background: #eee;
        font-size: 0.85rem;
        white-space: nowrap;
    }
    :global(.badge.state-submitted),
    :global(.badge.booked) {
        background: #dde8fb;
    }
    :global(.badge.state-interview),
    :global(.badge.state-in_review) {
        background: #fff3cd;
    }
    :global(.badge.state-checked),
    :global(.badge.state-ready_for_svws),
    :global(.badge.available) {
        background: #dff3e4;
    }
</style>
