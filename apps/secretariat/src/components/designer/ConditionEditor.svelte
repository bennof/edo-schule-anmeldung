<!-- Condition of visibleIf / requiredIf. Simple conditions (one field) in a
     form; combined ones (all/any/not) as JSON. -->
<script lang="ts">
    import type { Condition } from '@anmeldung/forms';

    interface Props {
        label: string;
        value: Condition | undefined;
        /** field references offered as suggestions */
        fields: string[];
        onchange: (next: Condition | undefined) => void;
    }

    let { label, value, fields, onchange }: Props = $props();
    const listId = `fields-${Math.random().toString(36).slice(2)}`;

    type Op = 'equals' | 'notEquals' | 'in' | 'filled' | 'empty';
    const simple = $derived(!value || 'field' in value);
    let advanced = $state(false);
    let json = $state('');
    let jsonError = $state('');
    $effect(() => {
        if (!simple && !advanced) json = JSON.stringify(value, null, 1);
    });

    const field = $derived(value && 'field' in value ? value.field : '');
    const op: Op = $derived.by(() => {
        if (!value || !('field' in value)) return 'equals';
        if ('notEquals' in value) return 'notEquals';
        if ('in' in value) return 'in';
        if ('filled' in value) return value.filled ? 'filled' : 'empty';
        return 'equals';
    });
    const operand = $derived.by(() => {
        if (!value || !('field' in value)) return '';
        if ('equals' in value) return String(value.equals);
        if ('notEquals' in value) return String(value.notEquals);
        if ('in' in value) return value.in.join(', ');
        return '';
    });

    /** "true"/"false"/numbers become typed values (Ja/Nein fields, integers) */
    function scalar(text: string): string | number | boolean {
        const t = text.trim();
        if (t === 'true' || t === 'false') return t === 'true';
        if (/^-?\d+$/.test(t)) return Number(t);
        return t;
    }

    function build(f: string, o: Op, v: string): void {
        if (!f.trim()) return onchange(undefined);
        const ref = f.trim();
        if (o === 'filled' || o === 'empty') return onchange({ field: ref, filled: o === 'filled' });
        if (o === 'in') return onchange({ field: ref, in: v.split(',').map(scalar).filter((x) => x !== '') });
        if (o === 'notEquals') return onchange({ field: ref, notEquals: scalar(v) });
        onchange({ field: ref, equals: scalar(v) });
    }

    function openJson(): void {
        json = value ? JSON.stringify(value, null, 1) : '';
        jsonError = '';
        advanced = true;
    }

    function applyJson(): void {
        try {
            onchange(json.trim() ? JSON.parse(json) : undefined);
            advanced = false;
        } catch {
            jsonError = 'Kein gültiges JSON';
        }
    }
</script>

<fieldset class="condition">
    <legend>{label}</legend>
    {#if advanced || !simple}
        <textarea rows="4" bind:value={json} oninput={() => (advanced = true)} placeholder={'{"all": [{"field": "a", "equals": true}, {"field": "b", "filled": true}]}'}></textarea>
        {#if jsonError}<span class="error">{jsonError}</span>{/if}
        <span class="row">
            <button type="button" class="secondary" onclick={applyJson}>Übernehmen</button>
            {#if !simple || advanced}<button type="button" class="secondary" onclick={() => ((advanced = false), onchange(undefined))}>Bedingung entfernen</button>{/if}
        </span>
    {:else}
        <span class="row">
            <input list={listId} placeholder="Feld (leer = immer)" value={field} onchange={(e) => build(e.currentTarget.value, op, operand)} aria-label="{label}: Feld" />
            <datalist id={listId}>{#each fields as f (f)}<option value={f}></option>{/each}</datalist>
            <select value={op} onchange={(e) => build(field, e.currentTarget.value as Op, operand)} aria-label="{label}: Vergleich" disabled={!field}>
                <option value="equals">ist gleich</option>
                <option value="notEquals">ist nicht</option>
                <option value="in">ist eins von</option>
                <option value="filled">ist ausgefüllt</option>
                <option value="empty">ist leer</option>
            </select>
            {#if op !== 'filled' && op !== 'empty'}
                <input placeholder="Wert (true/false für Ja/Nein)" value={operand} onchange={(e) => build(field, op, e.currentTarget.value)} aria-label="{label}: Wert" disabled={!field} />
            {/if}
            <button type="button" class="secondary small" onclick={openJson}>JSON</button>
        </span>
    {/if}
</fieldset>

<style>
    .condition {
        border: 1px dashed var(--border);
        border-radius: var(--radius);
        display: grid;
        gap: 0.3rem;
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
    }
    textarea {
        font-family: monospace;
        font-size: 0.85rem;
    }
    .small {
        padding: 0.1rem 0.4rem;
        font-size: 0.8rem;
    }
</style>
