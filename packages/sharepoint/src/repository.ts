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

    /** With `props`, only these properties are loaded (e.g. to skip large JSON columns). */
    async list(filter?: string, props?: (keyof T & string)[]): Promise<T[]> {
        const select = props?.map((p) => this.column(p).name);
        return (await this.site.listItems(this.key, filter, select)).map((i) => this.toEntity(i.id, i.fields));
    }

    async get(id: string): Promise<T | undefined> {
        return (await this.getTracked(id))?.entity;
    }

    /** Entity with its eTag, for updates that must not overwrite concurrent changes. */
    async getTracked(id: string): Promise<{ entity: T; eTag: string } | undefined> {
        const item = await this.site.getItem(this.key, id);
        return item && { entity: this.toEntity(item.id, item.fields), eTag: item.eTag };
    }

    async create(entity: Omit<T, 'id'>): Promise<T> {
        const item = await this.site.createItem(this.key, this.toFields(entity as Partial<T>));
        return this.toEntity(item.id, item.fields);
    }

    /** Updates the given properties; `undefined` clears a column. Returns the new eTag. */
    async update(id: string, changes: Partial<Omit<T, 'id'>>, ifMatch?: string): Promise<string> {
        return this.site.updateItem(this.key, id, this.toFields(changes as Partial<T>, true), ifMatch);
    }

    async delete(id: string): Promise<void> {
        await this.site.deleteItem(this.key, id);
    }

    /** Builds an OData filter term for a domain property. */
    filter(prop: keyof T & string, value: string): string {
        return `fields/${this.column(prop).name} eq '${value.replaceAll("'", "''")}'`;
    }

    /** OData filter: text property starts with a prefix (e.g. a date). */
    startsWith(prop: keyof T & string, prefix: string): string {
        return `startswith(fields/${this.column(prop).name},'${prefix.replaceAll("'", "''")}')`;
    }

    private column(prop: string): ColumnSpec {
        const col = this.columns.find((c) => c.prop === prop);
        if (!col) throw new Error(`Unknown property ${prop}`);
        return col;
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
