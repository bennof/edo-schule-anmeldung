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
