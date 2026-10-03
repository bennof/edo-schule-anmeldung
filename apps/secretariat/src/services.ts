// SharePoint access for the views. UI components use these repositories and
// never talk to Graph directly.
import type { Application, FormDefinition, Procedure } from '@anmeldung/domain';
import { ConfigStore, GraphClient, Repository, SharePointSite } from '@anmeldung/sharepoint';
import { getToken } from './auth.ts';
import { clientConfig } from './config.ts';

export const site = new SharePointSite(new GraphClient(getToken), clientConfig.siteId);
export const config = new ConfigStore(site);
export const procedures = new Repository<Procedure>(site, 'procedures');
export const forms = new Repository<FormDefinition>(site, 'forms');
export const applications = new Repository<Application>(site, 'applications');

export function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
