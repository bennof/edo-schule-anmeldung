<!-- Select with a search box for long option lists (searchselect). -->
<script lang="ts">
    import type { Option } from '@anmeldung/forms';

    interface Props {
        id: string;
        options: Option[];
        value: string | undefined;
        onchange: (key: string | undefined) => void;
        onblur: () => void;
    }

    let { id, options, value, onchange, onblur }: Props = $props();

    const MAX_RESULTS = 20;
    let query = $state('');
    let open = $state(false);

    const selected = $derived(options.find((o) => o.key === value));
    const results = $derived(
        options.filter((o) => o.value.toLowerCase().includes(query.trim().toLowerCase())).slice(0, MAX_RESULTS),
    );

    function choose(option: Option): void {
        onchange(option.key);
        query = '';
        open = false;
    }
</script>

<div class="search-select">
    {#if selected && !open}
        <div class="selected">
            <span>{selected.value}</span>
            <button type="button" class="secondary" onclick={() => (open = true)}>Ändern</button>
            <button type="button" class="secondary" onclick={() => onchange(undefined)}>Entfernen</button>
        </div>
    {:else}
        <input
            {id}
            type="search"
            placeholder="Suchen …"
            autocomplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            bind:value={query}
            onfocus={() => (open = true)}
            onblur={onblur}
        />
        {#if open}
            <ul id={`${id}-list`} role="listbox">
                {#each results as option (option.key)}
                    <li role="option" aria-selected={option.key === value}>
                        <button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => choose(option)}>
                            {option.value}
                        </button>
                    </li>
                {:else}
                    <li class="empty">Keine Treffer</li>
                {/each}
            </ul>
        {/if}
    {/if}
</div>

<style>
    .search-select {
        max-width: 28rem;
    }
    input {
        font: inherit;
        padding: var(--form-input-padding, 0.35rem 0.5rem);
        width: 100%;
        box-sizing: border-box;
    }
    ul {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid var(--form-section-border, #ccc);
        border-radius: var(--form-list-radius, 0);
        max-height: 14rem;
        overflow-y: auto;
    }
    li button {
        width: 100%;
        text-align: left;
        border: 0;
        background: none;
        padding: 0.35rem 0.5rem;
        font: inherit;
        color: inherit;
        cursor: pointer;
    }
    li button:hover,
    li button:focus {
        background: var(--form-hover, #eef);
    }
    .empty {
        padding: 0.35rem 0.5rem;
        color: var(--form-muted, #666);
    }
    .selected {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }
</style>
