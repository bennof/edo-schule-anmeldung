// How the secretariat reaches SVWS (backlog N2). The architecture must allow
//   Browser -> SVWS, Browser -> CORS proxy -> SVWS, Tauri -> SVWS.
// No concrete SVWS endpoints are called yet (see M1).

export type TransportKind = 'direct' | 'proxy' | 'tauri';

export interface SvwsEndpoint {
    /** base URL of the SVWS server, e.g. https://svws.schule.local:8443 */
    url: string;
    transport: TransportKind;
    /** for `proxy`: URL of the CORS proxy */
    proxyUrl?: string;
}

export interface SvwsResponse {
    status: number;
    body: unknown;
}

export interface SvwsTransport {
    readonly kind: TransportKind;
    request(method: string, path: string, body?: unknown): Promise<SvwsResponse>;
}

/** Tauri command bridge, injected by a desktop shell (window.__TAURI__.core.invoke). */
export type TauriInvoke = (command: string, args: Record<string, unknown>) => Promise<SvwsResponse>;

export interface TransportDeps {
    fetch?: typeof fetch;
    tauriInvoke?: TauriInvoke;
}

/** Problems with an endpoint configuration; empty when valid. */
export function checkEndpoint(e: SvwsEndpoint): string[] {
    const errors: string[] = [];
    if (!isHttpUrl(e.url)) errors.push('SVWS-Adresse muss mit https:// oder http:// beginnen');
    if (!['direct', 'proxy', 'tauri'].includes(e.transport)) errors.push(`Unbekannter Transportweg "${e.transport}"`);
    if (e.transport === 'proxy' && !isHttpUrl(e.proxyUrl ?? '')) errors.push('Für den Proxy-Weg wird die Proxy-Adresse benötigt');
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
        async request(method, path, body) {
            const { url, headers } = target(path);
            const res = await fetchFn(url, {
                method,
                headers: { ...headers, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
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
        case 'tauri':
            return {
                kind: 'tauri',
                async request(method, path, body) {
                    if (!deps.tauriInvoke) throw new Error('Tauri-Umgebung nicht verfügbar');
                    return deps.tauriInvoke('svws_request', { method, url: base + path, body });
                },
            };
    }
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
