<script lang="ts">
    import { api, LOGO_URL, type PublicConfig, type PublicProcedure } from './api.ts';
    import Preview from './Preview.svelte';
    import Registration from './Registration.svelte';
    import { session, type Session } from './session.ts';

    let route = $state(location.hash);
    window.addEventListener('hashchange', () => (route = location.hash));

    let config: PublicConfig | undefined = $state();
    let error = $state('');
    let logoVisible = $state(true);
    let chosen: PublicProcedure | undefined = $state();
    let resume: Session | undefined = $state();
    let alreadySubmitted = $state(false);

    const schoolName = $derived(config?.config.schoolName ?? '');
    const procedure = $derived(
        chosen ??
            config?.procedures.find((p) => p.id === resume?.procedureId) ??
            (config?.procedures.length === 1 ? config.procedures[0] : undefined),
    );

    /** A booking from an earlier visit on this device continues at the form. */
    async function checkSession(): Promise<void> {
        const stored = session.load();
        if (!stored) return;
        try {
            const status = await api.application(stored.applicationId, stored.token);
            if (status.state === 'created' || status.state === 'form_in_progress') resume = stored;
            else {
                alreadySubmitted = true;
                session.clear();
            }
        } catch {
            session.clear();
        }
    }

    $effect(() => {
        document.title = schoolName ? `Anmeldung – ${schoolName}` : 'Anmeldung';
    });

    $effect(() => {
        if (route === '#vorschau' || config) return;
        Promise.all([api.config(), checkSession()])
            .then(([c]) => (config = c))
            .catch((e) => (error = e instanceof Error ? e.message : String(e)));
    });
</script>

<main>
    {#if route === '#vorschau'}
        <Preview />
    {:else}
        <header>
            {#if config?.hasLogo && logoVisible}<img src={LOGO_URL} alt="" onerror={() => (logoVisible = false)} />{/if}
            <div>
                {#if schoolName}<p class="school">{schoolName}</p>{/if}
                <h1>{procedure?.title ?? 'Anmeldung'}</h1>
            </div>
        </header>

        {#if error}
            <p class="error" role="alert">{error}</p>
        {:else if !config}
            <p>Wird geladen …</p>
        {:else if alreadySubmitted}
            <p>Ihre Anmeldung wurde bereits abgeschickt. Vielen Dank!</p>
        {:else if !config.procedures.length}
            <p>Zurzeit ist keine Anmeldung möglich.</p>
        {:else if !procedure}
            <h2>Bitte wählen Sie das Anmeldeverfahren</h2>
            {#each config.procedures as p (p.id)}
                <button class="procedure" onclick={() => (chosen = p)}>
                    <strong>{p.title}</strong>
                    {#if p.description}<br /><span>{p.description}</span>{/if}
                </button>
            {/each}
        {:else}
            {#if procedure.description}<p class="description">{procedure.description}</p>{/if}
            {#key procedure.id}
                <Registration {procedure} consentText={config.config.consentText} resume={resume?.procedureId === procedure.id ? resume : undefined} />
            {/key}
        {/if}
    {/if}
</main>

<style>
    :global(:root) {
        --accent: #2456a6;
    }
    :global(body) {
        font-family: system-ui, sans-serif;
        margin: 0;
        line-height: 1.4;
    }
    :global(button) {
        font: inherit;
        padding: 0.45rem 0.9rem;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: white;
        border-radius: 4px;
        cursor: pointer;
    }
    :global(button.secondary) {
        background: white;
        color: var(--accent);
    }
    :global(button:disabled) {
        opacity: 0.5;
        cursor: default;
    }
    :global(input) {
        font: inherit;
        padding: 0.35rem 0.5rem;
    }
    :global(.error) {
        color: #b00020;
    }
    main {
        max-width: 48rem;
        margin: 1.5rem auto 3rem;
        padding: 0 1rem;
    }
    header {
        display: flex;
        gap: 1rem;
        align-items: center;
        border-bottom: 1px solid #ddd;
        margin-bottom: 1rem;
    }
    header img {
        max-height: 4rem;
        max-width: 10rem;
    }
    .school {
        margin: 0.5rem 0 0;
        color: #555;
    }
    h1 {
        margin: 0.2rem 0 0.8rem;
    }
    .procedure {
        display: block;
        width: 100%;
        text-align: left;
        margin-bottom: 0.5rem;
        background: white;
        color: inherit;
        border-color: #bbb;
    }
    .description {
        color: #444;
    }
</style>
