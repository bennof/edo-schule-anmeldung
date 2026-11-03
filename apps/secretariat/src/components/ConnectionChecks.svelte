<!-- Connection tests in the settings: SharePoint (with the signed-in user),
     the public server (incl. its own SharePoint access) and SVWS. -->
<script lang="ts">
    import { SCHEMA_VERSION } from '@anmeldung/sharepoint';
    import { requireConfig } from '../config.ts';
    import { config, errorText, site, svws } from '../services.ts';
    import { rememberSvwsUser, svwsCredentials, svwsLogin } from '../svws-credentials.svelte.ts';

    interface Result {
        ok: boolean;
        text: string;
        ms: number;
    }

    const clientConfig = requireConfig();
    let publicUrl = $state('');
    let busy: Record<string, boolean> = $state({});
    let results: Record<string, Result | undefined> = $state({});

    const publicUrlLoaded = config
        .get('publicUrl')
        .then((v) => (publicUrl = v ?? ''))
        .catch(() => {});

    async function run(key: string, task: () => Promise<string>): Promise<void> {
        busy[key] = true;
        results[key] = undefined;
        const start = performance.now();
        try {
            const text = await task();
            results[key] = { ok: true, text, ms: Math.round(performance.now() - start) };
        } catch (e) {
            results[key] = { ok: false, text: errorText(e), ms: Math.round(performance.now() - start) };
        } finally {
            busy[key] = false;
        }
    }

    const checkSharePoint = () =>
        run('sharepoint', async () => {
            const s = await site.graph.json<{ displayName?: string }>('GET', `/sites/${clientConfig.siteId}?$select=displayName`);
            const schema = await config.get('schemaVersion').catch(() => undefined);
            const state = schema ? `Schema Version ${schema}${schema === String(SCHEMA_VERSION) ? '' : ` (App erwartet ${SCHEMA_VERSION})`}` : 'Schema nicht initialisiert';
            return `Verbunden mit „${s.displayName ?? clientConfig.siteId}“ · ${state}`;
        });

    const checkServer = () =>
        run('server', async () => {
            await publicUrlLoaded;
            if (!publicUrl) throw new Error('„publicUrl“ ist in der Konfiguration nicht gesetzt.');
            let res: Response;
            try {
                res = await fetch(`${publicUrl.replace(/\/+$/, '')}/api/status`, { cache: 'no-store' });
            } catch {
                throw new Error(`Server unter ${publicUrl} nicht erreichbar.`);
            }
            const body = await res.json().catch(() => ({}));
            if (body.sharepoint === 'error') throw new Error(`Server läuft (Version ${body.version}), erreicht SharePoint aber nicht. Rechte der Daemon-App prüfen.`);
            if (!res.ok || body.status !== 'ok') throw new Error(`Unerwartete Antwort (HTTP ${res.status}).`);
            return `Server läuft (Version ${body.version}) · SharePoint-Zugriff des Servers in Ordnung`;
        });

    const checkSvws = () =>
        run('svws', async () => {
            const info = await svws.check(svwsCredentials());
            rememberSvwsUser();
            return info;
        });
</script>

{#snippet outcome(key: string)}
    {@const r = results[key]}
    {#if busy[key]}
        <p class="result muted" role="status">Wird geprüft …</p>
    {:else if r}
        <p class="result" class:ok={r.ok} class:fail={!r.ok} role="status" data-testid={`check-${key}`}>
            <span class="dot" aria-hidden="true"></span>{r.text} <span class="muted">· {r.ms} ms</span>
        </p>
    {/if}
{/snippet}

<div class="checks">
    <div class="check">
        <div class="head">
            <div>
                <h3>SharePoint</h3>
                <p class="muted target">{clientConfig.siteUrl || clientConfig.siteId}</p>
            </div>
            <button class="secondary" onclick={checkSharePoint} disabled={busy.sharepoint}>SharePoint prüfen</button>
        </div>
        {@render outcome('sharepoint')}
    </div>

    <div class="check">
        <div class="head">
            <div>
                <h3>Öffentlicher Server</h3>
                <p class="muted target">{publicUrl ? `${publicUrl.replace(/\/+$/, '')}/api` : '„publicUrl“ nicht gesetzt'}</p>
            </div>
            <button class="secondary" onclick={checkServer} disabled={busy.server}>Server prüfen</button>
        </div>
        {@render outcome('server')}
    </div>

    <div class="check">
        <div class="head">
            <div>
                <h3>SVWS</h3>
                <p class="muted target">{svws.status()}</p>
            </div>
            <button class="secondary" onclick={checkSvws} disabled={busy.svws || !svws.ready || !svwsLogin.user.trim()}>SVWS prüfen</button>
        </div>
        {#if svws.ready}
            <div class="login">
                <label>SVWS-Benutzer <input bind:value={svwsLogin.user} autocomplete="username" /></label>
                <label>Passwort <input type="password" bind:value={svwsLogin.password} autocomplete="current-password" /></label>
            </div>
            <p class="muted hint">Der Benutzername wird in diesem Browser gemerkt, das Passwort nur bis zum Neuladen oder Abmelden.</p>
        {/if}
        {@render outcome('svws')}
    </div>
</div>

<style>
    .checks {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
    }
    .check {
        padding: 1rem 1.25rem;
    }
    .check + .check {
        border-top: 1px solid var(--border);
    }
    .head {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: center;
        justify-content: space-between;
    }
    h3 {
        margin: 0;
        font-size: 1rem;
    }
    .target {
        margin: 0.1rem 0 0;
        font-size: 0.85rem;
        overflow-wrap: anywhere;
    }
    .login {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        margin-top: 0.75rem;
    }
    .login label {
        display: grid;
        gap: 0.2rem;
    }
    .hint {
        margin: 0.5rem 0 0;
        font-size: 0.8rem;
    }
    .result {
        margin: 0.75rem 0 0;
        font-size: 0.9rem;
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        flex-wrap: wrap;
    }
    .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: var(--text-muted);
        flex: none;
        align-self: center;
    }
    .ok .dot {
        background: var(--success);
    }
    .fail {
        color: var(--danger);
    }
    .fail .dot {
        background: var(--danger);
    }
</style>
