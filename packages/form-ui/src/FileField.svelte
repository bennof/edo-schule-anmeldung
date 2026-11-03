<!-- File field: uploads through the app's FileHandler, keeps only references
     in the form data. The photo (role "photo") is scaled and previewed. -->
<script lang="ts">
    import type { FieldItem, FileRef } from '@anmeldung/forms';
    import { getFormContext } from './context.ts';
    import { prepareUpload, UploadError } from './images.ts';

    interface Props {
        field: FieldItem;
        id: string;
        value: unknown;
        onchange: (next: FileRef | FileRef[] | undefined) => void;
        onblur: () => void;
    }

    let { field, id, value, onchange, onblur }: Props = $props();
    const ctx = getFormContext();

    const refs = $derived(((field.multiple ? value : value ? [value] : []) ?? []) as FileRef[]);
    const canAdd = $derived(!!ctx.files && (field.multiple ? refs.length < (field.maxFiles ?? 20) : refs.length === 0));
    let busy = $state(false);
    let error = $state('');
    let previews: Record<string, string> = $state({});

    // preview of the photo
    $effect(() => {
        if (field.role !== 'photo' || !ctx.files) return;
        for (const ref of refs) {
            if (previews[ref.id]) continue;
            ctx.files.open(ref).then((blob) => {
                if (blob) previews[ref.id] = URL.createObjectURL(blob);
            });
        }
    });

    async function add(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const input = e.currentTarget;
        const chosen = Array.from(input.files ?? []);
        input.value = '';
        if (!chosen.length || !ctx.files) return;
        busy = true;
        error = '';
        try {
            const added: FileRef[] = [];
            for (const file of chosen.slice(0, field.multiple ? (field.maxFiles ?? 20) - refs.length : 1)) {
                const { blob, name } = await prepareUpload(file, field);
                added.push(await ctx.files.upload(blob, name, field));
            }
            onchange(field.multiple ? [...refs, ...added] : added[0]);
        } catch (err) {
            error = err instanceof UploadError ? err.message : `Hochladen fehlgeschlagen: ${err instanceof Error ? err.message : err}`;
        } finally {
            busy = false;
            onblur();
        }
    }

    async function remove(ref: FileRef): Promise<void> {
        busy = true;
        error = '';
        try {
            await ctx.files?.remove?.(ref);
            const rest = refs.filter((r) => r.id !== ref.id);
            onchange(field.multiple ? (rest.length ? rest : undefined) : undefined);
        } catch (err) {
            error = `Entfernen fehlgeschlagen: ${err instanceof Error ? err.message : err}`;
        } finally {
            busy = false;
        }
    }

    async function show(ref: FileRef): Promise<void> {
        const blob = await ctx.files?.open(ref);
        if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    }

    const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
</script>

<div class="files">
    {#each refs as ref (ref.id)}
        <div class="file" data-file={ref.id}>
            {#if previews[ref.id]}<img src={previews[ref.id]} alt="Passfoto" class="photo" />{/if}
            <span class="name">{ref.name}</span>
            <small class="muted">{size(ref.size)}</small>
            {#if ctx.files}<button type="button" class="secondary" onclick={() => show(ref)}>Ansehen</button>{/if}
            {#if ctx.files?.remove}<button type="button" class="secondary" onclick={() => remove(ref)} disabled={busy}>Entfernen</button>{/if}
        </div>
    {/each}
    {#if canAdd}
        <input
            {id}
            type="file"
            accept={(field.accept ?? ['application/pdf', 'image/jpeg', 'image/png']).join(',')}
            multiple={field.multiple}
            onchange={add}
            disabled={busy}
        />
    {:else if !ctx.files}
        <p class="muted">Hochladen ist hier nicht möglich.</p>
    {/if}
    {#if busy}<p class="muted" role="status">Wird verarbeitet …</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
    .files {
        display: grid;
        gap: 0.4rem;
    }
    .file {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
    }
    .photo {
        max-height: 6rem;
        max-width: 4.5rem;
        border: 1px solid var(--form-section-border, #ccc);
    }
    .muted {
        color: var(--form-muted, #666);
        margin: 0;
    }
    .error {
        color: var(--form-error, #b00020);
        margin: 0;
    }
    button {
        font: inherit;
        padding: 0.2rem 0.6rem;
    }
</style>
