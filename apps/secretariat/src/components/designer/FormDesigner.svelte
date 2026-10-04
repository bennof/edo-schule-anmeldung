<!-- Form designer (backlog D2): edit sections, fields, groups, order, options,
     validation and conditions with a live preview. Saving creates a new
     version (D3); existing versions are never changed. -->
<script lang="ts">
    import { FormRenderer } from '@anmeldung/form-ui';
    import { clone, initialData, type FormJson, type Item } from '@anmeldung/forms';
    import { validateFormDefinition } from '@anmeldung/forms/validate';
    import { errorText, formService, loadOptions } from '../../services.ts';
    import {
        addField,
        addGroupDefinition,
        addGroupItem,
        addSection,
        itemsOf,
        move,
        remove,
        renameGroup,
        unusedGroups,
        type Container,
    } from './designer.ts';
    import ItemEditor from './ItemEditor.svelte';

    interface Props {
        /** definition to start from (copied); undefined = new form */
        initial: FormJson;
        /** form family; undefined starts a new form (version 1) */
        formKey?: string;
        nextVersion: number;
        onsaved: (id: string) => void;
        oncancel: () => void;
    }

    let { initial, formKey, nextVersion, onsaved, oncancel }: Props = $props();

    type Selection =
        | { kind: 'form' }
        | { kind: 'section'; index: number }
        | { kind: 'item'; container: Container; index: number }
        | { kind: 'groupdef'; name: string };

    // svelte-ignore state_referenced_locally
    let form: FormJson = $state(clone(initial));
    let selected = $state<Selection>({ kind: 'form' });
    let preview = $state(true);
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

    const isSelected = (s: Selection) => JSON.stringify(s) === JSON.stringify(selected);
    const kindLabel = (item: Item) => (item.kind === 'group' ? `Gruppe ${item.group}${item.repeat ? ' (wiederholbar)' : ''}` : item.type);

    function selectGroupDef(name: string): void {
        selected = { kind: 'groupdef', name };
        groupName = name;
    }

    async function save(): Promise<void> {
        if (problems.length) return;
        busy = true;
        message = '';
        try {
            const saved = await formService.saveVersion($state.snapshot(form), formKey);
            onsaved(saved.id);
        } catch (e) {
            message = `Fehler: ${errorText(e)}`;
        } finally {
            busy = false;
        }
    }
</script>

