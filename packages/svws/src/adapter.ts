// Boundary for the later SVWS integration (backlog M1). The secretariat
// hands over applications released for SVWS; the adapter maps, validates and
// transfers them. Only the port and placeholder adapters exist so far.
import { checkEndpoint, createTransport, type SvwsEndpoint, type SvwsTransport, type TransportDeps } from './transport.ts';

export interface TransferItem {
    applicationId: string;
    formId: string;
    /** canonical application data (form data); mapping to SVWS happens in the adapter */
    data: unknown;
}

export interface TransferResult {
    applicationId: string;
    ok: boolean;
    message: string;
    /** id of the created SVWS record, when ok */
    svwsId?: string;
}

export interface SvwsAdapter {
    readonly name: string;
    /** whether transfer() can actually transfer */
    readonly ready: boolean;
    /** human readable status for the UI */
    status(): string;
    transfer(items: TransferItem[]): Promise<TransferResult[]>;
}

const failAll = (items: TransferItem[], message: string): TransferResult[] =>
    items.map((i) => ({ applicationId: i.applicationId, ok: false, message }));

/** No endpoint configured. */
export class NotConfiguredAdapter implements SvwsAdapter {
    readonly name = 'nicht konfiguriert';
    readonly ready = false;
    status(): string {
        return 'Kein SVWS-Endpunkt konfiguriert (Einstellungen).';
    }
    async transfer(items: TransferItem[]): Promise<TransferResult[]> {
        return failAll(items, this.status());
    }
}

/** Endpoint configured, concrete SVWS mapping/transfer not implemented yet (Future Release). */
export class PendingAdapter implements SvwsAdapter {
    readonly name = 'in Vorbereitung';
    readonly ready = false;
    readonly transport: SvwsTransport;
    constructor(transport: SvwsTransport) {
        this.transport = transport;
    }
    status(): string {
        return `SVWS-Endpunkt konfiguriert (${this.transport.kind}); die Übertragung ist noch nicht umgesetzt.`;
    }
    async transfer(items: TransferItem[]): Promise<TransferResult[]> {
        return failAll(items, 'Die SVWS-Übertragung ist noch nicht umgesetzt.');
    }
}

export function createSvwsAdapter(endpoint: SvwsEndpoint | undefined, deps?: TransportDeps): SvwsAdapter {
    if (!endpoint?.url || checkEndpoint(endpoint).length) return new NotConfiguredAdapter();
    return new PendingAdapter(createTransport(endpoint, deps));
}
