<!-- Form designer (backlog D2): the preview is the work surface. Clicking a
     section, field or group selects it; its settings are in the sidebar on
     the right. Saving creates a new version (D3); existing versions are
     never changed. -->
<script lang="ts">
    import { untrack } from 'svelte';
    import { FormRenderer, type DesignContainer, type DesignHooks, type DesignTarget } from '@anmeldung/form-ui';
    import { clone, initialData, type FormJson, type Item } from '@anmeldung/forms';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { errorText, formService, loadOptions } from '../../services.ts';
    import { addField, addGroupDefinition, addGroupItem, addSection, itemsOf, move, remove, renameGroup, unusedGroups } from './designer.ts';
    import ItemEditor from './ItemEditor.svelte';

    interface Props {
        /** definition to start from (copied) */
        initial: FormJson;
        /** form family; undefined starts a new form (version 1) */
        formKey?: string;
        /** suggested version label */
        nextVersion: string;
        onsaved: (id: string) => void;
        oncancel: () => void;
    }

    let { initial, formKey, nextVersion, onsaved, oncancel }: Props = $props();

    type Selection = { kind: 'form' } | DesignTarget | { kind: 'groupdef'; name: string };

    // svelte-ignore state_referenced_locally
    let form: FormJson = $state(clone(initial));
    let selected = $state<Selection>({ kind: 'form' });
    let previewData = $state({});
    let busy = $state(false);
    let message = $state('');
    let groupName = $state('');

    const problems = $derived(validateFormDefinition($state.snapshot(form)));
    const unused = $derived(unusedGroups(form));
    const selectedItem = $derived(selected.kind === 'item' ? itemsOf(form, selected.container)[selected.index] : undefined);
    const siblings = $derived(
        selected.kind !== 'item' ? [] : selected.container.type === 'section' ? form.sections.flatMap((s) => s.items) : itemsOf(form, selected.container),
    );

    // fresh preview data whenever the structure changes
    $effect(() => {
        if (!problems.length) previewData = initialData($state.snapshot(form));
    });

    const same = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);
    const kindLabel = (item: Item) => (item.kind === 'group' ? `Gruppe ${item.group}` : item.type);

    const design: DesignHooks = {
        isSelected: (t) => same(t, selected),
        select: (t) => (selected = t),
        tools,
        add,
    };

    function selectGroupDef(name: string): void {
        selected = { kind: 'groupdef', name };
        groupName = name;
    }

    function moveTarget(t: DesignTarget, delta: -1 | 1): void {
        selected = t.kind === 'section' ? { ...t, index: move(form.sections, t.index, delta) } : { ...t, index: move(itemsOf(form, t.container), t.index, delta) };
    }

    function removeTarget(t: DesignTarget): void {
        if (t.kind === 'section') remove(form.sections, t.index);
        else remove(itemsOf(form, t.container), t.index);
        selected = { kind: 'form' };
    }

    // free text, e.g. "2026/27" or "Entwurf Mai"; must be new within the form
    let versionLabel = $state(untrack(() => nextVersion));

    async function save(): Promise<void> {
        if (problems.length || !versionLabel.trim()) return;
        busy = true;
        message = '';
        try {
            const saved = await formService.saveVersion($state.snapshot(form), formKey, versionLabel);
            onsaved(saved.id);
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }
</script>

{#snippet tools(t: DesignTarget)}
    {@const what = t.kind === 'section' ? 'Abschnitt' : 'Element'}
    <button type="button" class="icon" onclick={() => moveTarget(t, -1)} aria-label="{what} nach oben" title="nach oben">↑</button>
    <button type="button" class="icon" onclick={() => moveTarget(t, 1)} aria-label="{what} nach unten" title="nach unten">↓</button>
    <button
        type="button"
        class="icon"
        onclick={() => removeTarget(t)}
        aria-label="{what} entfernen"
        title="entfernen"
        disabled={t.kind === 'section' && form.sections.length < 2}>✕</button
    >
{/snippet}

{#snippet add(container: DesignContainer)}
    <button type="button" class="secondary small" onclick={() => (selected = { kind: 'item', container, index: addField(form, container) })}>+ Feld</button>
    <button type="button" class="secondary small" onclick={() => (selected = { kind: 'item', container, index: addGroupItem(form, container) })}>+ Gruppe</button>
{/snippet}

<section class="designer">
    <header class="bar">
        <button class="secondary" onclick={oncancel}>← Abbrechen</button>
        <h2>Form-Designer</h2>
        <label class="version">Version <input bind:value={versionLabel} placeholder="z. B. 2026/27" /></label>
        <button onclick={save} disabled={busy || problems.length > 0 || !versionLabel.trim()}>Speichern</button>
    </header>
    {#if message}<p class="error">{message}</p>{/if}
    {#if problems.length}
        <details class="problems" open>
            <summary class="error">{problems.length} Problem(e) – Speichern erst nach Korrektur möglich</summary>
            <ul>{#each problems as p}<li>{p}</li>{/each}</ul>
        </details>
    {/if}

    <div class="workspace">
        <div class="canvas" role="region" aria-label="Formular-Arbeitsfläche">
            <button type="button" class="form-title" class:selected={selected.kind === 'form'} onclick={() => (selected = { kind: 'form' })}>
                {form.title || 'Ohne Titel'}
            </button>
            <svelte:boundary>
                {#key JSON.stringify(form)}
                    <FormRenderer form={$state.snapshot(form)} data={previewData} mode="secretariat" {loadOptions} {design} />
                {/key}
                {#snippet failed()}
                    <p class="muted">Die Vorschau erscheint wieder, sobald die Probleme behoben sind.</p>
                {/snippet}
            </svelte:boundary>
            <button type="button" class="secondary small" onclick={() => (selected = { kind: 'section', index: addSection(form) })}>+ Abschnitt</button>
        </div>

        <aside class="props" aria-label="Einstellungen">
            {#if selected.kind === 'form'}
                <h3>Formular</h3>
                <label>Titel <input bind:value={form.title} /></label>
                <label
                    >Vortext <textarea
                        rows="8"
                        value={form.description ?? ''}
                        oninput={(e) => {
                            if (e.currentTarget.value) form.description = e.currentTarget.value;
                            else delete form.description;
                        }}
                    ></textarea></label
                >
                <p class="muted">Erscheint im Online-Formular vor dem ersten Abschnitt. Leerzeilen trennen Absätze.</p>
                <p class="muted">
                    Gespeichert wird als neue Version{formKey ? ` (Formular-Schlüssel ${formKey})` : ' eines neuen Formulars'}. Bestehende Anmeldungen behalten ihre
                    Version.
                </p>
                <h3>Gruppen-Definitionen</h3>
                <p class="muted">Eine Gruppe wird einmal definiert und kann mehrfach verwendet werden (z. B. zwei Erziehungsberechtigte).</p>
                <ul class="list">
                    {#each Object.keys(form.groups ?? {}) as name (name)}
                        <li>
                            <button type="button" class="link" onclick={() => selectGroupDef(name)}>{name}</button>
                            {#if unused.includes(name)}<small class="muted">unbenutzt</small>{/if}
                        </li>
                    {/each}
                </ul>
                <button type="button" class="secondary small" onclick={() => selectGroupDef(addGroupDefinition(form))}>+ Gruppe definieren</button>
            {:else if selected.kind === 'section'}
                {@const section = form.sections[selected.index]}
                {#if section}
                    <h3>Abschnitt</h3>
                    <label>ID <input bind:value={section.id} /></label>
                    <label>Titel <input bind:value={section.title} /></label>
                    <label
                        >Beschreibung <textarea
                            rows="3"
                            value={section.description ?? ''}
                            oninput={(e) => {
                                if (e.currentTarget.value) section.description = e.currentTarget.value;
                                else delete section.description;
                            }}
                        ></textarea></label
                    >
                {/if}
            {:else if selected.kind === 'groupdef'}
                {@const def = form.groups?.[selected.name]}
                {@const container = { type: 'group', name: selected.name } as const}
                {#if def}
                    <h3>Gruppen-Definition</h3>
                    <label>
                        Name
                        <input
                            bind:value={groupName}
                            onchange={() => {
                                renameGroup(form, container.name, groupName);
                                selectGroupDef(groupName);
                            }}
                        />
                    </label>
                    <h3>Felder der Gruppe</h3>
                    <ul class="list">
                        {#each def.items as item, index (index)}
                            <li>
                                <button type="button" class="link" onclick={() => (selected = { kind: 'item', container, index })}>{item.label}</button>
                                <small class="muted">{kindLabel(item)}</small>
                            </li>
                        {/each}
                    </ul>
                    <p class="actions">{@render add(container)}</p>
                    {#if unused.includes(container.name)}
                        <button
                            type="button"
                            class="secondary small"
                            onclick={() => {
                                delete form.groups![container.name];
                                selected = { kind: 'form' };
                            }}>Gruppen-Definition entfernen</button
                        >
                    {:else}
                        <p class="muted">Wird im Formular verwendet und kann daher nicht entfernt werden.</p>
                    {/if}
                {/if}
            {:else if selectedItem}
                {@const t = selected as Extract<DesignTarget, { kind: 'item' }>}
                <h3>{selectedItem.kind === 'group' ? 'Gruppe' : 'Feld'}</h3>
                {#if t.container.type === 'group'}
                    <p class="note">Teil der Gruppe „{t.container.name}“: Änderungen gelten für alle Stellen, an denen die Gruppe verwendet wird.</p>
                {/if}
                {#key JSON.stringify(selected)}
                    <ItemEditor bind:form container={t.container} index={t.index} {siblings} />
                {/key}
                {#if selectedItem.kind === 'group'}
                    {@const name = selectedItem.group}
                    <button type="button" class="secondary small" onclick={() => selectGroupDef(name)}>Gruppe „{name}“ bearbeiten</button>
                {/if}
            {/if}
        </aside>
    </div>
</section>

<style>
    /* the designer uses the full width of the content area */
    :global(.content:has(.designer)) {
        max-width: 100rem;
    }
    .bar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
    }
    .version {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }
    .version input {
        width: 10rem;
    }
    .bar h2 {
        margin: 0;
        font-size: 1.2rem;
        flex: 1;
    }
    .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 22rem;
        gap: 1.5rem;
        margin-top: 0.75rem;
        align-items: start;
    }
    .canvas {
        display: grid;
        gap: 1rem;
        min-width: 0;
    }
    .canvas > button {
        justify-self: start;
    }
    .form-title {
        background: none;
        border: none;
        border-radius: var(--radius);
        color: inherit;
        font-size: 1.4rem;
        font-weight: 600;
        padding: 0.2rem 0.4rem;
    }
    .form-title:hover {
        background: var(--surface);
    }
    .form-title.selected {
        outline: 2px solid var(--accent);
    }
    .props {
        position: sticky;
        top: 1rem;
        display: grid;
        gap: 0.5rem;
        max-height: calc(100vh - 2rem);
        overflow: auto;
        background: var(--surface);
        border-radius: var(--radius-lg);
        padding: 1rem;
    }
    .props label {
        display: grid;
        gap: 0.15rem;
    }
    h3 {
        font-size: 0.95rem;
        margin: 0.5rem 0 0.25rem;
    }
    .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.2rem;
    }
    .link {
        background: none;
        border: none;
        color: inherit;
        padding: 0.1rem 0;
        text-decoration: underline;
    }
    .note {
        background: var(--info-bg);
        border-radius: var(--radius);
        padding: 0.5rem 0.75rem;
        margin: 0;
        font-size: 0.9rem;
    }
    .actions {
        display: flex;
        gap: 0.4rem;
        margin: 0;
    }
    .icon {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        padding: 0 0.4rem;
        font-size: 0.85rem;
    }
    .small {
        padding: 0.15rem 0.6rem;
        font-size: 0.85rem;
    }
    .problems ul {
        margin: 0.25rem 0;
        font-size: 0.85rem;
    }
    @media (max-width: 1000px) {
        .workspace {
            grid-template-columns: 1fr;
        }
        .props {
            position: static;
            max-height: none;
        }
    }
</style>
