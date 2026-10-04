// Installation configuration of this browser (backlog N1): localStorage,
// falling back to the development defaults injected at build time
// (see vite.config.ts). Without a valid configuration the app shows setup.
import { parseClientConfig, type ClientConfig } from './client-config.ts';

declare const __CLIENT_CONFIG__: Record<string, string>;

const KEY = 'anmeldung.secretariat.config';

function buildDefaults(): unknown {
    const c = __CLIENT_CONFIG__;
    return {
        schemaVersion: 1,
        tenantId: c.TENANT_ID,
        clientId: c.APP_CLIENT_ID,
        ...(c.APP_REDIRECT_URI && { redirectUri: c.APP_REDIRECT_URI }),
        siteId: c.SHAREPOINT_ID,
        siteUrl: c.SHAREPOINT_URL,
    };
}

function stored(): unknown {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return null; // broken entry: setup
    }
}

const raw = stored();
/** where the active configuration came from */
export const configSource: 'browser' | 'defaults' = raw === undefined ? 'defaults' : 'browser';
const parsed = parseClientConfig(raw === undefined ? buildDefaults() : raw);

/** undefined when missing or invalid; the app then shows the setup screen */
export const clientConfig: ClientConfig | undefined = parsed.config;
export const configErrors = parsed.errors;

export function saveClientConfig(config: ClientConfig): void {
    localStorage.setItem(KEY, JSON.stringify(config));
}

export function resetClientConfig(): void {
    localStorage.removeItem(KEY);
}

/** Active configuration; only call where the app is set up. */
export function requireConfig(): ClientConfig {
    if (!clientConfig) throw new Error('Keine gültige Installationskonfiguration');
    return clientConfig;
}
