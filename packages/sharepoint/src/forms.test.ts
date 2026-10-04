import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGraph } from './fake-graph.ts';
import { FormService, newFormKey } from './forms.ts';
import { GraphClient } from './graph.ts';
import { provision } from './provision.ts';
import { SharePointSite } from './site.ts';

let service: FormService;

beforeEach(async () => {
    const site = new SharePointSite(new GraphClient(async () => 't', new FakeGraph().fetch), 'site');
    await provision(site);
    service = new FormService(site);
});

describe('form versions (D3)', () => {
    it('builds readable keys', () => {
        expect(newFormKey('Anmeldung Klasse 5 – Schuljahr 2026/27')).toMatch(/^anmeldung-klasse-5-schuljahr-2026-27-[a-z0-9]{1,4}$/);
        expect(newFormKey('Größe')).toMatch(/^grosse-/);
    });

    it('saves new versions instead of changing old ones', async () => {
        const v1 = await service.saveVersion({ title: 'Anmeldung', v: 1 });
        const v2 = await service.saveVersion({ title: 'Anmeldung', v: 2 }, v1.formKey);
        const v3 = await service.saveVersion({ title: 'Anmeldung neu', v: 3 }, v1.formKey);
        expect([v1.version, v2.version, v3.version]).toEqual(['1', '2', '3']);
        expect(v2.id).not.toBe(v1.id);
        // the old version is untouched
        expect((await service.repo.get(v1.id))?.formJson).toEqual({ title: 'Anmeldung', v: 1 });

        const [family] = await service.families();
        expect(family.title).toBe('Anmeldung neu');
        expect(family.versions.map((v) => v.version)).toEqual(['3', '2', '1']);
    });

    it('treats forms from before versioning as version 1', async () => {
        const legacy = await service.repo.create({ formJson: { title: 'Alt' }, dateLastUpdate: '2026-01-01' });
        const [v] = await service.listVersions();
        expect(v).toMatchObject({ id: legacy.id, formKey: `form-${legacy.id}`, version: '1' });
        expect((await service.saveVersion({ title: 'Alt 2' }, v.formKey)).version).toBe('2');
    });
});
