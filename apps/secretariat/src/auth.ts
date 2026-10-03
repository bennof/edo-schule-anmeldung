// Microsoft 365 login (backlog J1). No own user management: access is
// whatever the signed-in user may do on the SharePoint site.
import {
    InteractionRequiredAuthError,
    PublicClientApplication,
    type AccountInfo,
} from '@azure/msal-browser';
import { clientConfig } from './config.ts';

// delegated permissions as configured on the app registration
const SCOPES = ['https://graph.microsoft.com/.default'];

const msal = new PublicClientApplication({
    auth: {
        clientId: clientConfig.clientId,
        authority: `https://login.microsoftonline.com/${clientConfig.tenantId}`,
        redirectUri: clientConfig.redirectUri,
    },
    cache: { cacheLocation: 'sessionStorage' },
});

/** Completes a pending redirect login and returns the signed-in account, if any. */
export async function initAuth(): Promise<AccountInfo | null> {
    await msal.initialize();
    const result = await msal.handleRedirectPromise();
    const account = result?.account ?? msal.getAllAccounts()[0] ?? null;
    msal.setActiveAccount(account);
    return account;
}

export function login(): Promise<void> {
    return msal.loginRedirect({ scopes: SCOPES });
}

export function logout(): Promise<void> {
    return msal.logoutRedirect();
}

export async function getToken(): Promise<string> {
    const account = msal.getActiveAccount();
    if (!account) throw new Error('Nicht angemeldet');
    try {
        return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
    } catch (e) {
        if (e instanceof InteractionRequiredAuthError) await msal.acquireTokenRedirect({ scopes: SCOPES, account });
        throw e;
    }
}
