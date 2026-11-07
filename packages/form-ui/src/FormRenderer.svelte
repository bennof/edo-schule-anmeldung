<!--
  Renders a FormDefinition (backlog C3/C4). `data` must be a $state object;
  the renderer edits it in place. In secretariat mode every item is shown,
  including items hidden by conditions in the public form. With `design`
  (form designer) sections and items are selectable; keys are positions,
  because ids may be duplicated while a definition is being edited.
-->
<script lang="ts">
    import { isVisible, validateForm, type FormData, type FormJson, type Option } from '@anmeldung/forms';
    import { SvelteSet } from 'svelte/reactivity';
    import { setFormContext, type DesignHooks, type FileHandler, type RenderMode } from './context.ts';
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
        design?: DesignHooks;
    }

    let { form, data, mode = 'public', showAllErrors = false, loadOptions, files, design }: Props = $props();

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
        get design() {
            return design;
        },
    });

    const stop = (e: Event) => e.stopPropagation();
</script>

<div class="form" class:secretariat={mode === 'secretariat'} class:design={!!design}>
    {#if form.description && (mode === 'public' || design)}<p class="intro" data-testid="form-intro">{form.description}</p>{/if}
    {#each form.sections as section, index (design ? index : section.id)}
        {@const visible = isVisible(section, { local: data, root: data })}
        {@const target = { kind: 'section', index } as const}
        {#if visible || mode === 'secretariat' || design}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
            <section
                class:hidden-public={!visible}
                class:selected={design?.isSelected(target)}
                data-section={section.id}
                onclick={design &&
                    ((e) => {
                        e.stopPropagation();
                        design.select(target);
                    })}
            >
                {#if design?.isSelected(target)}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <div class="design-tools" onclick={stop}>{@render design.tools(target)}</div>
                {/if}
                <h2>{section.title}</h2>
                {#if !visible}<p class="hidden-note">Im Online-Formular ausgeblendet</p>{/if}
                {#if section.description}<p class="description">{section.description}</p>{/if}
                <Items items={section.items} local={data} root={data} base="" container={{ type: 'section', index }} />
                {#if design}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <div class="design-add" onclick={stop}>{@render design.add({ type: 'section', index })}</div>
                {/if}
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
        white-space: pre-line;
    }
    .intro {
        margin: 0;
        white-space: pre-line;
    }
    .hidden-public {
        border-style: dashed;
        background: var(--form-surface, #fafafa);
    }
    /* designer: selectable elements, tools on the selected one */
    .design section {
        position: relative;
        cursor: pointer;
    }
    :global(.form.design .selected) {
        outline: 2px solid var(--form-accent, #2563eb);
        outline-offset: 2px;
    }
    :global(.form.design .design-tools) {
        position: absolute;
        top: 0.25rem;
        right: 0.25rem;
        z-index: 1;
        display: flex;
        gap: 0.15rem;
        cursor: default;
    }
    :global(.form.design .design-add) {
        display: flex;
        gap: 0.4rem;
        margin-top: 0.75rem;
        cursor: default;
    }
    :global(.form .hidden-note) {
        color: var(--form-warn, #8a6d00);
        font-size: 0.85rem;
        margin: 0.2rem 0;
    }
</style>
