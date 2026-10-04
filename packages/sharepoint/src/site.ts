// Generic access to the lists and the asset library of one SharePoint site.
import { GraphClient, GraphError } from './graph.ts';
import { LISTS, type ListKey } from './schema.ts';

export type Fields = Record<string, unknown>;

export interface AssetInfo {
    key: string;
    size: number;
    contentType: string;
    lastModified: string;
}

export interface ListItem {
    id: string;
    eTag: string;
    fields: Fields;
}

interface GraphListItem {
    id: string;
    eTag: string;
    fields: Fields;
}

export class SharePointSite {
    readonly graph: GraphClient;
    readonly siteId: string;
    private readonly listIds = new Map<string, string>();

    constructor(graph: GraphClient, siteId: string) {
        this.graph = graph;
        this.siteId = siteId;
    }

    private get base(): string {
        return `/sites/${this.siteId}`;
    }

    /** Resolves a list id by display name; returns undefined if the list does not exist. */
    async findListId(name: string): Promise<string | undefined> {
        const cached = this.listIds.get(name);
        if (cached) return cached;
        const lists = await this.graph.collect<{ id: string; displayName: string }>(
            `${this.base}/lists?$select=id,displayName`,
        );
        for (const l of lists) this.listIds.set(l.displayName, l.id);
        return this.listIds.get(name);
    }

    async listId(key: ListKey): Promise<string> {
        const name = LISTS[key].name;
        const id = await this.findListId(name);
        if (!id) throw new Error(`SharePoint list "${name}" missing; run provisioning first`);
        return id;
    }

    rememberListId(name: string, id: string): void {
        this.listIds.set(name, id);
    }

    /**
     * Lists items. `filter` is an OData filter on fields, e.g. `fields/State eq 'available'`;
     * only indexed columns may be filtered reliably.
     */
    async listItems(key: ListKey, filter?: string, select?: string[]): Promise<ListItem[]> {
        const id = await this.listId(key);
        const expand = select ? `fields($select=${select.join(',')})` : 'fields';
        let path = `${this.base}/lists/${id}/items?$expand=${expand}&$top=500`;
        if (filter) path += `&$filter=${encodeURIComponent(filter)}`;
        const items = await this.graph.collect<GraphListItem>(path);
        return items.map(toListItem);
    }

    async getItem(key: ListKey, itemId: string): Promise<ListItem | undefined> {
        const id = await this.listId(key);
        try {
            return toListItem(
                await this.graph.json<GraphListItem>('GET', `${this.base}/lists/${id}/items/${itemId}?$expand=fields`),
            );
        } catch (e) {
            if (e instanceof GraphError && e.status === 404) return undefined;
            throw e;
        }
    }

    async createItem(key: ListKey, fields: Fields): Promise<ListItem> {
        const id = await this.listId(key);
        return toListItem(
            await this.graph.json<GraphListItem>('POST', `${this.base}/lists/${id}/items`, { body: { fields } }),
        );
    }

    /**
     * Updates fields. With `ifMatch` (an item eTag) the update fails with
     * status 412 if the item was changed in the meantime. Returns the new eTag.
     */
    async updateItem(key: ListKey, itemId: string, fields: Fields, ifMatch?: string): Promise<string> {
        const id = await this.listId(key);
        const res = await this.graph.request('PATCH', `${this.base}/lists/${id}/items/${itemId}/fields`, {
            body: fields,
            headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
        });
        return res.headers.get('ETag') ?? ((await res.json().catch(() => ({}))) as Record<string, string>)['@odata.etag'] ?? '';
    }

    /** Creates many items using batching; returns them in input order. */
    async createItems(key: ListKey, fieldsList: Fields[]): Promise<ListItem[]> {
        const id = await this.listId(key);
        const bodies = await this.graph.batch(
            fieldsList.map((fields) => ({ method: 'POST', path: `${this.base}/lists/${id}/items`, body: { fields } })),
        );
        return bodies.map((b) => toListItem(b as GraphListItem));
    }

    /** Updates fields of many items using batching. */
    async updateItems(key: ListKey, updates: { id: string; fields: Fields; ifMatch?: string }[]): Promise<void> {
        const id = await this.listId(key);
        await this.graph.batch(
            updates.map((u) => ({
                method: 'PATCH',
                path: `${this.base}/lists/${id}/items/${u.id}/fields`,
                body: u.fields,
                headers: u.ifMatch ? { 'If-Match': u.ifMatch } : undefined,
            })),
        );
    }

