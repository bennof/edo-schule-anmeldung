// Non-secret installation config, injected at build time (see vite.config.ts).
// Will move to localStorage with import/export in N1.
declare const __CLIENT_CONFIG__: Record<string, string>;

export const clientConfig = {
    tenantId: __CLIENT_CONFIG__.TENANT_ID,
    clientId: __CLIENT_CONFIG__.APP_CLIENT_ID,
    redirectUri: __CLIENT_CONFIG__.APP_REDIRECT_URI || window.location.origin,
    siteId: __CLIENT_CONFIG__.SHAREPOINT_ID,
    siteUrl: __CLIENT_CONFIG__.SHAREPOINT_URL,
};
