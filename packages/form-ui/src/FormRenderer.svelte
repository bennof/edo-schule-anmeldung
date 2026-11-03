<!--
  Renders a FormDefinition (backlog C3/C4). `data` must be a $state object;
  the renderer edits it in place. In secretariat mode every item is shown,
  including items hidden by conditions in the public form.
-->
<script lang="ts">
    import { isVisible, validateForm, type FormData, type FormJson, type Option } from '@anmeldung/forms';
    import { SvelteSet } from 'svelte/reactivity';
    import { setFormContext, type FileHandler, type RenderMode } from './context.ts';
    import Items from './Items.svelte';

    interface Props {
        form: FormJson;
        data: FormData;
        mode?: RenderMode;
        /** show all validation messages, e.g. after a submit attempt */
        showAllErrors?: boolean;
        loadOptions?: (source: string) => Promise<Option[]>;
        /** storage for file fields; without it uploads are disabled (e.g. previews) */
        files?: FileHandler;
    }

    let { form, data, mode = 'public', showAllErrors = false, loadOptions, files }: Props = $props();

    const errors = $derived(new Map(validateForm(form, data).map((e) => [e.path, e.message])));
    const touched = new SvelteSet<string>();

    setFormContext({
        get form() {
            return form;
        },
        get mode() {
            return mode;
        },
        get errors() {
            return errors;
        },
        get showAllErrors() {
            return showAllErrors;
        },
        touched,
        get loadOptions() {
            return loadOptions;
        },
        get files() {
            return files;
        },
    });
</script>

<div class="form" class:secretariat={mode === 'secretariat'}>
    {#each form.sections as section (section.id)}
        {@const visible = isVisible(section, { local: data, root: data })}
        {#if visible || mode === 'secretariat'}
            <section class:hidden-public={!visible} data-section={section.id}>
                <h2>{section.title}</h2>
                {#if !visible}<p class="hidden-note">Im Online-Formular ausgeblendet</p>{/if}
                {#if section.description}<p class="description">{section.description}</p>{/if}
                <Items items={section.items} local={data} root={data} base="" />
            </section>
        {/if}
    {/each}
</div>

<style>
    .form {
        display: grid;
        gap: 1.5rem;
    }
    section {
        border: 1px solid var(--form-section-border, #ccc);
        border-radius: var(--form-section-radius, 6px);
        padding: var(--form-section-padding, 0.5rem 1rem 1rem);
    }
    h2 {
        font-size: 1.2rem;
    }
    .description {
        color: var(--form-muted, #555);
    }
    .hidden-public {
        border-style: dashed;
        background: var(--form-surface, #fafafa);
    }
    :global(.form .hidden-note) {
        color: var(--form-warn, #8a6d00);
        font-size: 0.85rem;
        margin: 0.2rem 0;
    }
</style>
