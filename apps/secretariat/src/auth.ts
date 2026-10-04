// Microsoft 365 login (backlog J1). No own user management: access is
// whatever the signed-in user may do on the SharePoint site.
import {
    InteractionRequiredAuthError,
    PublicClientApplication,
    type AccountInfo,
} from '@azure/msal-browser';
import { requireConfig } from './config.ts';

// delegated permissions as configured on the app registration
const SCOPES = ['https://graph.microsoft.com/.default'];

let instance: PublicClientApplication | undefined;

/** Created on first use, so the app can start without configuration (setup). */
function msalClient(): PublicClientApplication {
    if (!instance) {
        const config = requireConfig();
        instance = new PublicClientApplication({
            auth: {
                clientId: config.clientId,
                authority: `https://login.microsoftonline.com/${config.tenantId}`,
                redirectUri: config.redirectUri ?? window.location.origin,
            },
            cache: { cacheLocation: 'sessionStorage' },
        });
    }
    return instance;
}

/** Completes a pending redirect login and returns the signed-in account, if any. */
export async function initAuth(): Promise<AccountInfo | null> {
    const msal = msalClient();
    await msal.initialize();
    const result = await msal.handleRedirectPromise();
    const account = result?.account ?? msal.getAllAccounts()[0] ?? null;
    msal.setActiveAccount(account);
    return account;
}

export function login(): Promise<void> {
    return msalClient().loginRedirect({ scopes: SCOPES });
}

export function logout(): Promise<void> {
    return msalClient().logoutRedirect();
}

export async function getToken(): Promise<string> {
    const msal = msalClient();
    const account = msal.getActiveAccount();
    if (!account) throw new Error('Nicht angemeldet');
    try {
        return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
    } catch (e) {
        if (e instanceof InteractionRequiredAuthError) await msal.acquireTokenRedirect({ scopes: SCOPES, account });
        throw e;
    }
}
