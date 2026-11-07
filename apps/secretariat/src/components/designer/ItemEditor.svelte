<!-- Properties of one field or group instance. -->
<script lang="ts">
    import type { FieldItem, FieldType, FileContentType, FormJson, GroupItem, Item } from '@anmeldung/forms';
    import ConditionEditor from './ConditionEditor.svelte';
    import { changeFieldType, itemsOf, type Container } from './designer.ts';
    import OptionsEditor from './OptionsEditor.svelte';

    interface Props {
        /** bound: the editor changes the form owned by the designer */
        form: FormJson;
        container: Container;
        index: number;
        /** items of the same scope (for conditions and copy sources) */
        siblings: Item[];
    }

    let { form = $bindable(), container, index, siblings }: Props = $props();
    const item = $derived(itemsOf(form, container)[index]);

    const TYPES: [FieldType, string][] = [
        ['text', 'Text'],
        ['email', 'E-Mail'],
        ['phone', 'Telefon'],
        ['date', 'Datum'],
        ['year', 'Jahr'],
        ['integer', 'Ganze Zahl'],
        ['boolean', 'Ja/Nein'],
        ['select', 'Auswahl'],
        ['multiselect', 'Mehrfachauswahl'],
        ['searchselect', 'Auswahl mit Suche'],
        ['file', 'Datei-Upload'],
    ];
    const FILE_TYPES: [FileContentType, string][] = [
        ['application/pdf', 'PDF'],
        ['image/jpeg', 'JPEG'],
        ['image/png', 'PNG'],
    ];

    const fieldRefs = $derived(siblings.filter((s) => s.kind === 'field' && s.id !== item.id).map((s) => s.id));
    const sources = $derived(
        item.kind === 'group' ? siblings.filter((s): s is GroupItem => s.kind === 'group' && s.group === item.group && s.id !== item.id) : [],
    );

    /** sets or removes an optional property (empty input = removed) */
    function setOptional<T extends object>(target: T, prop: string, value: unknown): void {
        const t = target as Record<string, unknown>;
        if (value === '' || value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) delete t[prop];
        else t[prop] = value;
    }

    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

    function toggleAccept(field: FieldItem, type: FileContentType, on: boolean): void {
        const all = FILE_TYPES.map(([t]) => t);
        const current = field.accept ?? all;
        const next = on ? [...new Set([...current, type])] : current.filter((t) => t !== type);
        if (next.length === all.length || next.length === 0) delete field.accept;
        else field.accept = all.filter((t) => next.includes(t));
    }
</script>

