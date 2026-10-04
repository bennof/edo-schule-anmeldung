// SVWS adapter (backlog M1 port, Future: SVWS adapter): the secretariat hands
// over applications released for SVWS; the adapter maps them with the live
// SVWS catalogs and creates student, master data incl. photo and guardians.
import { loadCatalogs, type SvwsCatalogs } from './catalogs.ts';
import { SvwsClient, type SvwsCredentials } from './client.ts';
import { mapApplication } from './mapping.ts';
import { checkEndpoint, createTransport, type SvwsEndpoint, type SvwsTransport, type TransportDeps } from './transport.ts';

export interface TransferItem {
    applicationId: string;
    formId: string;
    /** canonical application data (form data); mapping happens in the adapter */
    data: unknown;
    /** ISO date of the online submission (becomes the Anmeldedatum) */
    submittedAt?: string;
    /** JPEG bytes of the student photo, if any */
    photo?: Uint8Array;
    /** set when the application was already (partly) transferred */
    svwsId?: string;
}

export interface TransferResult {
    applicationId: string;
    ok: boolean;
    message: string;
    /** id of the created SVWS student; also set when a later step failed */
    svwsId?: string;
    /** values that could not be assigned and need manual completion */
    warnings?: string[];
}

export interface SvwsAdapter {
    readonly name: string;
    /** whether transfer() can actually transfer */
    readonly ready: boolean;
    /** human readable status for the UI */
    status(): string;
    /** connection test: returns e.g. "SVWS 1.4.1 · Albert Zweistein Gymnasium" */
    check(credentials: SvwsCredentials): Promise<string>;
    transfer(items: TransferItem[], credentials: SvwsCredentials): Promise<TransferResult[]>;
}

const failAll = (items: TransferItem[], message: string): TransferResult[] =>
    items.map((i) => ({ applicationId: i.applicationId, ok: false, message }));

/** No (valid) endpoint configured. */
export class NotConfiguredAdapter implements SvwsAdapter {
    readonly name = 'nicht konfiguriert';
    readonly ready = false;
    status(): string {
        return 'Kein SVWS-Endpunkt konfiguriert (Einstellungen: Adresse und Schema).';
    }
    async check(): Promise<string> {
        throw new Error(this.status());
    }
    async transfer(items: TransferItem[]): Promise<TransferResult[]> {
        return failAll(items, this.status());
    }
}

export class SvwsTransferAdapter implements SvwsAdapter {
    readonly name = 'SVWS';
    readonly ready = true;
    readonly transport: SvwsTransport;
    readonly endpoint: SvwsEndpoint & { schema: string };
    private readonly schuljahr?: number;

    constructor(endpoint: SvwsEndpoint & { schema: string }, transport: SvwsTransport, schuljahr?: number) {
        this.endpoint = endpoint;
        this.transport = transport;
        this.schuljahr = schuljahr;
    }

    status(): string {
        return `SVWS ${this.endpoint.url} · Schema ${this.endpoint.schema} (${this.transport.kind})`;
    }

    async check(credentials: SvwsCredentials): Promise<string> {
        const version = await this.transport.request('GET', '/status/version');
        const client = new SvwsClient(this.transport, this.endpoint.schema, credentials);
        const schule = await client.get<{ bezeichnung1?: string; schulNr?: number }>('/schule/stammdaten');
        return `SVWS ${String(version.body ?? '').replaceAll('"', '')} · ${schule.bezeichnung1 ?? ''} (${schule.schulNr ?? ''})`;
    }

    async transfer(items: TransferItem[], credentials: SvwsCredentials): Promise<TransferResult[]> {
        const client = new SvwsClient(this.transport, this.endpoint.schema, credentials);
        let catalogs: SvwsCatalogs;
        try {
            catalogs = await loadCatalogs(client, this.schuljahr);
        } catch (e) {
            return failAll(items, `SVWS nicht erreichbar oder Anmeldung fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
        }
        const results: TransferResult[] = [];
        for (const item of items) results.push(await this.transferOne(client, catalogs, item));
        return results;
    }

    private async transferOne(client: SvwsClient, catalogs: SvwsCatalogs, item: TransferItem): Promise<TransferResult> {
        const base = { applicationId: item.applicationId };
        if (item.svwsId) {
            return { ...base, ok: false, svwsId: item.svwsId, message: `Bereits an SVWS übertragen (Schüler-ID ${item.svwsId}) – nicht erneut angelegt.` };
        }
        const records = mapApplication((item.data ?? {}) as Record<string, unknown>, catalogs, { anmeldedatum: item.submittedAt?.slice(0, 10) });
        if (!records.neu.nachname || !records.neu.vorname) return { ...base, ok: false, message: 'Name des Kindes fehlt.', warnings: records.warnings };

        let created: { id: number };
        try {
            created = await client.call<{ id: number }>('POST', '/schueler/create', records.neu);
        } catch (e) {
            return { ...base, ok: false, message: `Schüler konnte nicht angelegt werden: ${e instanceof Error ? e.message : e}`, warnings: records.warnings };
        }
        const svwsId = String(created.id);
        const warnings = [...records.warnings];
        try {
            const patch: Record<string, unknown> = { ...records.stammdaten };
            if (item.photo) {
                if (item.photo[0] === 0xff && item.photo[1] === 0xd8) patch.foto = base64(item.photo);
                else warnings.push('Passfoto ist kein JPEG und wurde nicht übertragen');
            }
            if (Object.keys(patch).length) await client.call('PATCH', `/schueler/${svwsId}/stammdaten`, patch);
            for (const [i, erzieher] of records.erzieher.entries()) {
                await client.call('POST', `/schueler/erzieher/new/${svwsId}/${i + 1}`, erzieher);
            }
        } catch (e) {
            return {
                ...base,
                ok: false,
                svwsId,
                warnings,
                message: `Schüler in SVWS angelegt (ID ${svwsId}), aber nicht vollständig: ${e instanceof Error ? e.message : e}. Bitte in SVWS prüfen.`,
            };
        }
        return { ...base, ok: true, svwsId, warnings, message: `Übertragen als Schüler-ID ${svwsId}` };
    }
}

function base64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/**
 * Adapter for an endpoint; `endpoint.schuljahr` (e.g. 2026) selects the school
 * year section for new students, otherwise the current one of the school.
 */
export function createSvwsAdapter(endpoint: SvwsEndpoint | undefined, deps?: TransportDeps): SvwsAdapter {
    if (!endpoint?.url || !endpoint.schema || checkEndpoint(endpoint).length) return new NotConfiguredAdapter();
    return new SvwsTransferAdapter({ ...endpoint, schema: endpoint.schema }, createTransport(endpoint, deps), endpoint.schuljahr);
}
