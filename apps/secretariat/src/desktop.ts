// Running inside the desktop app (Tauri)? The app marks its window with
// `window.__EDO_DESKTOP__` (desktop/src/main.rs) and serves the page from its
// local server, which also hosts the SVWS proxy at /svws-proxy.
import type { SvwsEndpoint } from '@anmeldung/svws';

export const isDesktop = Boolean((window as { __EDO_DESKTOP__?: unknown }).__EDO_DESKTOP__);

/** In the desktop app SVWS is always reached through its built-in proxy. */
export function svwsEndpoint(endpoint: SvwsEndpoint | undefined): SvwsEndpoint | undefined {
    if (!endpoint || !isDesktop) return endpoint;
    return { ...endpoint, transport: 'proxy', proxyUrl: `${location.origin}/svws-proxy` };
}
