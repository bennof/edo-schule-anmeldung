import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';
import { defineConfig } from 'vite';

// Only these non-secret keys from the repository .env reach browser code.
// Secrets (APP_CLIENT_SECRET, DAEMON_CLIENT_SECRET) must never be added here.
const PUBLIC_KEYS = ['TENANT_ID', 'APP_CLIENT_ID', 'APP_REDIRECT_URI', 'SHAREPOINT_ID', 'SHAREPOINT_URL'];

function readEnv(file: string): Record<string, string> {
    if (!fs.existsSync(file)) return {};
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0 && !line.trimStart().startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
}

const env = readEnv(new URL('../../.env', import.meta.url).pathname);
const clientConfig = Object.fromEntries(PUBLIC_KEYS.map((k) => [k, env[k] ?? '']));

export default defineConfig({
    plugins: [svelte()],
    define: { __CLIENT_CONFIG__: JSON.stringify(clientConfig) },
    server: {
        port: 5173,
        strictPort: true,
        // development stand-in for a CORS proxy in front of the local SVWS test
        // server (make svws-up, self-signed certificate): transport "proxy",
        // proxy address http://localhost:5173/svws-proxy
        proxy: {
            '/svws-proxy': {
                target: env.SVWS_PROXY_TARGET || 'https://localhost:8443',
                secure: false,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/svws-proxy/, ''),
            },
        },
    },
});
