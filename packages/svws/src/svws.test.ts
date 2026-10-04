import { describe, expect, it } from 'vitest';
import { createSvwsAdapter } from './adapter.ts';
import { checkEndpoint, createTransport } from './transport.ts';

function recordingFetch() {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    return { calls, fetchFn };
}

describe('svws transport (N2)', () => {
    it('validates endpoints', () => {
        expect(checkEndpoint({ url: 'https://svws.local:8443', transport: 'direct' })).toEqual([]);
        expect(checkEndpoint({ url: 'svws.local', transport: 'direct' })).toHaveLength(1);
        expect(checkEndpoint({ url: 'https://svws.local', transport: 'proxy' })).toHaveLength(1);
    });

    it('direct: browser calls SVWS', async () => {
        const { calls, fetchFn } = recordingFetch();
        const t = createTransport({ url: 'https://svws.local:8443/', transport: 'direct' }, { fetch: fetchFn });
        const res = await t.request('GET', '/status');
        expect(calls[0].url).toBe('https://svws.local:8443/status');
        expect(res).toEqual({ status: 200, body: { ok: true } });
    });

    it('proxy: browser calls the CORS proxy with the target header', async () => {
        const { calls, fetchFn } = recordingFetch();
        const t = createTransport({ url: 'https://svws.local:8443', transport: 'proxy', proxyUrl: 'https://proxy.schule.de/' }, { fetch: fetchFn });
        await t.request('POST', '/x', { a: 1 });
        expect(calls[0].url).toBe('https://proxy.schule.de/x');
        expect((calls[0].init?.headers as Record<string, string>)['X-SVWS-Target']).toBe('https://svws.local:8443');
        expect(calls[0].init?.body).toBe('{"a":1}');
    });

    it('tauri: delegates to the desktop shell', async () => {
        const seen: unknown[] = [];
        const t = createTransport(
            { url: 'https://svws.local', transport: 'tauri' },
            { tauriInvoke: async (cmd, args) => (seen.push([cmd, args]), { status: 204, body: undefined }) },
        );
        expect((await t.request('GET', '/a')).status).toBe(204);
        expect(seen).toEqual([['svws_request', { method: 'GET', url: 'https://svws.local/a', body: undefined }]]);
        await expect(createTransport({ url: 'https://svws.local', transport: 'tauri' }).request('GET', '/a')).rejects.toThrow(/Tauri/);
    });
});

describe('svws adapter boundary (M1)', () => {
    const items = [{ applicationId: '7', formId: 'f', data: {} }];

    it('without endpoint: not configured, nothing transferred', async () => {
        const adapter = createSvwsAdapter(undefined);
        expect(adapter.ready).toBe(false);
        expect(await adapter.transfer(items)).toEqual([{ applicationId: '7', ok: false, message: adapter.status() }]);
    });

    it('with endpoint: pending adapter, no SVWS call is made', async () => {
        const { calls, fetchFn } = recordingFetch();
        const adapter = createSvwsAdapter({ url: 'https://svws.local', transport: 'direct' }, { fetch: fetchFn });
        expect(adapter.status()).toMatch(/noch nicht umgesetzt/);
        const [result] = await adapter.transfer(items);
        expect(result.ok).toBe(false);
        expect(calls).toHaveLength(0);
    });
});
