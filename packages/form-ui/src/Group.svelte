<script lang="ts">
    import {
        canAddRepeat,
        canRemoveRepeat,
        copyGroupData,
        emptyGroupData,
        groupItems,
        joinPath,
        type FormData,
        type GroupItem,
        type Item,
    } from '@anmeldung/forms';
    import { getFormContext, visibleError } from './context.ts';
    import Items from './Items.svelte';

    interface Props {
        group: GroupItem;
        /** items of the enclosing scope, to resolve copy sources */
        siblings: Item[];
        local: FormData;
        root: FormData;
        path: string;
        hiddenPublic: boolean;
    }

    let { group, siblings, local, root, path, hiddenPublic }: Props = $props();
    const ctx = getFormContext();

    const inner = $derived(groupItems(ctx.form, group));
    const sources = $derived(
        (group.copyFrom ?? []).flatMap((id) => siblings.filter((s): s is GroupItem => s.kind === 'group' && s.id === id)),
    );
    const list = $derived((Array.isArray(local[group.id]) ? local[group.id] : []) as FormData[]);
    const error = $derived(visibleError(ctx, path));
    // designer: the fields of the definition are always shown, even without data
    const container = $derived({ type: 'group', name: group.group } as const);

    function copyFrom(source: GroupItem): void {
        local[group.id] = copyGroupData(local[source.id]);
    }

    function add(): void {
        if (!Array.isArray(local[group.id])) local[group.id] = [];
        (local[group.id] as FormData[]).push(emptyGroupData(ctx.form, group));
    }

    function remove(index: number): void {
        (local[group.id] as FormData[]).splice(index, 1);
    }
</script>

<fieldset class="group" class:hidden-public={hiddenPublic} data-path={path}>
    <legend>{group.label}</legend>
    {#if group.help}<p class="help">{group.help}</p>{/if}
    {#if hiddenPublic}<p class="hidden-note">Im Online-Formular ausgeblendet</p>{/if}

    {#if group.repeat}
        {#if ctx.design && !list.length}
            <fieldset class="entry">
                <legend>{group.repeat.itemLabel ?? group.label}</legend>
                <Items items={inner} local={{}} {root} base={joinPath(path, 0)} {container} />
            </fieldset>
        {/if}
        {#each list as entry, i (entry)}
            <fieldset class="entry" data-path={joinPath(path, i)}>
                <legend>{group.repeat.itemLabel ?? group.label} {i + 1}</legend>
                <Items items={inner} local={entry} {root} base={joinPath(path, i)} {container} />
                {#if canRemoveRepeat(group, list)}
                    <button type="button" class="secondary" onclick={() => remove(i)}>Eintrag entfernen</button>
                {/if}
            </fieldset>
        {/each}
        {#if canAddRepeat(group, list)}
            <button type="button" onclick={add}>{group.repeat.itemLabel ?? 'Eintrag'} hinzufügen</button>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
    {:else}
        {#each sources as source (source.id)}
            <button type="button" class="secondary copy" onclick={() => copyFrom(source)}>
                Angaben von „{source.label}“ übernehmen
            </button>
        {/each}
        {#if local[group.id] || ctx.design}
            <Items items={inner} local={(local[group.id] ?? {}) as FormData} {root} base={path} {container} />
        {/if}
    {/if}
</fieldset>

<style>
    fieldset {
        border: 1px solid var(--form-section-border, #ddd);
        border-radius: var(--form-section-radius, 6px);
        padding: 0.5rem 1rem 1rem;
        display: grid;
        gap: 0.75rem;
    }
    legend {
        font-weight: 600;
        padding: 0 0.3rem;
    }
    .entry {
        background: var(--form-surface, #f8f8f8);
    }
    .help {
        margin: 0;
        color: var(--form-muted, #555);
        white-space: pre-line;
    }
    .hidden-public {
        border-style: dashed;
    }
    button {
        justify-self: start;
    }
    .error {
        color: var(--form-error, #b00020);
        margin: 0;
    }
</style>
