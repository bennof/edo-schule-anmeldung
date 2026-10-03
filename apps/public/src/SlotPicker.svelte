<!-- Appointment selection (backlog G2): days, then free times of that day.
     Parallel slots at the same time are shown once. -->
<script lang="ts">
    import { formatDay, type Slot } from './api.ts';

    interface Props {
        slots: Slot[];
        onselect: (slot: Slot) => void;
    }

    let { slots, onselect }: Props = $props();

    const days = $derived.by(() => {
        const map = new Map<string, Slot[]>();
        for (const s of slots) {
            const day = s.datetime.slice(0, 10);
            const list = map.get(day) ?? [];
            if (!list.some((x) => x.datetime === s.datetime)) list.push(s);
            map.set(day, list);
        }
        return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    });

    let selectedDay = $state('');
    const day = $derived(days.find(([d]) => d === selectedDay) ?? days[0]);
</script>

{#if !days.length}
    <p>Zurzeit sind keine Termine frei. Bitte schauen Sie später noch einmal vorbei.</p>
{:else}
    <h2>Termin wählen</h2>
    <div class="days" role="tablist" aria-label="Tag">
        {#each days as [d, list] (d)}
            <button role="tab" aria-selected={d === day[0]} class:active={d === day[0]} onclick={() => (selectedDay = d)}>
                {formatDay(d)}<br /><small>{list.length} frei</small>
            </button>
        {/each}
    </div>
    <div class="times" role="tabpanel" aria-label={formatDay(day[0])}>
        {#each day[1] as slot (slot.id)}
            <button class="time" onclick={() => onselect(slot)}>{slot.datetime.slice(11)} Uhr</button>
        {/each}
    </div>
{/if}

<style>
    .days {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }
    .days button {
        background: white;
        color: inherit;
        border: 1px solid #bbb;
        text-align: left;
    }
    .days button.active {
        border-color: var(--accent);
        outline: 2px solid var(--accent);
    }
    .times {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
        gap: 0.5rem;
    }
</style>
