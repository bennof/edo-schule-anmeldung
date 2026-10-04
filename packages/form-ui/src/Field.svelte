<script lang="ts">
    import { formatDate, isRequired, type FieldItem, type FormData, type Option } from '@anmeldung/forms';
    import { getFormContext, visibleError } from './context.ts';
    import FileField from './FileField.svelte';
    import SearchSelect from './SearchSelect.svelte';

    interface Props {
        field: FieldItem;
        local: FormData;
        root: FormData;
        path: string;
        hiddenPublic: boolean;
    }

    let { field, local, root, path, hiddenPublic }: Props = $props();
    const ctx = getFormContext();

    const id = $derived(`f-${path}`);
    const required = $derived(isRequired(field, { local, root }));
    const error = $derived(visibleError(ctx, path));
    const value = $derived(local[field.id]);

    let loaded: Option[] = $state([]);
    const options = $derived(field.options ?? loaded);
    $effect(() => {
        if (!field.options && field.optionsSource && ctx.loadOptions) {
            ctx.loadOptions(field.optionsSource).then((o) => (loaded = o));
        }
    });

    function set(next: unknown): void {
        if (next === undefined || next === '' || (Array.isArray(next) && next.length === 0)) delete local[field.id];
        else local[field.id] = next;
    }

    function setNumber(raw: string): void {
        const n = Number(raw);
        set(raw.trim() === '' ? undefined : Number.isNaN(n) ? raw : n);
    }

    function toggle(key: string, checked: boolean): void {
        const current = Array.isArray(value) ? (value as string[]) : [];
        set(checked ? [...current, key] : current.filter((k) => k !== key));
    }

    function touch(): void {
        ctx.touched.add(path);
    }

    const textType = { text: 'text', email: 'email', phone: 'tel' } as const;
</script>

<div class="field" class:invalid={!!error} class:hidden-public={hiddenPublic} data-path={path}>
    {#if field.type === 'boolean' || field.type === 'multiselect' || field.type === 'file'}
        <span class="label" id={`${id}-label`}>{field.label}{#if required}<span class="req" aria-hidden="true"> *</span>{/if}</span>
    {:else}
        <label class="label" for={id}>{field.label}{#if required}<span class="req" aria-hidden="true"> *</span>{/if}</label>
    {/if}
    {#if hiddenPublic}<p class="hidden-note">Im Online-Formular ausgeblendet</p>{/if}

    {#if field.type === 'text' || field.type === 'email' || field.type === 'phone'}
        <input
            {id}
            type={textType[field.type]}
            value={(value as string) ?? ''}
            maxlength={field.maxLength}
            aria-invalid={!!error}
            oninput={(e) => set(e.currentTarget.value)}
            onblur={touch}
        />
    {:else if field.type === 'date'}
        <input
            {id}
            type="date"
            value={(value as string) ?? ''}
            min={typeof field.min === 'string' ? field.min : undefined}
            max={typeof field.max === 'string' ? field.max : undefined}
            aria-invalid={!!error}
            oninput={(e) => set(e.currentTarget.value)}
            onblur={touch}
        />
    {:else if field.type === 'integer' || field.type === 'year'}
        <input
            {id}
            type="number"
            step="1"
            inputmode="numeric"
            class:year={field.type === 'year'}
            value={value ?? ''}
            min={typeof field.min === 'number' ? field.min : undefined}
            max={typeof field.max === 'number' ? field.max : undefined}
            aria-invalid={!!error}
            oninput={(e) => setNumber(e.currentTarget.value)}
            onblur={touch}
        />
    {:else if field.type === 'boolean' && field.mustAccept}
        <label class="accept">
            <input type="checkbox" checked={value === true} onchange={(e) => set(e.currentTarget.checked || undefined)} onblur={touch} />
            Bestätigt
        </label>
    {:else if field.type === 'boolean'}
        <div class="choices" role="radiogroup" aria-labelledby={`${id}-label`}>
            <label><input type="radio" name={id} checked={value === true} onchange={() => set(true)} onblur={touch} /> Ja</label>
            <label><input type="radio" name={id} checked={value === false} onchange={() => set(false)} onblur={touch} /> Nein</label>
        </div>
    {:else if field.type === 'select'}
        <select {id} value={(value as string) ?? ''} aria-invalid={!!error} onchange={(e) => set(e.currentTarget.value)} onblur={touch}>
            <option value="">– bitte wählen –</option>
            {#each options as option (option.key)}
                <option value={option.key}>{option.value}</option>
            {/each}
        </select>
    {:else if field.type === 'multiselect'}
        <div class="choices" role="group" aria-labelledby={`${id}-label`}>
            {#each options as option (option.key)}
                <label>
                    <input
                        type="checkbox"
                        checked={Array.isArray(value) && value.includes(option.key)}
                        onchange={(e) => toggle(option.key, e.currentTarget.checked)}
                        onblur={touch}
                    />
                    {option.value}
                </label>
            {/each}
        </div>
    {:else if field.type === 'file'}
        <FileField {field} {id} {value} onchange={(next) => set(next)} onblur={touch} />
    {:else if field.type === 'searchselect'}
        <SearchSelect {id} {options} value={value as string | undefined} onchange={(key) => set(key)} onblur={touch} />
    {/if}

    {#if field.help}<p class="help">{field.help}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if field.type === 'date' && typeof value === 'string' && ctx.mode === 'secretariat'}
        <span class="help">{formatDate(value)}</span>
    {/if}
</div>

<style>
    .field {
        display: grid;
        gap: 0.25rem;
    }
    .label {
        font-weight: 500;
    }
    .req {
        color: #b00020;
    }
    input:not([type='radio'], [type='checkbox']),
    select {
        font: inherit;
        padding: 0.35rem 0.5rem;
        max-width: 28rem;
    }
    input.year {
        max-width: 7rem;
    }
    .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 1rem;
    }
    .invalid input:not([type='radio'], [type='checkbox']),
    .invalid select {
        border-color: #b00020;
    }
    .accept {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }
    .help {
        color: #555;
        white-space: pre-line;
        font-size: 0.85rem;
        margin: 0;
    }
    .error {
        color: #b00020;
        font-size: 0.9rem;
        margin: 0;
    }
    .hidden-public {
        opacity: 0.75;
    }
</style>
