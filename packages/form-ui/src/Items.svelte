<script lang="ts">
    import { isVisible, joinPath, type FormData, type Item } from '@anmeldung/forms';
    import { getFormContext, type DesignContainer } from './context.ts';
    import Field from './Field.svelte';
    import Group from './Group.svelte';

    interface Props {
        items: Item[];
        /** data object of the current scope (root or group instance) */
        local: FormData;
        root: FormData;
        base: string;
        /** where these items are defined (form designer) */
        container?: DesignContainer;
    }

    let { items, local, root, base, container }: Props = $props();
    const ctx = getFormContext();
    const stop = (e: Event) => e.stopPropagation();
</script>

{#snippet content(item: Item, visible: boolean)}
    {#if item.kind === 'field'}
        <Field field={item} {local} {root} path={joinPath(base, item.id)} hiddenPublic={!visible} />
    {:else}
        <Group group={item} siblings={items} {local} {root} path={joinPath(base, item.id)} hiddenPublic={!visible} />
    {/if}
{/snippet}

<div class="items">
    {#each items as item, index (ctx.design ? index : item.id)}
        {@const visible = isVisible(item, { local, root })}
        {#if ctx.design && container}
            {@const design = ctx.design}
            {@const target = { kind: 'item', container, index } as const}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
                class="design-item"
                class:selected={design.isSelected(target)}
                onclick={(e) => {
                    e.stopPropagation();
                    design.select(target);
                }}
            >
                {#if design.isSelected(target)}
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <div class="design-tools" onclick={stop}>{@render design.tools(target)}</div>
                {/if}
                {@render content(item, visible)}
            </div>
        {:else if visible || ctx.mode === 'secretariat'}
            {@render content(item, visible)}
        {/if}
    {/each}
</div>

<style>
    .items {
        display: grid;
        gap: 0.75rem;
    }
    .design-item {
        position: relative;
        border-radius: 6px;
        cursor: pointer;
    }
    .design-item:hover {
        outline: 1px dashed var(--form-section-border, #ccc);
        outline-offset: 2px;
    }
</style>
