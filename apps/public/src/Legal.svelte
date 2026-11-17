<!-- Imprint and privacy notice: Markdown text from the Assets library. -->
<script lang="ts">
    import { loadLegalText, type LegalDoc } from './api.ts';
    import { parseMarkdown, type Inline } from './markdown.ts';

    let { doc }: { doc: LegalDoc } = $props();

    const TITLES: Record<LegalDoc, string> = { impressum: 'Impressum', datenschutz: 'Datenschutzerklärung' };

    let blocks: ReturnType<typeof parseMarkdown> | undefined = $state();
    let missing = $state(false);

    $effect(() => {
        blocks = undefined;
        missing = false;
        loadLegalText(doc).then((text) => {
            if (text === undefined) missing = true;
            else blocks = parseMarkdown(text);
        });
    });
</script>

{#snippet inline(parts: Inline[])}
    {#each parts as part}
        {#if part.t === 'strong'}<strong>{part.v}</strong>
        {:else if part.t === 'link'}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.v}</a>
        {:else if part.t === 'br'}<br />
        {:else}{part.v}{/if}
    {/each}
{/snippet}

<h2>{TITLES[doc]}</h2>
{#if missing}
    <p>Dieser Text ist nicht hinterlegt.</p>
{:else if !blocks}
    <p>Wird geladen …</p>
{:else}
    <div class="legal" data-testid="legal-text">
        {#each blocks as block}
            {#if block.t === 'h'}
                <svelte:element this={`h${block.level + 1}`}>{@render inline(block.inline)}</svelte:element>
            {:else if block.t === 'ul'}
                <ul>
                    {#each block.items as item}<li>{@render inline(item)}</li>{/each}
                </ul>
            {:else}
                <p>{@render inline(block.inline)}</p>
            {/if}
        {/each}
    </div>
{/if}
