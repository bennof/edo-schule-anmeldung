// Form versions (backlog D3): a saved version is never changed. Saving a
// change creates a new item with the same formKey and the next version, so
// applications keep the exact definition they were created with.
import type { FormDefinition } from '@anmeldung/domain';
import { Repository } from './repository.ts';
import type { SharePointSite } from './site.ts';

export interface FormVersion extends FormDefinition {
    formKey: string;
    version: string;
}

export interface FormFamily {
    formKey: string;
    title: string;
    /** newest first */
    versions: FormVersion[];
}

const titleOf = (f: FormDefinition) => String((f.formJson as { title?: unknown })?.title ?? 'Formular');

/** Key from the title, e.g. "Anmeldung Klasse 5" -> "anmeldung-klasse-5-k3f9". */
export function newFormKey(title: string): string {
    const slug = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    return `${slug || 'formular'}-${Math.random().toString(36).slice(2, 6)}`;
}

export class FormService {
    readonly repo: Repository<FormDefinition>;

    constructor(site: SharePointSite) {
        this.repo = new Repository<FormDefinition>(site, 'forms');
    }

    /** All versions; forms saved before versioning count as version 1 of their own key. */
    async listVersions(): Promise<FormVersion[]> {
        return (await this.repo.list()).map((f) => ({ ...f, formKey: f.formKey ?? `form-${f.id}`, version: f.version ?? '1' }));
    }

    async families(): Promise<FormFamily[]> {
        const byKey = new Map<string, FormVersion[]>();
        for (const v of await this.listVersions()) byKey.set(v.formKey, [...(byKey.get(v.formKey) ?? []), v]);
        return [...byKey.entries()]
            .map(([formKey, versions]) => {
                versions.sort((a, b) => Number(b.version) - Number(a.version));
                return { formKey, title: titleOf(versions[0]), versions };
            })
            .sort((a, b) => a.title.localeCompare(b.title, 'de'));
    }

    /**
     * Saves a definition as a new version. Without `formKey` a new form is
     * started (version 1). The definition must be validated by the caller.
     */
    async saveVersion(formJson: unknown, formKey?: string): Promise<FormVersion> {
        const key = formKey ?? newFormKey(titleOf({ id: '', formJson, dateLastUpdate: '' }));
        const existing = formKey ? (await this.listVersions()).filter((v) => v.formKey === formKey) : [];
        const version = String(Math.max(0, ...existing.map((v) => Number(v.version))) + 1);
        const created = await this.repo.create({ formJson, dateLastUpdate: new Date().toISOString(), formKey: key, version });
        return { ...created, formKey: key, version };
    }
}
