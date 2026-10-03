// Reads the repository .env for Node-side test tooling. Never log values.
import fs from 'node:fs';

export function readEnv(): Record<string, string> {
    const file = new URL('../.env', import.meta.url);
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0 && !line.trimStart().startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
}

/**
 * App-only Graph token for the SPA's app registration (client credentials).
 * Development/test bypass of the interactive login; the secret is removed
 * after development and must never reach browser code.
 */
export function appTokenProvider(env: Record<string, string>): () => Promise<string> {
    let cached: { token: string; expires: number } | undefined;
    return async () => {
        if (cached && cached.expires > Date.now() + 60_000) return cached.token;
        const res = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
            method: 'POST',
            body: new URLSearchParams({
                client_id: env.APP_CLIENT_ID,
                client_secret: env.APP_CLIENT_SECRET,
                grant_type: 'client_credentials',
                scope: env.SCOPE || 'https://graph.microsoft.com/.default',
            }),
        });
        const body = await res.json();
        if (!body.access_token) throw new Error(`token request failed: ${body.error ?? res.status}`);
        cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
        return cached.token;
    };
}

/** One-off client-credentials token for any app registration in the tenant (tests only). */
export async function clientCredentialsToken(clientId: string, clientSecret: string): Promise<string> {
    const env = readEnv();
    const res = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope: 'https://graph.microsoft.com/.default',
        }),
    });
    const body = await res.json();
    if (!body.access_token) throw new Error(`token request failed: ${body.error ?? res.status}`);
    return body.access_token;
}
