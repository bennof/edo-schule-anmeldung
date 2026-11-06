<!-- Installation configuration of this browser (backlog N1, N2): edit,
     import and export as JSON. Contains no secrets. -->
<script lang="ts">
    import { exportClientConfig, parseClientConfig, type ClientConfig } from '../client-config.ts';
    import { clientConfig, configErrors, configSource, resetClientConfig, saveClientConfig } from '../config.ts';

    // signIn: only the Microsoft 365 block (gear on the sign-in screen);
    // the other values are kept as they are
    let { signIn = false }: { signIn?: boolean } = $props();

    const c = clientConfig;
    let tenantId = $state(c?.tenantId ?? '');
    let clientId = $state(c?.clientId ?? '');
    let redirectUri = $state(c?.redirectUri ?? '');
    let siteId = $state(c?.siteId ?? '');
    let siteUrl = $state(c?.siteUrl ?? '');
    let svwsUrl = $state(c?.svws?.url ?? '');
    let svwsTransport = $state(c?.svws?.transport ?? 'direct');
    let svwsProxyUrl = $state(c?.svws?.proxyUrl ?? '');
    let svwsSchema = $state(c?.svws?.schema ?? '');
    let svwsSchuljahr = $state(c?.svws?.schuljahr ? String(c.svws.schuljahr) : '');
    let errors: string[] = $state(clientConfig ? [] : configErrors.filter((e) => e !== 'Kein JSON-Objekt'));
    let message = $state('');

    function current(): unknown {
        return {
            schemaVersion: 1,
            tenantId,
            clientId,
            ...(redirectUri.trim() && { redirectUri }),
            siteId,
            siteUrl,
            ...(svwsUrl.trim() && {
                svws: {
                    url: svwsUrl,
                    transport: svwsTransport,
                    ...(svwsTransport === 'proxy' && { proxyUrl: svwsProxyUrl }),
                    ...(svwsSchema.trim() && { schema: svwsSchema.trim() }),
                    ...(svwsSchuljahr.trim() && { schuljahr: Number(svwsSchuljahr) }),
                },
            }),
            // not editable here, kept from the imported file
            ...(c?.daemonSecretExpires && { daemonSecretExpires: c.daemonSecretExpires }),
        };
    }

    function apply(value: unknown): void {
        const result = parseClientConfig(value);
        errors = result.errors;
        if (!result.config) return;
        saveClientConfig(result.config);
        message = 'Gespeichert. Die Anwendung wird neu geladen …';
        setTimeout(() => location.reload(), 300);
    }

    function exportJson(): void {
        const result = parseClientConfig(current());
        errors = result.errors;
        if (!result.config) return;
        const url = URL.createObjectURL(new Blob([exportClientConfig(result.config as ClientConfig)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: 'anmeldung-sekretariat-konfiguration.json' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    async function importJson(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        try {
            apply(JSON.parse(await file.text()));
        } catch {
            errors = ['Die Datei enthält kein gültiges JSON.'];
        }
    }

    function reset(): void {
        if (!confirm('Die in diesem Browser gespeicherte Konfiguration löschen?')) return;
        resetClientConfig();
        location.reload();
    }
</script>

<div class="config">
    {#if !signIn}<p class="muted">
        {#if clientConfig}Quelle: {configSource === 'browser' ? 'in diesem Browser gespeichert' : 'Vorgabe der Installation'}.{/if}
        Keine Geheimnisse eintragen – die Werte sind nicht vertraulich.
    </p>{/if}
    <form
        onsubmit={(e) => {
            e.preventDefault();
            apply(current());
        }}
    >
        <fieldset>
            <legend>Microsoft 365</legend>
            <label>Tenant-ID <input bind:value={tenantId} /></label>
            <label>Client-ID der App-Registrierung <input bind:value={clientId} /></label>
            <label>Redirect-URI (optional, sonst diese Adresse) <input bind:value={redirectUri} /></label>
        </fieldset>
        {#if !signIn}<fieldset>
            <legend>SharePoint</legend>
            <label>Site-ID <input bind:value={siteId} /></label>
            <label>Site-Adresse <input bind:value={siteUrl} placeholder="https://…sharepoint.com/sites/…" /></label>
        </fieldset>
        <fieldset>
            <legend>SVWS (optional)</legend>
            <label>SVWS-Adresse <input bind:value={svwsUrl} placeholder="https://svws.schule.local:8443" /></label>
            <label>
                Verbindung
                <select bind:value={svwsTransport}>
                    <option value="direct">Browser → SVWS</option>
                    <option value="proxy">Browser → CORS-Proxy → SVWS</option>
                </select>
            </label>
            {#if svwsTransport === 'proxy'}<label>Proxy-Adresse <input bind:value={svwsProxyUrl} /></label>{/if}
            <label>Datenbank-Schema der Schule <input bind:value={svwsSchema} placeholder="z. B. gymabi" /></label>
            <label>Schuljahr der Neuaufnahmen (optional) <input bind:value={svwsSchuljahr} placeholder="z. B. 2026 für 2026/27; leer = aktueller Abschnitt" /></label>
        </fieldset>{/if}
        {#if errors.length}<ul class="error" role="alert">{#each errors as e}<li>{e}</li>{/each}</ul>{/if}
        {#if message}<p role="status">{message}</p>{/if}
        <p class="actions">
            <button type="submit">Speichern</button>
            {#if !signIn}<button type="button" class="secondary" onclick={exportJson}>Exportieren (JSON)</button>
            <label class="button secondary-label">
                Importieren (JSON)
                <input type="file" accept="application/json,.json" onchange={importJson} hidden />
            </label>
            {#if configSource === 'browser'}<button type="button" class="secondary" onclick={reset}>Zurücksetzen</button>{/if}{/if}
        </p>
    </form>
</div>

<style>
    fieldset {
        display: grid;
        gap: 0.5rem;
        max-width: 40rem;
    }
    label {
        display: grid;
        gap: 0.2rem;
    }
    .actions label.button {
        display: inline-block;
    }
</style>
