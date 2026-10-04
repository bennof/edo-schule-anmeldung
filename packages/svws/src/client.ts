// Authenticated access to one school schema of a SVWS server (HTTP Basic,
// SVWS user of the school). Credentials are given per transfer and never stored.
import type { SvwsTransport } from './transport.ts';

export class SvwsError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export interface SvwsCredentials {
    user: string;
    password: string;
}

function basic({ user, password }: SvwsCredentials): string {
    const bytes = new TextEncoder().encode(`${user}:${password}`);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `Basic ${btoa(binary)}`;
}

export class SvwsClient {
    readonly transport: SvwsTransport;
    readonly schema: string;
    private readonly auth: string;

    constructor(transport: SvwsTransport, schema: string, credentials: SvwsCredentials) {
        this.transport = transport;
        this.schema = schema;
        this.auth = basic(credentials);
    }

    /** Request against /db/{schema}{path}; throws SvwsError on HTTP errors. */
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await this.transport.request(method, `/db/${this.schema}${path}`, body, { Authorization: this.auth });
        if (res.status === 401 || res.status === 403) throw new SvwsError(res.status, 'SVWS-Anmeldung abgelehnt oder keine Berechtigung');
        if (res.status >= 400) {
            const detail = typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body ?? '').slice(0, 200);
            throw new SvwsError(res.status, `SVWS ${method} ${path}: ${res.status} ${detail}`);
        }
        return res.body as T;
    }

    get<T>(path: string): Promise<T> {
        return this.call<T>('GET', path);
    }
}
