<script lang="ts">
    import { isVisible, joinPath, type FormData, type Item } from '@anmeldung/forms';
    import { getFormContext } from './context.ts';
    import Field from './Field.svelte';
    import Group from './Group.svelte';

    interface Props {
        items: Item[];
        /** data object of the current scope (root or group instance) */
        local: FormData;
        root: FormData;
        base: string;
    }

    let { items, local, root, base }: Props = $props();
    const ctx = getFormContext();
</script>

<div class="items">
    {#each items as item (item.id)}
        {@const visible = isVisible(item, { local, root })}
        {#if visible || ctx.mode === 'secretariat'}
            {#if item.kind === 'field'}
                <Field field={item} {local} {root} path={joinPath(base, item.id)} hiddenPublic={!visible} />
            {:else}
                <Group group={item} siblings={items} {local} {root} path={joinPath(base, item.id)} hiddenPublic={!visible} />
            {/if}
        {/if}
    {/each}
</div>

<style>
    .items {
        display: grid;
        gap: 0.75rem;
    }
</style>
