// Form versions (backlog D3): a saved version is never changed. Saving a
// change creates a new item with the same formKey and a version label (free
// text, e.g. "2026/27" or "Entwurf Mai"; default the next number), so
// applications keep the exact definition they were created with.
import type { FormDefinition, Procedure } from '@anmeldung/domain';
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

/** Newest first: by save time, then by item id. */
export function newestFirst(a: FormVersion, b: FormVersion): number {
    return b.dateLastUpdate.localeCompare(a.dateLastUpdate) || Number(b.id) - Number(a.id);
}

/** Suggested label for the next version: one more than the highest number used. */
export function nextVersionLabel(versions: Pick<FormVersion, 'version'>[]): string {
    const numbers = versions.map((v) => Number(v.version)).filter((n) => Number.isInteger(n) && n > 0);
    return String(Math.max(versions.length, ...numbers) + 1);
}

/** A version label that is already used in the form. */
export class VersionExistsError extends Error {
    constructor(label: string) {
        super(`Die Version „${label}“ gibt es in diesem Formular schon. Bitte eine andere Bezeichnung wählen.`);
    }
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

/** The form is still used; `procedureIds` names the procedures. */
export class FormInUseError extends Error {
    readonly procedureIds: string[];

    constructor(procedureIds: string[]) {
        super('Das Formular wird noch verwendet');
        this.procedureIds = procedureIds;
    }
}

export class FormService {
    readonly repo: Repository<FormDefinition>;
    private readonly site: SharePointSite;

    constructor(site: SharePointSite) {
        this.site = site;
        this.repo = new Repository<FormDefinition>(site, 'forms');
    }

    /**
     * Procedures that use a version of the form: as their form, or through
     * applications created with it (a procedure may have switched versions).
     */
    async usedBy(formKey: string): Promise<string[]> {
        return this.usedByVersions((await this.listVersions()).filter((v) => v.formKey === formKey).map((v) => v.id));
    }

    /** Procedures that use these versions (see usedBy). */
    async usedByVersions(ids: string[]): Promise<string[]> {
        const procedures = await new Repository<Procedure>(this.site, 'procedures').list();
        const used = new Set(procedures.filter((p) => ids.includes(p.formId)).map((p) => p.id));
        // FormId is not indexed: read both columns of all applications and filter here
        for (const a of await this.site.listItems('applications', undefined, ['ProcedureId', 'FormId'])) {
            if (ids.includes(String(a.fields.FormId))) used.add(String(a.fields.ProcedureId));
        }
        return [...used];
    }

    /** Deletes all versions of a form; refused while a procedure uses it. */
    async deleteFamily(formKey: string): Promise<void> {
        const used = await this.usedBy(formKey);
        if (used.length) throw new FormInUseError(used);
        const ids = (await this.listVersions()).filter((v) => v.formKey === formKey).map((v) => v.id);
        if (ids.length) await this.site.deleteItems('forms', ids);
    }

    /** Deletes one version; refused while a procedure uses it. The last version removes the form. */
    async deleteVersion(id: string): Promise<void> {
        const used = await this.usedByVersions([id]);
        if (used.length) throw new FormInUseError(used);
        await this.site.deleteItems('forms', [id]);
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
                versions.sort(newestFirst);
                return { formKey, title: titleOf(versions[0]), versions };
            })
            .sort((a, b) => a.title.localeCompare(b.title, 'de'));
    }

    /**
     * Saves a definition as a new version. Without `formKey` a new form is
     * started. `label` is the version label (default: the next number); it
     * must be unique within the form. The definition must be validated by the caller.
     */
    async saveVersion(formJson: unknown, formKey?: string, label?: string): Promise<FormVersion> {
        const key = formKey ?? newFormKey(titleOf({ id: '', formJson, dateLastUpdate: '' }));
        const existing = formKey ? (await this.listVersions()).filter((v) => v.formKey === formKey) : [];
        const version = label?.trim() || nextVersionLabel(existing);
        if (existing.some((v) => v.version === version)) throw new VersionExistsError(version);
        const created = await this.repo.create({ formJson, dateLastUpdate: new Date().toISOString(), formKey: key, version });
        return { ...created, formKey: key, version };
    }
}
