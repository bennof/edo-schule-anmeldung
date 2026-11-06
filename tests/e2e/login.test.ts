// Secretariat login with the M365 test user.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import { launch, signIn, startDevServer, URLS } from '../support/browser.ts';
import { env } from '../support/env.ts';

let stop = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;

beforeAll(async () => {
    stop = await startDevServer('secretariat');
    browser = await launch();
    page = await browser.newPage();
    await page.goto(URLS.secretariat);
});

afterAll(async () => {
    await browser?.close();
    stop();
});

it('gear on the sign-in screen opens the tenant settings', async () => {
    await page.getByRole('button', { name: 'Anmeldung einrichten' }).click();
    await page.getByRole('heading', { name: 'Anmeldung einrichten' }).waitFor();
    assert((await page.getByLabel('Tenant-ID').inputValue()) === env.TENANT_ID, 'tenant prefilled');
    assert(!(await page.getByLabel('Site-ID').isVisible()), 'only the Microsoft 365 block');
    await page.getByRole('button', { name: 'Zurück zur Anmeldung' }).click();
    await page.getByRole('heading', { name: 'Willkommen' }).waitFor();
});

it('sign in with the test user', async () => {
    await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
});

it('site access granted, schema visible', async () => {
    await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
    await page.getByRole('navigation').getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByText(/Schema: Version \d+/).waitFor({ timeout: 20000 });
    const schema = (await page.getByText(/Schema:/).textContent())?.replace(/\s+/g, ' ').trim();
    assert(!schema?.includes('nicht initialisiert'), `unexpected: ${schema}`);
});

it('account menu: name opens a popup with sign-out', async () => {
    const me = page.getByRole('button', { name: /Angemeldet als/ });
    await me.click();
    const menu = page.getByRole('menu', { name: 'Konto' });
    await menu.getByRole('menuitem', { name: 'Abmelden' }).waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
});
