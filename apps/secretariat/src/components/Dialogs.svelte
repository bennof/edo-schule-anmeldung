<!-- Confirmation dialog and notices of dialogs.svelte.ts; placed once in App.svelte. -->
<script lang="ts">
    import { dialogs } from '../dialogs.svelte.ts';

    let dialog: HTMLDialogElement | undefined = $state();

    $effect(() => {
        if (!dialog) return;
        if (dialogs.question && !dialog.open) dialog.showModal();
        if (!dialogs.question && dialog.open) dialog.close();
    });
</script>

<dialog bind:this={dialog} oncancel={() => dialogs.question?.resolve(false)} aria-label="Bestätigung">
    {#if dialogs.question}
        <p>{dialogs.question.text}</p>
        <form method="dialog" class="actions">
            <button type="button" class="secondary" onclick={() => dialogs.question?.resolve(false)}>Abbrechen</button>
            <!-- svelte-ignore a11y_autofocus -->
            <button type="button" autofocus onclick={() => dialogs.question?.resolve(true)}>{dialogs.question.confirmLabel}</button>
        </form>
    {/if}
</dialog>

{#if dialogs.notice}<p class="notice" role="status">{dialogs.notice}</p>{/if}

<style>
    dialog {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 1.25rem 1.5rem;
        max-width: min(32rem, calc(100vw - 2rem));
        background: var(--bg, Canvas);
        color: inherit;
    }
    dialog::backdrop {
        background: rgb(0 0 0 / 0.35);
    }
    dialog p {
        margin: 0 0 1rem;
        white-space: pre-line;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }
    .notice {
        position: fixed;
        left: 50%;
        bottom: 1.25rem;
        transform: translateX(-50%);
        margin: 0;
        max-width: calc(100vw - 2rem);
        padding: 0.6rem 1rem;
        border-radius: var(--radius);
        background: var(--surface-2);
        border: 1px solid var(--border);
        box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
        z-index: 50;
        overflow-wrap: anywhere;
    }
</style>
