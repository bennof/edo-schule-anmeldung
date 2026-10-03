// In-memory stand-in for the Graph endpoints used by this package (tests only).

interface FakeList {
    id: string;
    displayName: string;
    columns: { id: string; name: string; indexed: boolean }[];
    items: { id: string; eTag: string; fields: Record<string, unknown> }[];
}

export class FakeGraph {
    lists: FakeList[] = [];
    requests: string[] = [];
    private nextId = 1;

    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        if (url.pathname === '/v1.0/$batch') return this.batch(JSON.parse(String(init!.body)));
        const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0\/sites\/[^/]+/, ''));
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        this.requests.push(`${method} ${path}`);
        const parts = path.split('/').filter(Boolean);

        if (parts[0] !== 'lists') return reply(404, { error: { code: 'notFound', message: path } });
        if (parts.length === 1) {
            if (method === 'GET') return reply(200, { value: this.lists.map((l) => ({ id: l.id, displayName: l.displayName })) });
            const list: FakeList = {
                id: this.id(),
                displayName: body.displayName,
                columns: [{ id: this.id(), name: 'Title', indexed: false }],
                items: [],
            };
            for (const c of body.columns ?? []) list.columns.push({ id: this.id(), name: c.name, indexed: !!c.indexed });
            this.lists.push(list);
            return reply(201, { id: list.id });
        }

        const list = this.lists.find((l) => l.id === parts[1]);
        if (!list) return reply(404, { error: { code: 'itemNotFound', message: 'list' } });

        if (parts[2] === 'columns') {
            if (parts.length === 3 && method === 'GET') return reply(200, { value: list.columns });
            if (parts.length === 3 && method === 'POST') {
                list.columns.push({ id: this.id(), name: body.name, indexed: !!body.indexed });
                return reply(201, {});
            }
            const col = list.columns.find((c) => c.id === parts[3])!;
            Object.assign(col, body);
            return reply(200, col);
        }

        if (parts[2] === 'items') {
            if (parts.length === 3 && method === 'GET') {
                let items = list.items;
                const filter = url.searchParams.get('$filter');
                for (const term of filter ? filter.split(' and ') : []) {
                    const eq = /^fields\/(\w+) eq '(.*)'$/.exec(term);
                    const sw = /^startswith\(fields\/(\w+),'(.*)'\)$/.exec(term);
                    if (eq) items = items.filter((i) => String(i.fields[eq[1]]) === eq[2].replaceAll("''", "'"));
                    else if (sw) items = items.filter((i) => String(i.fields[sw[1]] ?? '').startsWith(sw[2].replaceAll("''", "'")));
                    else throw new Error(`fake graph: unsupported filter ${term}`);
                }
                const select = /fields\(\$select=([^)]*)\)/.exec(url.searchParams.get('$expand') ?? '')?.[1]?.split(',');
                const shaped = select
                    ? items.map((i) => ({ ...i, fields: Object.fromEntries(Object.entries(i.fields).filter(([k]) => select.includes(k))) }))
                    : items;
                return reply(200, { value: shaped });
            }
            if (parts.length === 3 && method === 'POST') {
                const item = { id: this.id(), eTag: `"${this.id()}"`, fields: { ...body.fields } };
                list.items.push(item);
                return reply(201, item);
            }
            const item = list.items.find((i) => i.id === parts[3]);
            if (!item) return reply(404, { error: { code: 'itemNotFound', message: 'item' } });
            if (method === 'GET') return reply(200, item);
            if (method === 'DELETE') {
                list.items = list.items.filter((i) => i !== item);
                return new Response(null, { status: 204 });
            }
            const ifMatch = (init?.headers as Record<string, string>)?.['If-Match'];
            if (ifMatch && ifMatch !== item.eTag) return reply(412, { error: { code: 'preconditionFailed', message: 'etag' } });
            for (const [k, v] of Object.entries(body)) {
                if (v === null) delete item.fields[k];
                else item.fields[k] = v;
            }
            item.eTag = `"${this.id()}"`;
            return new Response(JSON.stringify(item.fields), { status: 200, headers: { 'Content-Type': 'application/json', ETag: item.eTag } });
        }
        return reply(400, { error: { code: 'badRequest', message: path } });
    };

    private async batch(body: { requests: { id: string; method: string; url: string; body?: unknown; headers?: Record<string, string> }[] }): Promise<Response> {
        const responses = [];
        for (const r of body.requests) {
            const res = await this.fetch(`https://graph.microsoft.com/v1.0${r.url}`, {
                method: r.method,
                headers: r.headers,
                body: r.body === undefined ? undefined : JSON.stringify(r.body),
            });
            const text = await res.text();
            responses.push({ id: r.id, status: res.status, body: text ? JSON.parse(text) : undefined });
        }
        return reply(200, { responses });
    }

    private id(): string {
        return String(this.nextId++);
    }
}

function reply(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
