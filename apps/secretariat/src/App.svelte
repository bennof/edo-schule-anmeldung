<script lang="ts">
    import { GraphError } from '@anmeldung/sharepoint';
    import type { AccountInfo } from '@azure/msal-browser';
    import { initAuth, login, logout } from './auth.ts';
    import { clientConfig } from './config.ts';
    import { errorText, site } from './services.ts';
    import Applications from './views/Applications.svelte';
    import Forms from './views/Forms.svelte';
    import Procedures from './views/Procedures.svelte';
    import Setup from './views/Setup.svelte';

    type Status = 'loading' | 'signedOut' | 'denied' | 'ready' | 'error';

    const VIEWS = [
        { hash: '#start', label: 'Start', component: Setup },
        { hash: '#verfahren', label: 'Verfahren', component: Procedures },
        { hash: '#formulare', label: 'Formulare', component: Forms },
        { hash: '#anmeldungen', label: 'Anmeldungen', component: Applications },
    ];

    let status: Status = $state('loading');
    let account: AccountInfo | null = $state(null);
    let message = $state('');
    let route = $state(location.hash);
    window.addEventListener('hashchange', () => (route = location.hash));
    const view = $derived(VIEWS.find((v) => v.hash === route) ?? VIEWS[0]);

    async function start(): Promise<void> {
        try {
            account = await initAuth();
            if (!account) {
                status = 'signedOut';
                return;
            }
            // authorization = the user's access to the site
            await site.graph.json('GET', `/sites/${clientConfig.siteId}?$select=id`);
            status = 'ready';
        } catch (e) {
            if (e instanceof GraphError && [401, 403, 404].includes(e.status)) {
                status = 'denied';
            } else {
                status = 'error';
                message = errorText(e);
            }
        }
    }

    start();
</script>

<main>
    <header class="top">
        <h1>Sekretariat</h1>
        {#if status === 'ready'}
            <nav>
                {#each VIEWS as v (v.hash)}
                    <a href={v.hash} aria-current={v === view ? 'page' : undefined}>{v.label}</a>
                {/each}
            </nav>
            <span class="user">Angemeldet als <strong>{account?.name ?? account?.username}</strong></span>
            <button class="secondary" onclick={logout}>Abmelden</button>
        {/if}
    </header>

    {#if status === 'loading'}
        <p>Wird geladen …</p>
    {:else if status === 'signedOut'}
        <p>Bitte mit dem Microsoft-365-Konto der Schule anmelden.</p>
        <button onclick={login}>Anmelden</button>
    {:else if status === 'denied'}
        <p>Das Konto <strong>{account?.username}</strong> hat keinen Zugriff auf die SharePoint-Site des Anmeldesystems.</p>
        <button onclick={logout}>Abmelden</button>
    {:else if status === 'error'}
        <p class="error">{message}</p>
    {:else}
        {#key view.hash}
            <view.component />
        {/key}
    {/if}
</main>

<style>
    main {
        max-width: 60rem;
        margin: 1rem auto 3rem;
        padding: 0 1rem;
    }
    .top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        border-bottom: 1px solid #ddd;
        margin-bottom: 1rem;
    }
    nav {
        display: flex;
        gap: 0.75rem;
        flex: 1;
    }
    nav a[aria-current='page'] {
        font-weight: 600;
        text-decoration: none;
        color: inherit;
    }
</style>