{#snippet itemList(container: Container, items: Item[])}
    <ul class="items">
        {#each items as item, i (i)}
            {@const sel: Selection = { kind: 'item', container, index: i }}
            <li class:selected={isSelected(sel)}>
                <button type="button" class="node" onclick={() => (selected = sel)}>
                    {item.label} <small>{kindLabel(item)} · {item.id}</small>
                </button>
                <span class="tools">
                    <button type="button" class="icon" onclick={() => (selected = { kind: 'item', container, index: move(items, i, -1) })} aria-label="nach oben">↑</button>
                    <button type="button" class="icon" onclick={() => (selected = { kind: 'item', container, index: move(items, i, 1) })} aria-label="nach unten">↓</button>
                    <button type="button" class="icon" onclick={() => { remove(items, i); selected = { kind: 'form' }; }} aria-label="entfernen">✕</button>
                </span>
            </li>
        {/each}
    </ul>
    <span class="add">
        <button type="button" class="secondary small" onclick={() => (selected = { kind: 'item', container, index: addField(form, container) })}>+ Feld</button>
        <button type="button" class="secondary small" onclick={() => (selected = { kind: 'item', container, index: addGroupItem(form, container) })}>+ Gruppe</button>
    </span>
{/snippet}

<section class="designer">
    <header class="bar">
        <button class="secondary" onclick={oncancel}>← Abbrechen</button>
        <h2>Form-Designer: {form.title}</h2>
        <label class="check"><input type="checkbox" bind:checked={preview} /> Vorschau</label>
        <button onclick={save} disabled={busy || problems.length > 0}>Als Version {nextVersion} speichern</button>
    </header>
    {#if message}<p class="error">{message}</p>{/if}
    {#if problems.length}
        <details class="problems" open>
            <summary class="error">{problems.length} Problem(e) – Speichern erst nach Korrektur möglich</summary>
            <ul>{#each problems as p}<li>{p}</li>{/each}</ul>
        </details>
    {/if}

    <div class="columns" class:with-preview={preview}>
        <nav class="tree" aria-label="Formularstruktur">
            <button type="button" class="node root" class:selected={isSelected({ kind: 'form' })} onclick={() => (selected = { kind: 'form' })}>
                Formular: {form.title}
            </button>
            <h3>Abschnitte</h3>
            {#each form.sections as section, s (s)}
                <div class="section" class:selected={isSelected({ kind: 'section', index: s })}>
                    <div class="head">
                        <button type="button" class="node" onclick={() => (selected = { kind: 'section', index: s })}>{section.title}</button>
                        <span class="tools">
                            <button type="button" class="icon" onclick={() => (selected = { kind: 'section', index: move(form.sections, s, -1) })} aria-label="Abschnitt nach oben">↑</button>
                            <button type="button" class="icon" onclick={() => (selected = { kind: 'section', index: move(form.sections, s, 1) })} aria-label="Abschnitt nach unten">↓</button>
                            <button type="button" class="icon" onclick={() => { remove(form.sections, s); selected = { kind: 'form' }; }} aria-label="Abschnitt entfernen" disabled={form.sections.length < 2}>✕</button>
                        </span>
                    </div>
                    {@render itemList({ type: 'section', index: s }, section.items)}
                </div>
            {/each}
            <button type="button" class="secondary small" onclick={() => (selected = { kind: 'section', index: addSection(form) })}>+ Abschnitt</button>

            <h3>Gruppen-Definitionen</h3>
            {#each Object.entries(form.groups ?? {}) as [name, def] (name)}
                <div class="section" class:selected={isSelected({ kind: 'groupdef', name })}>
                    <div class="head">
                        <button type="button" class="node" onclick={() => selectGroupDef(name)}>{name}{#if unused.includes(name)} <small>(unbenutzt)</small>{/if}</button>
                        <span class="tools">
                            <button type="button" class="icon" onclick={() => { delete form.groups![name]; selected = { kind: 'form' }; }} aria-label="Gruppe {name} entfernen" disabled={!unused.includes(name)}>✕</button>
                        </span>
                    </div>
                    {@render itemList({ type: 'group', name }, def.items)}
                </div>
            {/each}
            <button type="button" class="secondary small" onclick={() => selectGroupDef(addGroupDefinition(form))}>+ Gruppe definieren</button>
        </nav>

        <div class="props">
            {#if selected.kind === 'form'}
                <h3>Formular</h3>
                <label>Titel <input bind:value={form.title} /></label>
                <p class="muted">Gespeichert wird als neue Version{formKey ? ` (Formular-Schlüssel ${formKey})` : ' eines neuen Formulars'}. Bestehende Anmeldungen behalten ihre Version.</p>
            {:else if selected.kind === 'section'}
                {@const section = form.sections[selected.index]}
                {#if section}
                    <h3>Abschnitt</h3>
                    <label>ID <input bind:value={section.id} /></label>
                    <label>Titel <input bind:value={section.title} /></label>
                    <label>Beschreibung <textarea rows="3" value={section.description ?? ''} oninput={(e) => {
                        if (e.currentTarget.value) section.description = e.currentTarget.value; else delete section.description;
                    }}></textarea></label>
                {/if}
            {:else if selected.kind === 'groupdef'}
                {@const def = form.groups?.[selected.name]}
                {#if def}
                    <h3>Gruppen-Definition</h3>
                    <label>
                        Name
                        <input bind:value={groupName} onchange={() => { const from = (selected as { name: string }).name; renameGroup(form, from, groupName); selectGroupDef(groupName); }} />
                    </label>
                    <p class="muted">Eine Gruppe wird einmal definiert und kann mehrfach verwendet werden (z. B. zwei Erziehungsberechtigte).</p>
                {/if}
            {:else if selectedItem}
                <h3>{selectedItem.kind === 'group' ? 'Gruppe' : 'Feld'}</h3>
                {#key `${JSON.stringify(selected)}`}
                    <ItemEditor bind:form container={(selected as { container: Container }).container} index={(selected as { index: number }).index} {siblings} />
                {/key}
            {/if}
        </div>

        {#if preview}
            <div class="preview" aria-label="Vorschau">
                <h3>Vorschau</h3>
                {#if problems.length}
                    <p class="muted">Vorschau nach Korrektur der Probleme.</p>
                {:else}
                    {#key JSON.stringify(form)}
                        <FormRenderer form={$state.snapshot(form)} data={previewData} {loadOptions} />
                    {/key}
                {/if}
            </div>
        {/if}
    </div>
</section>

<style>
    .bar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
    }
    .bar h2 {
        margin: 0;
        font-size: 1.2rem;
        flex: 1;
    }
    .columns {
        display: grid;
        grid-template-columns: minmax(16rem, 1fr) minmax(18rem, 1.2fr);
        gap: 1rem;
        margin-top: 0.75rem;
    }
    .columns.with-preview {
        grid-template-columns: minmax(15rem, 0.9fr) minmax(17rem, 1fr) minmax(18rem, 1.2fr);
    }
    .tree,
    .props,
    .preview {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 0.5rem;
        align-self: start;
        max-height: 80vh;
        overflow: auto;
    }
    .props {
        display: grid;
        gap: 0.5rem;
        position: sticky;
        top: 0;
    }
    .props label {
        display: grid;
        gap: 0.15rem;
    }
    h3 {
        font-size: 0.95rem;
        margin: 0.5rem 0 0.25rem;
    }
    .items {
        list-style: none;
        margin: 0 0 0.25rem;
        padding-left: 0.75rem;
    }
    .items li,
    .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.25rem;
    }
    .section {
        border-left: 3px solid #eee;
        margin-bottom: 0.5rem;
        padding-left: 0.25rem;
    }
    .node {
        background: none;
        border: none;
        color: inherit;
        text-align: left;
        padding: 0.15rem 0.25rem;
        cursor: pointer;
        flex: 1;
    }
    .node small {
        color: #777;
    }
    .selected > .node,
    .selected > .head > .node,
    .node.selected {
        background: #dde8fb;
        border-radius: 3px;
    }
    .tools {
        white-space: nowrap;
    }
    .icon {
        background: none;
        border: none;
        color: #2456a6;
        padding: 0 0.2rem;
    }
    .small {
        padding: 0.1rem 0.5rem;
        font-size: 0.85rem;
    }
    .add {
        display: flex;
        gap: 0.3rem;
        padding-left: 0.75rem;
    }
    .check {
        display: flex;
        gap: 0.3rem;
        align-items: center;
    }
    .problems ul {
        margin: 0.25rem 0;
        font-size: 0.85rem;
    }
</style>