    /** Deletes many items using batching. */
    async deleteItems(key: ListKey, itemIds: string[]): Promise<void> {
        const id = await this.listId(key);
        await this.graph.batch(itemIds.map((itemId) => ({ method: 'DELETE', path: `${this.base}/lists/${id}/items/${itemId}` })));
    }

    async deleteItem(key: ListKey, itemId: string): Promise<void> {
        const id = await this.listId(key);
        await this.graph.request('DELETE', `${this.base}/lists/${id}/items/${itemId}`);
    }

    // --- document libraries: Assets (key -> blob) and Uploads (per application) ---

    private async libraryPath(key: 'assets' | 'uploads', path: string): Promise<string> {
        const segments = path.split('/');
        const valid = key === 'assets' ? segments.length === 1 : segments.length === 2;
        if (!valid || !segments.every(isAssetKey)) throw new Error(`Invalid ${key} path "${path}"`);
        const listId = await this.listId(key);
        return `${this.base}/lists/${listId}/drive/root:/${path}:`;
    }

    private async putFile(key: 'assets' | 'uploads', path: string, data: Blob): Promise<void> {
        await this.graph.request('PUT', `${await this.libraryPath(key, path)}/content`, {
            raw: data,
            headers: { 'Content-Type': data.type || 'application/octet-stream' },
        });
    }

    private async getFile(key: 'assets' | 'uploads', path: string): Promise<Blob | undefined> {
        try {
            const res = await this.graph.request('GET', `${await this.libraryPath(key, path)}/content`);
            return await res.blob();
        } catch (e) {
            if (e instanceof GraphError && e.status === 404) return undefined;
            throw e;
        }
    }

    private async deleteFile(key: 'assets' | 'uploads', path: string): Promise<void> {
        try {
            await this.graph.request('DELETE', await this.libraryPath(key, path));
        } catch (e) {
            if (!(e instanceof GraphError && e.status === 404)) throw e;
        }
    }

    async listAssets(): Promise<AssetInfo[]> {
        const listId = await this.listId('assets');
        return this.listFolder(`${this.base}/lists/${listId}/drive/root/children`);
    }

    putAsset(key: string, data: Blob): Promise<void> {
        return this.putFile('assets', key, data);
    }

    getAsset(key: string): Promise<Blob | undefined> {
        return this.getFile('assets', key);
    }

    deleteAsset(key: string): Promise<void> {
        return this.deleteFile('assets', key);
    }

    /** Files of one application; keys are `<applicationId>/<file>` (upload ids). */
    async listUploads(applicationId: string): Promise<AssetInfo[]> {
        if (!isAssetKey(applicationId)) throw new Error(`Invalid application id "${applicationId}"`);
        const listId = await this.listId('uploads');
        try {
            const files = await this.listFolder(`${this.base}/lists/${listId}/drive/root:/${applicationId}:/children`);
            return files.map((f) => ({ ...f, key: `${applicationId}/${f.key}` }));
        } catch (e) {
            if (e instanceof GraphError && e.status === 404) return [];
            throw e;
        }
    }

    putUpload(id: string, data: Blob): Promise<void> {
        return this.putFile('uploads', id, data);
    }

    getUpload(id: string): Promise<Blob | undefined> {
        return this.getFile('uploads', id);
    }

    deleteUpload(id: string): Promise<void> {
        return this.deleteFile('uploads', id);
    }

    /** Removes all files of an application (its folder in the Uploads library). */
    async deleteUploads(applicationId: string): Promise<void> {
        if (!isAssetKey(applicationId)) throw new Error(`Invalid application id "${applicationId}"`);
        const listId = await this.listId('uploads');
        try {
            await this.graph.request('DELETE', `${this.base}/lists/${listId}/drive/root:/${applicationId}:`);
        } catch (e) {
            if (!(e instanceof GraphError && e.status === 404)) throw e;
        }
    }

    private async listFolder(path: string): Promise<AssetInfo[]> {
        const items = await this.graph.collect<{ name: string; size: number; lastModifiedDateTime: string; file?: { mimeType: string } }>(
            `${path}?$select=name,size,lastModifiedDateTime,file`,
        );
        return items
            .filter((i) => i.file)
            .map((i) => ({ key: i.name, size: i.size, contentType: i.file!.mimeType, lastModified: i.lastModifiedDateTime }));
    }
}

/** Asset keys are file names: letters, digits, dot, dash, underscore. */
export function isAssetKey(key: string): boolean {
    return /^[A-Za-z0-9._-]+$/.test(key) && !key.startsWith('.');
}

function toListItem(item: GraphListItem): ListItem {
    return { id: item.id, eTag: item.eTag, fields: item.fields };
}
