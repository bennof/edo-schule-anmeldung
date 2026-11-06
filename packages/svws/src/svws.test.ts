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

});

describe('svws adapter boundary (M1)', () => {
    const items = [{ applicationId: '7', formId: 'f', data: {} }];
    const creds = { user: 'Admin', password: '' };

    it('without endpoint or schema: not configured, nothing transferred', async () => {
        for (const endpoint of [undefined, { url: 'https://svws.local', transport: 'direct' as const }]) {
            const adapter = createSvwsAdapter(endpoint);
            expect(adapter.ready).toBe(false);
            expect(await adapter.transfer(items, creds)).toEqual([{ applicationId: '7', ok: false, message: adapter.status() }]);
        }
    });

    it('with endpoint and schema: ready, sends Basic auth to /db/{schema}', async () => {
        const { calls, fetchFn } = recordingFetch();
        const adapter = createSvwsAdapter({ url: 'https://svws.local', transport: 'direct', schema: 'gymabi' }, { fetch: fetchFn });
        expect(adapter.ready).toBe(true);
        await adapter.check(creds).catch(() => {});
        expect(calls.map((c) => c.url)).toEqual(['https://svws.local/status/version', 'https://svws.local/db/gymabi/schule/stammdaten']);
        expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('Admin:')}`);
    });

    it('skips applications that were already transferred', async () => {
        const fetchFn = (async (input: RequestInfo | URL) => {
            const url = String(input);
            const body = url.endsWith('/schule/stammdaten') ? { idSchuljahresabschnitt: 1, abschnitte: [] } : [];
            return new Response(JSON.stringify(body), { status: 200 });
        }) as typeof fetch;
        const adapter = createSvwsAdapter({ url: 'https://svws.local', transport: 'direct', schema: 's' }, { fetch: fetchFn });
        const [r] = await adapter.transfer([{ ...items[0], svwsId: '99' }], creds);
        expect(r).toMatchObject({ ok: false, svwsId: '99' });
        expect(r.message).toMatch(/Bereits an SVWS übertragen/);
    });
});
