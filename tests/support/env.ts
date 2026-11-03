// Reads the repository .env for the tests and tools. Never log values.
import fs from 'node:fs';
import { GraphClient, SharePointSite } from '../../packages/sharepoint/src/index.ts';

export function readEnv(): Record<string, string> {
    const file = new URL('../../.env', import.meta.url);
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0 && !line.trimStart().startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
}

export const env = readEnv();

/**
 * App-only Graph token for the SPA's app registration (client credentials).
 * Development/test bypass of the interactive login; the secret is removed
 * after development and must never reach browser code.
 */
export function appTokenProvider(): () => Promise<string> {
    let cached: { token: string; expires: number } | undefined;
    return async () => {
        if (cached && cached.expires > Date.now() + 60_000) return cached.token;
        const token = await requestToken(env.APP_CLIENT_ID, env.APP_CLIENT_SECRET, env.SCOPE);
        cached = { token: token.access_token, expires: Date.now() + token.expires_in * 1000 };
        return cached.token;
    };
}

/** One-off client-credentials token for any app registration in the tenant. */
export async function clientCredentialsToken(clientId: string, clientSecret: string): Promise<string> {
    return (await requestToken(clientId, clientSecret)).access_token;
}

async function requestToken(clientId: string, clientSecret: string, scope?: string): Promise<{ access_token: string; expires_in: number }> {
    const res = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope: scope || 'https://graph.microsoft.com/.default',
        }),
    });
    const body = await res.json();
    if (!body.access_token) throw new Error(`token request failed: ${body.error ?? res.status}`);
    return body;
}

/** The SharePoint test site, accessed with the app identity. */
export function testSite(): SharePointSite {
    return new SharePointSite(new GraphClient(appTokenProvider()), env.SHAREPOINT_ID);
}

/** Local date (YYYY-MM-DD) `offset` days from today. */
export function day(offset: number): string {
    return new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');
}

/** SVWS server for the SVWS tests (.env, default: local server with the test school). */
export const svws = {
    url: env.SVWS_URL || 'https://localhost:8443',
    schema: env.SVWS_SCHEMA || 'gymabi',
    user: env.SVWS_USER || 'Admin',
    password: env.SVWS_PASSWORD ?? '',
};
