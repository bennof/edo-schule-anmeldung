// How the secretariat reaches SVWS: directly from the browser, or through a
// CORS proxy (the desktop app brings one on http://localhost:8964/svws-proxy).

export type TransportKind = 'direct' | 'proxy';

export interface SvwsEndpoint {
    /** base URL of the SVWS server, e.g. https://svws.schule.local:8443 */
    url: string;
    transport: TransportKind;
    /** for `proxy`: URL of the CORS proxy */
    proxyUrl?: string;
    /** database schema of the school in SVWS, e.g. "gymabi" */
    schema?: string;
    /** school year of new students (e.g. 2026 for 2026/27); default: current section */
    schuljahr?: number;
}

export interface SvwsResponse {
    status: number;
    body: unknown;
}

export interface SvwsTransport {
    readonly kind: TransportKind;
    request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<SvwsResponse>;
}

export interface TransportDeps {
    fetch?: typeof fetch;
}

/** Problems with an endpoint configuration; empty when valid. */
export function checkEndpoint(e: SvwsEndpoint): string[] {
    const errors: string[] = [];
    if (!isHttpUrl(e.url)) errors.push('SVWS-Adresse muss mit https:// oder http:// beginnen');
    if (!['direct', 'proxy'].includes(e.transport)) errors.push(`Unbekannter Transportweg "${e.transport}"`);
    if (e.transport === 'proxy' && !isHttpUrl(e.proxyUrl ?? '')) errors.push('Für den Proxy-Weg wird die Proxy-Adresse benötigt');
    if (e.schema !== undefined && !/^[A-Za-z0-9_]+$/.test(e.schema)) errors.push('Das SVWS-Schema darf nur Buchstaben, Ziffern und _ enthalten');
    if (e.schuljahr !== undefined && !(Number.isInteger(e.schuljahr) && e.schuljahr >= 2000 && e.schuljahr <= 2100)) errors.push('Schuljahr als Jahreszahl angeben, z. B. 2026');
    return errors;
}

function isHttpUrl(value: string): boolean {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

export function createTransport(endpoint: SvwsEndpoint, deps: TransportDeps = {}): SvwsTransport {
    const errors = checkEndpoint(endpoint);
    if (errors.length) throw new Error(errors.join('; '));
    const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    const base = endpoint.url.replace(/\/+$/, '');

    const viaFetch = (kind: TransportKind, target: (path: string) => { url: string; headers: Record<string, string> }): SvwsTransport => ({
        kind,
        async request(method, path, body, extra) {
            const { url, headers } = target(path);
            const res = await fetchFn(url, {
                method,
                headers: { ...headers, ...extra, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await res.text();
            return { status: res.status, body: text ? safeJson(text) : undefined };
        },
    });

    switch (endpoint.transport) {
        case 'direct':
            return viaFetch('direct', (path) => ({ url: base + path, headers: {} }));
        case 'proxy':
            // the proxy forwards to the SVWS server named in X-SVWS-Target
            return viaFetch('proxy', (path) => ({
                url: endpoint.proxyUrl!.replace(/\/+$/, '') + path,
                headers: { 'X-SVWS-Target': base },
            }));
    }
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
