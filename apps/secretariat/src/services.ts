// SharePoint access for the views. UI components use these repositories and
// never talk to Graph directly.
import type { Application, FormDefinition, Procedure } from '@anmeldung/domain';
import type { Option } from '@anmeldung/forms';
import { ApplicationService, AppointmentService, ConfigStore, GraphClient, Repository, SharePointSite } from '@anmeldung/sharepoint';
import { getToken } from './auth.ts';
import { clientConfig } from './config.ts';

export const site = new SharePointSite(new GraphClient(getToken), clientConfig.siteId);
export const config = new ConfigStore(site);
export const procedures = new Repository<Procedure>(site, 'procedures');
export const forms = new Repository<FormDefinition>(site, 'forms');
export const applications = new Repository<Application>(site, 'applications');
export const appointments = new AppointmentService(site);
export const applicationService = new ApplicationService(site);

const optionCache = new Map<string, Promise<Option[]>>();

/** Loads a JSON option list (optionsSource) from the asset library. */
export function loadOptions(source: string): Promise<Option[]> {
    let cached = optionCache.get(source);
    if (!cached) {
        cached = site.getAsset(source).then(async (blob) => (blob ? (JSON.parse(await blob.text()) as Option[]) : []));
        cached.catch(() => optionCache.delete(source));
        optionCache.set(source, cached);
    }
    return cached;
}

export function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Uploads the bundled default template unless one exists (or `force`). */
export async function uploadDefaultTemplate(force = false): Promise<boolean> {
    const { PDF_TEMPLATE_KEY } = await import('@anmeldung/pdf');
    if (!force && (await site.listAssets()).some((a) => a.key === PDF_TEMPLATE_KEY)) return false;
    const { default: url } = await import('@anmeldung/pdf/templates/anmeldebogen.pdf?url');
    const bytes = await (await fetch(url)).blob();
    await site.putAsset(PDF_TEMPLATE_KEY, new Blob([bytes], { type: 'application/pdf' }));
    return true;
}
