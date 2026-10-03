// Typed CRUD on top of SharePointSite: maps list items to domain objects
// using the column specs from schema.ts. The SharePoint item id is the domain id.
import { LISTS, type ColumnSpec, type ListKey } from './schema.ts';
import type { Fields, SharePointSite } from './site.ts';

export interface Entity {
    id: string;
}

export class Repository<T extends Entity> {
    private readonly site: SharePointSite;
    private readonly key: ListKey;
    private readonly columns: readonly ColumnSpec[];

    constructor(site: SharePointSite, key: ListKey) {
        this.site = site;
        this.key = key;
        this.columns = LISTS[key].columns;
    }

    async list(filter?: string): Promise<T[]> {
        return (await this.site.listItems(this.key, filter)).map((i) => this.toEntity(i.id, i.fields));
    }

    async get(id: string): Promise<T | undefined> {
        const item = await this.site.getItem(this.key, id);
        return item && this.toEntity(item.id, item.fields);
    }

    async create(entity: Omit<T, 'id'>): Promise<T> {
        const item = await this.site.createItem(this.key, this.toFields(entity as Partial<T>));
        return this.toEntity(item.id, item.fields);
    }

    /** Updates the given properties; `undefined` clears a column. */
    async update(id: string, changes: Partial<Omit<T, 'id'>>, ifMatch?: string): Promise<void> {
        await this.site.updateItem(this.key, id, this.toFields(changes as Partial<T>, true), ifMatch);
    }

    async delete(id: string): Promise<void> {
        await this.site.deleteItem(this.key, id);
    }

    /** Builds an OData filter term for a domain property. */
    filter(prop: keyof T & string, value: string): string {
        const col = this.columns.find((c) => c.prop === prop);
        if (!col) throw new Error(`Unknown property ${prop}`);
        return `fields/${col.name} eq '${value.replaceAll("'", "''")}'`;
    }

    toEntity(id: string, fields: Fields): T {
        const entity: Record<string, unknown> = { id };
        for (const col of this.columns) {
            const raw = fields[col.name];
            if (raw === undefined || raw === null || raw === '') continue;
            entity[col.prop] = col.type === 'json' ? JSON.parse(String(raw)) : raw;
        }
        return entity as T;
    }

    /** With `onlyGiven`, only properties present on `entity` are written (partial update). */
    toFields(entity: Partial<T>, onlyGiven = false): Fields {
        const fields: Fields = {};
        const source = entity as Record<string, unknown>;
        for (const col of this.columns) {
            if (onlyGiven && !(col.prop in source)) continue;
            const value = source[col.prop];
            if (value === undefined) {
                if (onlyGiven) fields[col.name] = null;
                continue;
            }
            fields[col.name] = col.type === 'json' ? JSON.stringify(value) : value;
        }
        return fields;
    }
}
