// Non-secret installation configuration of the secretariat SPA (backlog N1,
// N2), kept per browser in localStorage with JSON import/export. Pure logic
// here; storage in config.ts.
import { checkEndpoint, type SvwsEndpoint } from '@anmeldung/svws';

export const CLIENT_CONFIG_VERSION = 1;

export interface ClientConfig {
    schemaVersion: typeof CLIENT_CONFIG_VERSION;
    tenantId: string;
    clientId: string;
    /** defaults to the page origin */
    redirectUri?: string;
    siteId: string;
    siteUrl: string;
    /** later SVWS integration (N2), optional */
    svws?: SvwsEndpoint;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_KEYS = new Set(['schemaVersion', 'tenantId', 'clientId', 'redirectUri', 'siteId', 'siteUrl', 'svws']);

/** Validates parsed JSON; returns the config or the problems found. */
export function parseClientConfig(value: unknown): { config?: ClientConfig; errors: string[] } {
    const errors: string[] = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['Kein JSON-Objekt'] };
    const v = value as Record<string, unknown>;
    // never accept secrets in browser configuration
    const secretKeys = Object.keys(v).filter((k) => /secret|password|passwort|token/i.test(k));
    if (secretKeys.length) errors.push(`Geheimnisse gehören nicht in die Browser-Konfiguration: ${secretKeys.join(', ')}`);
    const unknown = Object.keys(v).filter((k) => !KNOWN_KEYS.has(k) && !secretKeys.includes(k));
    if (unknown.length) errors.push(`Unbekannte Einträge: ${unknown.join(', ')}`);
    if (v.schemaVersion !== CLIENT_CONFIG_VERSION) errors.push(`schemaVersion muss ${CLIENT_CONFIG_VERSION} sein`);
    const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '');
    if (!GUID.test(str('tenantId'))) errors.push('tenantId muss eine GUID sein');
    if (!GUID.test(str('clientId'))) errors.push('clientId muss eine GUID sein');
    if (!str('siteId')) errors.push('siteId fehlt');
    if (!/^https:\/\//.test(str('siteUrl'))) errors.push('siteUrl muss mit https:// beginnen');
    if (v.redirectUri !== undefined && !/^https?:\/\//.test(str('redirectUri'))) errors.push('redirectUri muss eine URL sein');
    let svws: SvwsEndpoint | undefined;
    if (v.svws !== undefined) {
        const s = v.svws as Record<string, unknown>;
        svws = { url: String(s?.url ?? ''), transport: (s?.transport ?? 'direct') as SvwsEndpoint['transport'] };
        if (s?.proxyUrl) svws.proxyUrl = String(s.proxyUrl);
        errors.push(...checkEndpoint(svws).map((e) => `SVWS: ${e}`));
    }
    if (errors.length) return { errors };
    return {
        errors,
        config: {
            schemaVersion: CLIENT_CONFIG_VERSION,
            tenantId: str('tenantId'),
            clientId: str('clientId'),
            ...(str('redirectUri') && { redirectUri: str('redirectUri') }),
            siteId: str('siteId'),
            siteUrl: str('siteUrl'),
            ...(svws && { svws }),
        },
    };
}

export function exportClientConfig(config: ClientConfig): string {
    return JSON.stringify(config, null, 2);
}
