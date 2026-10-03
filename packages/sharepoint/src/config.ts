// Key/value configuration stored in the Config list (backlog B3).
// Never store secrets here: entries may be read by browser code.
import type { ConfigEntry } from '@anmeldung/domain';
import { Repository } from './repository.ts';
import type { SharePointSite } from './site.ts';

type StoredEntry = ConfigEntry & { id: string };

export class ConfigStore {
    private readonly repo: Repository<StoredEntry>;

    constructor(site: SharePointSite) {
        this.repo = new Repository<StoredEntry>(site, 'config');
    }

    async all(): Promise<ConfigEntry[]> {
        return (await this.repo.list()).map(normalize);
    }

    async publicEntries(): Promise<ConfigEntry[]> {
        return (await this.all()).filter((e) => e.isPublic);
    }

    async get(key: string): Promise<string | undefined> {
        return (await this.find(key))?.value;
    }

    /** Creates or updates an entry. `isPublic` keeps its stored value when omitted. */
    async set(key: string, value: string, isPublic?: boolean): Promise<void> {
        const existing = await this.find(key);
        if (existing) {
            await this.repo.update(existing.id, { value, isPublic: isPublic ?? existing.isPublic });
        } else {
            await this.repo.create({ key, value, isPublic: isPublic ?? false });
        }
    }

    async delete(key: string): Promise<void> {
        const existing = await this.find(key);
        if (existing) await this.repo.delete(existing.id);
    }

    private async find(key: string): Promise<StoredEntry | undefined> {
        const [entry] = await this.repo.list(this.repo.filter('key', key));
        return entry && { ...normalize(entry), id: entry.id };
    }
}

function normalize(e: StoredEntry): ConfigEntry {
    return { key: e.key, value: e.value ?? '', isPublic: e.isPublic === true };
}
