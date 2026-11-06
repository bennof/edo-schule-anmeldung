import { describe, expect, it } from 'vitest';
import { exportClientConfig, parseClientConfig } from './client-config.ts';

const valid = {
    schemaVersion: 1,
    tenantId: '11111111-2222-4333-8444-555555555555',
    clientId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    siteId: 'contoso.sharepoint.com,1,2',
    siteUrl: 'https://contoso.sharepoint.com/sites/Anmeldung',
};

describe('client configuration (N1, N2)', () => {
    it('accepts a valid configuration and round-trips through JSON', () => {
        const { config, errors } = parseClientConfig(valid);
        expect(errors).toEqual([]);
        expect(parseClientConfig(JSON.parse(exportClientConfig(config!))).config).toEqual(config);
    });

    it('rejects secrets, unknown keys and wrong versions', () => {
        const { errors } = parseClientConfig({ ...valid, schemaVersion: 2, clientSecret: 'x', foo: 1 });
        expect(errors.join(' ')).toMatch(/Geheimnisse.*clientSecret/);
        expect(errors.join(' ')).toMatch(/Unbekannte Einträge: foo/);
        expect(errors.join(' ')).toMatch(/schemaVersion/);
    });

    it('accepts the expiry date of the server secret, not the secret', () => {
        const { config, errors } = parseClientConfig({ ...valid, daemonSecretExpires: '2028-11-06' });
        expect(errors).toEqual([]);
        expect(config?.daemonSecretExpires).toBe('2028-11-06');
        expect(parseClientConfig({ ...valid, daemonSecretExpires: 'bald' }).errors.join(' ')).toMatch(/Datum/);
        expect(parseClientConfig({ ...valid, daemonSecret: 'x' }).errors.join(' ')).toMatch(/Geheimnisse/);
    });

    it('checks ids and urls', () => {
        expect(parseClientConfig({ ...valid, tenantId: 'abc', siteUrl: 'http://x' }).errors).toHaveLength(2);
        expect(parseClientConfig(null).errors).toEqual(['Kein JSON-Objekt']);
    });

    it('accepts an optional SVWS endpoint and validates it', () => {
        const ok = parseClientConfig({ ...valid, svws: { url: 'https://svws.schule.local:8443', transport: 'proxy', proxyUrl: 'https://proxy.schule.de', schema: 'gymabi', schuljahr: 2026 } });
        expect(ok.config?.svws).toEqual({ url: 'https://svws.schule.local:8443', transport: 'proxy', proxyUrl: 'https://proxy.schule.de', schema: 'gymabi', schuljahr: 2026 });
        expect(parseClientConfig({ ...valid, svws: { url: 'https://svws.local', transport: 'direct', schema: 'drop table' } }).errors[0]).toMatch(/Schema/);
        expect(parseClientConfig({ ...valid, svws: { url: 'svws', transport: 'direct' } }).errors[0]).toMatch(/^SVWS:/);
    });
});
