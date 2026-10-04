// Sprint 6 browser test for N1, N2 and M2: installation configuration per
// browser (export/import, setup screen, no secrets), SVWS endpoint and the
// transfer selection of released applications (no real transfer yet).
// Usage: node scripts/e2e-config.ts
import fs from 'node:fs';
import type { Application, FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import testForm from '../packages/forms/examples/test-form.json' with { type: 'json' };
import { GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');

const form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
const procedure = await procedures.create({ formId: form.id, info: { title: 'E2E Konfiguration' }, startDate: day(-1), endDate: day(10) });
const released = await applications.create({ procedureId: procedure.id, formId: form.id, state: 'ready_for_svws', data: { nachname: 'Freigabe' }, childName: 'Freigabe, Test' });

const stop = await startDevServer('secretariat');
const browser = await launch();
const tmp = fs.mkdtempSync('/tmp/claude-e2e-config-');
try {
    const page = await (await browser.newContext()).newPage();
    const problems = watchConsole(page);
    page.on('dialog', (d) => d.accept());
    const nav = (label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();
    let exported: Record<string, unknown> = {};

    await step('export the configuration as JSON without secrets (N1)', async () => {
        await page.goto(URLS.secretariat);
        await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await nav('Einstellungen');
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportieren (JSON)' }).click()]);
        exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert(exported.schemaVersion === 1 && exported.clientId === env.APP_CLIENT_ID && exported.siteId === env.SHAREPOINT_ID, 'content');
        const text = JSON.stringify(exported);
        for (const secret of [env.APP_CLIENT_SECRET, env.DAEMON_CLIENT_SECRET, env.APP_TEST_USER_PWD]) assert(!text.includes(secret), 'secret exported');
    });

    await step('invalid browser configuration shows the setup screen', async () => {
        await page.evaluate(() => localStorage.setItem('anmeldung.secretariat.config', '{"schemaVersion":1}'));
        await page.reload();
        await page.getByRole('heading', { name: 'Einrichtung dieses Browsers' }).waitFor({ timeout: 20000 });
        assert(await page.getByText('tenantId muss eine GUID sein').isVisible(), 'errors not shown');
    });

    await step('import with a secret is rejected', async () => {
        const file = `${tmp}/mit-secret.json`;
        fs.writeFileSync(file, JSON.stringify({ ...exported, clientSecret: 'nicht erlaubt' }));
        await page.locator('input[type=file]').setInputFiles(file);
        await page.getByText(/Geheimnisse gehören nicht in die Browser-Konfiguration/).waitFor();
    });

    await step('import incl. SVWS endpoint restores the app (N1, N2)', async () => {
        const file = `${tmp}/konfiguration.json`;
        fs.writeFileSync(file, JSON.stringify({ ...exported, svws: { url: 'https://svws.schule.local:8443', transport: 'proxy', proxyUrl: 'https://proxy.schule.local' } }));
        await page.locator('input[type=file]').setInputFiles(file);
        await page.getByText('Angemeldet als').waitFor({ timeout: 30000 });
        await nav('Einstellungen');
        await page.getByText('Quelle: in diesem Browser gespeichert').waitFor({ timeout: 20000 });
        assert((await page.getByLabel('SVWS-Adresse').inputValue()) === 'https://svws.schule.local:8443', 'svws url');
        assert((await page.getByLabel('Proxy-Adresse').inputValue()) === 'https://proxy.schule.local', 'proxy url');
    });

    await step('released applications can be selected; without schema the adapter is not configured (M2)', async () => {
        await nav('Anmeldungen');
        const box = page.getByTestId('svws-transfer');
        await box.waitFor({ timeout: 20000 });
        const open = page.getByRole('button', { name: 'Ausgewählte an SVWS übertragen …' });
        assert(await open.isDisabled(), 'enabled without selection');
        await page.locator(`tr[data-id="${released.id}"]`).getByRole('checkbox').check();
        await box.getByText(/^1 von \d+ freigegebenen/).waitFor();
        await open.click();
        await page.getByTestId('svws-dialog').getByText(/Kein SVWS-Endpunkt konfiguriert/).waitFor({ timeout: 10000 });
        assert((await applications.get(released.id))?.state === 'ready_for_svws', 'state changed');
    });

    await step('reset falls back to the installation defaults', async () => {
        await nav('Einstellungen');
        await page.getByRole('button', { name: 'Zurücksetzen' }).click();
        await page.getByText('Angemeldet als').waitFor({ timeout: 30000 });
        await nav('Einstellungen');
        await page.getByText('Quelle: Vorgabe der Installation').waitFor({ timeout: 20000 });
    });

    await step('no console errors or warnings', async () => {
        assert(problems.length === 0, problems.join(' | '));
    });
} finally {
    await browser.close();
    stop();
    fs.rmSync(tmp, { recursive: true, force: true });
    await applications.delete(released.id).catch(() => {});
    await procedures.delete(procedure.id).catch(() => {});
    await forms.delete(form.id).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
