<!-- Development preview of the form renderer with the bundled test form.
     Replaced by the real flow (booking -> form -> submission) in Sprint 4. -->
<script lang="ts">
    import { FormRenderer } from '@anmeldung/form-ui';
    import { initialData, validateForm, withoutHidden, type FormJson } from '@anmeldung/forms';
    import testForm from '@anmeldung/forms/examples/test-form.json';

    const form = testForm as FormJson;
    let data = $state(initialData(form));
    let submitted = $state(false);
    let result: string | undefined = $state();

    function submit(e: SubmitEvent): void {
        e.preventDefault();
        submitted = true;
        const errors = validateForm(form, data);
        result = errors.length
            ? `${errors.length} Angabe(n) fehlen oder sind ungültig.`
            : JSON.stringify(withoutHidden(form, data), null, 2);
    }
</script>

<h1>{form.title}</h1>
<p class="muted">Vorschau – es werden keine Daten gespeichert.</p>
<form onsubmit={submit} novalidate>
    <FormRenderer {form} {data} showAllErrors={submitted} />
    <p><button type="submit">Prüfen</button></p>
</form>
{#if result}<pre data-testid="result">{result}</pre>{/if}

<style>
    .muted {
        color: #666;
    }
    pre {
        background: #f4f4f4;
        padding: 1rem;
        overflow-x: auto;
    }
</style>