<div class="editor">
    <label>ID (Datenname) <input bind:value={item.id} pattern="[a-z][a-zA-Z0-9_]*" /></label>
    <label>Beschriftung <input bind:value={item.label} /></label>

    {#if item.kind === 'field'}
        {@const field = item}
        <label>
            Feldtyp
            <select value={field.type} onchange={(e) => changeFieldType(field, e.currentTarget.value as FieldType)}>
                {#each TYPES as [type, label] (type)}<option value={type}>{label}</option>{/each}
            </select>
        </label>
        <label>Hinweistext <textarea rows="2" value={field.help ?? ''} oninput={(e) => setOptional(field, 'help', e.currentTarget.value)}></textarea></label>

        {#if field.type === 'boolean'}
            <label class="check">
                <input type="checkbox" checked={!!field.mustAccept} onchange={(e) => {
                    setOptional(field, 'mustAccept', e.currentTarget.checked || undefined);
                    if (e.currentTarget.checked) { delete field.required; delete field.requiredIf; }
                }} />
                Muss bestätigt werden (Kenntnisnahme, einzelnes Häkchen)
            </label>
        {/if}
        {#if !field.mustAccept}
            <label class="check">
                <input type="checkbox" checked={!!field.required} onchange={(e) => {
                    setOptional(field, 'required', e.currentTarget.checked || undefined);
                    if (e.currentTarget.checked) delete field.requiredIf;
                }} />
                Pflichtfeld
            </label>
            {#if !field.required}
                <ConditionEditor label="Pflicht, wenn" value={field.requiredIf} fields={fieldRefs} onchange={(c) => setOptional(field, 'requiredIf', c)} />
            {/if}
        {/if}

        {#if field.type === 'text' || field.type === 'email' || field.type === 'phone'}
            <div class="row">
                <label>Min. Zeichen <input type="number" min="0" value={field.minLength ?? ''} oninput={(e) => setOptional(field, 'minLength', num(e.currentTarget.value))} /></label>
                <label>Max. Zeichen <input type="number" min="1" value={field.maxLength ?? ''} oninput={(e) => setOptional(field, 'maxLength', num(e.currentTarget.value))} /></label>
            </div>
            <label>Muster (regulärer Ausdruck) <input value={field.pattern ?? ''} oninput={(e) => setOptional(field, 'pattern', e.currentTarget.value)} placeholder="z. B. ^\d{'{'}5{'}'}$" /></label>
        {:else if field.type === 'date'}
            <div class="row">
                <label>Frühestens <input type="date" value={field.min ?? ''} oninput={(e) => setOptional(field, 'min', e.currentTarget.value)} /></label>
                <label>Spätestens <input type="date" value={field.max ?? ''} oninput={(e) => setOptional(field, 'max', e.currentTarget.value)} /></label>
            </div>
        {:else if field.type === 'year' || field.type === 'integer'}
            <div class="row">
                <label>Minimum <input type="number" value={field.min ?? ''} oninput={(e) => setOptional(field, 'min', num(e.currentTarget.value))} /></label>
                <label>Maximum <input type="number" value={field.max ?? ''} oninput={(e) => setOptional(field, 'max', num(e.currentTarget.value))} /></label>
            </div>
        {:else if field.type === 'select' || field.type === 'multiselect' || field.type === 'searchselect'}
            <label class="check">
                <input type="checkbox" checked={!!field.optionsSource} onchange={(e) => {
                    if (e.currentTarget.checked) { field.optionsSource = 'laender.json'; delete field.options; }
                    else { delete field.optionsSource; field.options = [{ key: 'option1', value: 'Option 1' }]; }
                }} />
                Optionen aus einer Katalog-Datei (Dateien)
            </label>
            {#if field.optionsSource !== undefined}
                <label>Katalog-Datei <input bind:value={field.optionsSource} /></label>
            {:else if field.options}
                <OptionsEditor bind:options={field.options} />
            {/if}
            {#if field.type === 'multiselect'}
                <div class="row">
                    <label>Mindestens <input type="number" min="0" value={field.minItems ?? ''} oninput={(e) => setOptional(field, 'minItems', num(e.currentTarget.value))} /></label>
                    <label>Höchstens <input type="number" min="1" value={field.maxItems ?? ''} oninput={(e) => setOptional(field, 'maxItems', num(e.currentTarget.value))} /></label>
                </div>
            {/if}
        {:else if field.type === 'file'}
            <span class="label">Erlaubte Dateitypen</span>
            <div class="row">
                {#each FILE_TYPES as [type, label] (type)}
                    <label class="check"><input type="checkbox" checked={(field.accept ?? FILE_TYPES.map(([t]) => t)).includes(type)} onchange={(e) => toggleAccept(field, type, e.currentTarget.checked)} /> {label}</label>
                {/each}
            </div>
            <label class="check">
                <input type="checkbox" checked={field.role === 'photo'} onchange={(e) => {
                    setOptional(field, 'role', e.currentTarget.checked ? 'photo' : undefined);
                    if (e.currentTarget.checked) { delete field.multiple; delete field.maxFiles; field.accept = ['image/jpeg', 'image/png']; }
                }} />
                Passfoto des Kindes (wird verkleinert, im Sekretariat angezeigt, gedruckt, an SVWS übertragen)
            </label>
            {#if field.role !== 'photo'}
                <label class="check"><input type="checkbox" checked={!!field.multiple} onchange={(e) => { setOptional(field, 'multiple', e.currentTarget.checked || undefined); if (!e.currentTarget.checked) delete field.maxFiles; }} /> Mehrere Dateien</label>
                {#if field.multiple}
                    <label>Höchstens Dateien <input type="number" min="1" max="20" value={field.maxFiles ?? ''} oninput={(e) => setOptional(field, 'maxFiles', num(e.currentTarget.value))} /></label>
                {/if}
            {/if}
        {/if}
    {:else}
        {@const group = item}
        <label>Hinweistext <textarea rows="3" value={group.help ?? ''} oninput={(e) => setOptional(group, 'help', e.currentTarget.value)}></textarea></label>
        <label>
            Gruppe (Definition)
            <select bind:value={group.group}>
                {#each Object.keys(form.groups ?? {}) as name (name)}<option value={name}>{name}</option>{/each}
            </select>
        </label>
        <label class="check">
            <input type="checkbox" checked={!!group.repeat} onchange={(e) => setOptional(group, 'repeat', e.currentTarget.checked ? { minItems: 0, maxItems: 5 } : undefined)} />
            Wiederholbar (mehrere Einträge)
        </label>
        {#if group.repeat}
            <div class="row">
                <label>Mindestens <input type="number" min="0" value={group.repeat.minItems ?? ''} oninput={(e) => setOptional(group.repeat!, 'minItems', num(e.currentTarget.value))} /></label>
                <label>Höchstens <input type="number" min="1" value={group.repeat.maxItems ?? ''} oninput={(e) => setOptional(group.repeat!, 'maxItems', num(e.currentTarget.value))} /></label>
                <label>Bezeichnung je Eintrag <input value={group.repeat.itemLabel ?? ''} oninput={(e) => setOptional(group.repeat!, 'itemLabel', e.currentTarget.value)} /></label>
            </div>
        {:else if sources.length}
            <span class="label">Angaben übernehmen von</span>
            {#each sources as source (source.id)}
                <label class="check">
                    <input type="checkbox" checked={group.copyFrom?.includes(source.id) ?? false} onchange={(e) => {
                        const next = e.currentTarget.checked ? [...(group.copyFrom ?? []), source.id] : (group.copyFrom ?? []).filter((x) => x !== source.id);
                        setOptional(group, 'copyFrom', next.length ? next : undefined);
                    }} />
                    {source.label}
                </label>
            {/each}
        {/if}
    {/if}

    <ConditionEditor label="Sichtbar, wenn" value={item.visibleIf} fields={fieldRefs} onchange={(c) => setOptional(item, 'visibleIf', c)} />
</div>

<style>
    .editor {
        display: grid;
        gap: 0.5rem;
    }
    label {
        display: grid;
        gap: 0.15rem;
    }
    label.check {
        display: flex;
        gap: 0.4rem;
        align-items: center;
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .label {
        font-weight: 500;
    }
    input[type='number'] {
        width: 7rem;
    }
</style>
