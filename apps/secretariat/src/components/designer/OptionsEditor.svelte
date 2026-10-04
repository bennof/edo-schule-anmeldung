<!-- Key/value options of select fields. -->
<script lang="ts">
    import type { Option } from '@anmeldung/forms';
    import { move, remove } from './designer.ts';

    interface Props {
        options: Option[];
    }

    let { options = $bindable() }: Props = $props();
</script>

<table class="options">
    <thead><tr><th>Schlüssel (intern)</th><th>Anzeigetext</th><th></th></tr></thead>
    <tbody>
        {#each options as option, i (i)}
            <tr>
                <td><input bind:value={option.key} aria-label="Schlüssel {i + 1}" /></td>
                <td><input bind:value={option.value} aria-label="Anzeigetext {i + 1}" /></td>
                <td class="tools">
                    <button type="button" class="secondary" onclick={() => move(options, i, -1)} aria-label="nach oben">↑</button>
                    <button type="button" class="secondary" onclick={() => move(options, i, 1)} aria-label="nach unten">↓</button>
                    <button type="button" class="secondary" onclick={() => remove(options, i)} aria-label="entfernen" disabled={options.length < 2}>✕</button>
                </td>
            </tr>
        {/each}
    </tbody>
</table>
<button type="button" class="secondary" onclick={() => options.push({ key: `option${options.length + 1}`, value: `Option ${options.length + 1}` })}>
    Option hinzufügen
</button>

<style>
    .options {
        margin: 0.3rem 0;
    }
    .options input {
        width: 100%;
        box-sizing: border-box;
    }
    .tools {
        white-space: nowrap;
    }
    .tools button {
        padding: 0.1rem 0.4rem;
    }
</style>
