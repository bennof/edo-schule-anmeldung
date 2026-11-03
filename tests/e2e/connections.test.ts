// Connection checks in the settings: SharePoint and the public server.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import { ConfigStore } from '../../packages/sharepoint/src/index.ts';
import { launch, signIn, startApiServer, startDevServer, URLS, watchConsole, type ApiServer } from '../support/browser.ts';
import { env, testSite } from '../support/env.ts';

const config = new ConfigStore(testSite());
let previousUrl: string | undefined;
let server: ApiServer | undefined;
let stopSecretariat = () => {};
let stopPublic = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];

beforeAll(async () => {
    // the server is reached through the public SPA's address
    previousUrl = await config.get('publicUrl');
    await config.set('publicUrl', URLS.public, false);
    server = await startApiServer();
    stopSecretariat = await startDevServer('secretariat');
    stopPublic = await startDevServer('public');
    browser = await launch();
    page = await browser.newPage();
    problems = watchConsole(page);
    await page.goto(`${URLS.secretariat}/#einstellungen`);
    await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
    await page.getByRole('heading', { name: 'Verbindungen' }).waitFor({ timeout: 20000 });
});

afterAll(async () => {
    await browser?.close();
    stopSecretariat();
    stopPublic();
    server?.stop();
    if (previousUrl === undefined) await config.delete('publicUrl').catch(() => {});
    else await config.set('publicUrl', previousUrl, false).catch(() => {});
});

it('SharePoint: site and schema', async () => {
    await page.getByRole('button', { name: 'SharePoint prüfen' }).click();
    const result = page.getByTestId('check-sharepoint');
    await result.getByText(/Verbunden mit „.+“ · Schema Version \d+/).waitFor({ timeout: 20000 });
});

it('server: running and reaching SharePoint with its daemon rights', async () => {
    await page.getByText(`${URLS.public}/api`).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Server prüfen' }).click();
    await page.getByTestId('check-server').getByText(/Server läuft \(Version [\d.]+\) · SharePoint-Zugriff des Servers in Ordnung/).waitFor({ timeout: 20000 });
});

it('server down: clear message instead of an error page', async () => {
    server?.stop();
    server = undefined;
    await page.getByRole('button', { name: 'Server prüfen' }).click();
    const text = await page.getByTestId('check-server').textContent({ timeout: 20000 });
    assert(/nicht erreichbar|Unerwartete Antwort/.test(text ?? ''), `result: ${text}`);
});

it('SVWS without endpoint: check is not offered', async () => {
    assert(await page.getByRole('button', { name: 'SVWS prüfen' }).isDisabled(), 'SVWS check enabled without endpoint');
});

it('no console errors or warnings', async () => {
    // the deliberately stopped server shows up as a failed request
    const unexpected = problems.filter((p) => !/api\/status|status of 50\d/.test(p));
    assert(unexpected.length === 0, unexpected.join(' | '));
});
