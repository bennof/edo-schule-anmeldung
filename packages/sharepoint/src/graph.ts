// Minimal Microsoft Graph client. Token acquisition is injected, so the same
// code runs in the browser (MSAL, delegated) and in Node tests (client credentials).

export type TokenProvider = () => Promise<string>;

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_RETRIES = 3;

export class GraphError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(`Graph ${status} ${code}: ${message}`);
        this.status = status;
        this.code = code;
    }
}

export interface RequestOptions {
    body?: unknown;
    headers?: Record<string, string>;
    /** Raw body (e.g. a Blob for file uploads); sent without JSON encoding. */
    raw?: BodyInit;
}

export class GraphClient {
    private readonly getToken: TokenProvider;
    private readonly fetchFn: typeof fetch;

    // wrapped: browsers reject fetch called with a `this` other than window
    constructor(getToken: TokenProvider, fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
        this.getToken = getToken;
        this.fetchFn = fetchFn;
    }

    /** Performs a request; `path` is relative to the Graph v1.0 root or an absolute nextLink. */
    async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
        const url = path.startsWith('https://') ? path : GRAPH + path;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${await this.getToken()}`,
            ...options.headers,
        };
        let body: BodyInit | undefined = options.raw;
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.body);
        }

        for (let attempt = 0; ; attempt++) {
            const res = await this.fetchFn(url, { method, headers, body });
            if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
                const retryAfter = res.headers.get('Retry-After');
                const seconds = retryAfter !== null ? Number(retryAfter) : 2 ** attempt;
                await new Promise((r) => setTimeout(r, seconds * 1000));
                continue;
            }
            if (!res.ok) {
                let code = 'unknown';
                let message = res.statusText;
                try {
                    const err = (await res.json()).error;
                    code = err?.code ?? code;
                    message = err?.message ?? message;
                } catch {
                    // non-JSON error body
                }
                throw new GraphError(res.status, code, message);
            }
            return res;
        }
    }

    async json<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
        const res = await this.request(method, path, options);
        return (res.status === 204 ? undefined : await res.json()) as T;
    }

    /** Follows @odata.nextLink and returns all `value` entries. */
    async collect<T>(path: string, headers?: Record<string, string>): Promise<T[]> {
        const all: T[] = [];
        let next: string | undefined = path;
        while (next) {
            const page: { value: T[]; '@odata.nextLink'?: string } = await this.json('GET', next, { headers });
            all.push(...page.value);
            next = page['@odata.nextLink'];
        }
        return all;
    }
}
