<script lang="ts">
    import { GraphError } from '@anmeldung/sharepoint';
    import type { AccountInfo } from '@azure/msal-browser';
    import { initAuth, login, logout } from './auth.ts';
    import { clientConfig } from './config.ts';
    import { errorText, site } from './services.ts';
    import Applications from './views/Applications.svelte';
    import Appointments from './views/Appointments.svelte';
    import Assets from './views/Assets.svelte';
    import Day from './views/Day.svelte';
    import Forms from './views/Forms.svelte';
    import Procedures from './views/Procedures.svelte';
    import Setup from './views/Setup.svelte';
    import ConfigEditor from './components/ConfigEditor.svelte';

    type Status = 'loading' | 'setup' | 'signedOut' | 'denied' | 'ready' | 'error';

    // icons: 24x24 stroke paths
    // the work steps in the order they are done, then the setup
    const STEPS = [
        { hash: '#formulare', label: 'Formulare', component: Forms, icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4' },
        { hash: '#verfahren', label: 'Verfahren', component: Procedures, icon: 'M4 6h16M4 12h16M4 18h10' },
        { hash: '#termine', label: 'Termine', component: Appointments, icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
        { hash: '#tag', label: 'Tagesansicht', component: Day, icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
        { hash: '#anmeldungen', label: 'Anmeldungen', component: Applications, icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5' },
    ];
    const SETUP = [
        { hash: '#dateien', label: 'Dateien', component: Assets, icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
        { hash: '#einstellungen', label: 'Einstellungen', component: Setup, icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
    ];
    const VIEWS = [...STEPS, ...SETUP];
    const START = VIEWS.find((v) => v.hash === '#tag')!;
    let status: Status = $state('loading');
    let account = $state<AccountInfo | null>(null);
    let message = $state('');
    let route = $state(location.hash);
    let menuOpen = $state(false);
    let accountOpen = $state(false);
    let photo: string | undefined = $state();
    window.addEventListener('hashchange', () => {
        route = location.hash;
        menuOpen = false;
    });
    // sub-routes like #tag/2026-10-07 belong to their view
    const view = $derived(VIEWS.find((v) => route === v.hash || route.startsWith(`${v.hash}/`)) ?? START);
    const userName = $derived(account?.name ?? account?.username ?? '');
    const initials = $derived(
        userName
            .split(/[\s@.]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]!.toUpperCase())
            .join(''),
    );

    async function start(): Promise<void> {
        if (!clientConfig) {
            status = 'setup';
            return;
        }
        try {
            account = await initAuth();
            if (!account) {
                status = 'signedOut';
                return;
            }
            // authorization = the user's access to the site
            await site.graph.json('GET', `/sites/${clientConfig!.siteId}?$select=id`);
            status = 'ready';
            loadPhoto();
        } catch (e) {
            if (e instanceof GraphError && [401, 403, 404].includes(e.status)) {
                status = 'denied';
            } else {
                status = 'error';
                message = errorText(e);
            }
        }
    }

    /** Profile photo from Microsoft 365; without one the initials stay. */
    async function loadPhoto(): Promise<void> {
        try {
            const res = await site.graph.request('GET', '/me/photos/96x96/$value');
            photo = URL.createObjectURL(await res.blob());
        } catch {
            // no photo or no permission
        }
    }

    function closeAccount(e: MouseEvent | KeyboardEvent): void {
        if (!accountOpen) return;
        if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.account')) accountOpen = false;
    }

    start();
</script>

<svelte:window onclick={closeAccount} onkeydown={closeAccount} />

{#snippet link(v: (typeof VIEWS)[number])}
    <a href={v.hash} aria-current={v === view ? 'page' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={v.icon} /></svg>
        {v.label}
    </a>
{/snippet}

{#if status === 'ready'}
    <div class="shell">
        <header class="topbar">
            <button class="menu" aria-label="Menü öffnen" aria-expanded={menuOpen} onclick={() => (menuOpen = true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span class="brand">Sekretariat</span>
        </header>
        {#if menuOpen}<button class="backdrop" aria-label="Menü schließen" onclick={() => (menuOpen = false)}></button>{/if}
        <aside class="sidebar" class:open={menuOpen}>
            <div class="brand">Sekretariat</div>
            <nav aria-label="Hauptnavigation">
                <div class="group">
                    <span class="caption">Ablauf</span>
                    {#each STEPS as v (v.hash)}{@render link(v)}{/each}
                </div>
                <div class="group setup">
                    <span class="caption">Einrichtung</span>
                    {#each SETUP as v (v.hash)}{@render link(v)}{/each}
                </div>
            </nav>
            <div class="account">
                {#if accountOpen}
                    <div class="popup" role="menu" aria-label="Konto">
                        <div class="who">
                            <strong>{userName}</strong>
                            {#if account?.username && account.username !== userName}<span class="muted">{account.username}</span>{/if}
                        </div>
                        <button role="menuitem" onclick={logout}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                            Abmelden
                        </button>
                    </div>
                {/if}
                <button class="me" aria-haspopup="menu" aria-expanded={accountOpen} onclick={() => (accountOpen = !accountOpen)}>
                    {#if photo}
                        <img class="avatar" src={photo} alt="" />
                    {:else}
                        <span class="avatar" aria-hidden="true">{initials}</span>
                    {/if}
                    <span class="user">Angemeldet als <strong>{userName}</strong></span>
                </button>
            </div>
        </aside>
        <main class="content">
            {#key view.hash}
                <view.component />
            {/key}
        </main>
    </div>
{:else}
    <main class="center">
        <div class="card" class:wide={status === 'setup'}>
            <div class="brand">Sekretariat</div>
            {#if status === 'loading'}
                <p class="muted">Wird geladen …</p>
            {:else if status === 'setup'}
                <h2>Einrichtung dieses Browsers</h2>
                <p class="muted">
                    Für diesen Browser ist noch keine gültige Installationskonfiguration hinterlegt. Bitte die Konfigurationsdatei der Schule importieren oder die
                    Werte eintragen.
                </p>
                <ConfigEditor />
            {:else if status === 'signedOut'}
                <h2>Willkommen</h2>
                <p class="muted">Bitte mit dem Microsoft-365-Konto der Schule anmelden.</p>
                <button onclick={login}>Anmelden</button>
            {:else if status === 'denied'}
                <h2>Kein Zugriff</h2>
                <p class="muted">Das Konto <strong>{account?.username}</strong> hat keinen Zugriff auf die SharePoint-Site des Anmeldesystems.</p>
                <button onclick={logout}>Abmelden</button>
            {:else if status === 'error'}
                <p class="error">{message}</p>
            {/if}
        </div>
    </main>
{/if}

<style>
    .shell {
        display: grid;
        grid-template-columns: var(--sidebar) 1fr;
        min-height: 100vh;
    }
    .topbar,
    .backdrop {
        display: none;
    }
    .sidebar {
        position: sticky;
        top: 0;
        height: 100vh;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem 0.75rem;
        background: var(--surface);
        overflow-y: auto;
    }
    .brand {
        font-weight: 600;
        font-size: 1.05rem;
        padding: 0.25rem 0.6rem;
    }
    nav {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }
    .group {
        display: grid;
        gap: 2px;
    }
    .group.setup {
        margin-top: auto;
    }
    .caption {
        font-size: 0.75rem;
        color: var(--text-muted);
        padding: 0 0.6rem 0.25rem;
    }
    nav a {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.6rem;
        border-radius: var(--radius);
        text-decoration: none;
        font-size: 0.92rem;
    }
    nav a:hover {
        background: var(--surface-2);
    }
    nav a[aria-current='page'] {
        background: var(--surface-2);
        font-weight: 500;
    }
    svg {
        width: 1.1rem;
        height: 1.1rem;
        flex: none;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    nav svg {
        opacity: 0.8;
    }
    .account {
        position: relative;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border);
    }
    .me {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.6rem;
        background: transparent;
        color: var(--text);
        border: 0;
        border-radius: var(--radius);
        text-align: left;
        font-weight: 400;
    }
    .me:hover,
    .me[aria-expanded='true'] {
        background: var(--surface-2);
        opacity: 1;
    }
    .avatar {
        width: 2rem;
        height: 2rem;
        flex: none;
        border-radius: 999px;
        display: grid;
        place-items: center;
        object-fit: cover;
        background: var(--accent);
        color: var(--accent-text);
        font-size: 0.75rem;
        font-weight: 600;
    }
    .user {
        font-size: 0.8rem;
        color: var(--text-muted);
        line-height: 1.3;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .user strong {
        display: block;
        color: var(--text);
        font-size: 0.9rem;
        font-weight: 500;
    }
    .popup {
        position: absolute;
        left: 0;
        right: 0;
        bottom: calc(100% + 0.25rem);
        z-index: 40;
        padding: 0.4rem;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
    }
    .who {
        display: grid;
        padding: 0.5rem 0.6rem 0.6rem;
        margin-bottom: 0.3rem;
        border-bottom: 1px solid var(--border);
        font-size: 0.85rem;
        overflow-wrap: anywhere;
    }
    .who strong {
        font-weight: 500;
    }
    .popup button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0.6rem;
        background: transparent;
        color: var(--text);
        border: 0;
        border-radius: var(--radius);
        font-weight: 400;
        text-align: left;
    }
    .popup button:hover {
        background: var(--surface-2);
        opacity: 1;
    }
    .content {
        width: 100%;
        max-width: 64rem;
        margin: 0 auto;
        padding: 2.5rem 2rem 4rem;
        min-width: 0;
    }
    .center {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem 1rem;
    }
    .card {
        width: 100%;
        max-width: 24rem;
        text-align: center;
        display: grid;
        gap: 0.5rem;
        justify-items: center;
    }
    .card.wide {
        max-width: 40rem;
        text-align: left;
        justify-items: stretch;
    }
    .card .brand {
        font-size: 1.25rem;
        margin-bottom: 1.5rem;
    }
    .card h2 {
        margin: 0;
    }
    .card p {
        margin: 0 0 1rem;
    }
    /* tablets: narrower sidebar and content padding */
    @media (max-width: 1100px) {
        .shell {
            grid-template-columns: 13rem 1fr;
        }
        .content {
            padding: 2rem 1.5rem 3rem;
        }
    }
    /* phones: top bar with a menu button, sidebar as a drawer */
    @media (max-width: 800px) {
        .shell {
            display: block;
        }
        .topbar {
            position: sticky;
            top: 0;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.75rem;
            background: var(--bg);
            border-bottom: 1px solid var(--border);
        }
        .menu {
            display: grid;
            place-items: center;
            padding: 0.4rem;
            background: transparent;
            color: var(--text);
            border: 0;
            border-radius: var(--radius);
        }
        .menu:hover {
            background: var(--surface-2);
            opacity: 1;
        }
        .menu svg {
            width: 1.3rem;
            height: 1.3rem;
        }
        .topbar .brand {
            padding: 0;
            font-size: 1rem;
        }
        .backdrop {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 20;
            background: rgb(0 0 0 / 0.4);
            border: 0;
            border-radius: 0;
            padding: 0;
        }
        .sidebar {
            position: fixed;
            z-index: 30;
            inset: 0 auto 0 0;
            width: min(18rem, 85vw);
            height: 100dvh;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
        }
        .sidebar.open {
            transform: none;
        }
        .content {
            padding: 1.25rem 1rem 3rem;
        }
        /* wide tables scroll inside the page instead of breaking the layout */
        .content :global(table) {
            display: block;
            overflow-x: auto;
        }
        .content :global(th),
        .content :global(td) {
            white-space: nowrap;
        }
    }
</style>
