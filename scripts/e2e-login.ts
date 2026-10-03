// End-to-end check of the secretariat login (J1) with the M365 test user.
// Starts the secretariat dev server, signs in through the real Microsoft
// login page and expects the signed-in view. Credentials are typed into the
// page only and never logged; no screenshots are taken.
// Usage: node scripts/e2e-login.ts
import { spawn } from 'node:child_process';
import { chromium, type Page } from 'playwright-core';
import { readEnv } from './env.ts';

const env = readEnv();
const APP_URL = 'http://localhost:5173';

const server = spawn('pnpm', ['--filter', '@anmeldung/secretariat', 'dev'], { stdio: 'ignore', detached: true });
const stopServer = () => {
    try {
        process.kill(-server.pid!);
    } catch {
        // already gone
    }
};

async function waitForServer(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(APP_URL)).ok) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('dev server did not start');
}

/** Current state for logs: host and the page's main heading, nothing else. */
async function where(page: Page): Promise<string> {
    const heading = await page.locator('h1, [role="heading"]').first().textContent({ timeout: 2000 }).catch(() => '');
    return `${new URL(page.url()).host} "${(heading ?? '').trim().slice(0, 80)}"`;
}

const browser = await chromium.launch();
let ok = false;
try {
    await waitForServer();
    const page = await browser.newPage();
    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await page.waitForURL(/login\.microsoftonline\.com/);
    await page.fill('input[name="loginfmt"]', env.APP_TEST_USER);
    await page.click('#idSIButton9');
    await page.fill('input[name="passwd"]', env.APP_TEST_USER_PWD);
    await page.click('#idSIButton9');

    // optional "Stay signed in?" prompt
    const back = page.locator('#idBackButton');
    await Promise.race([
        back.waitFor({ timeout: 15000 }).then(() => back.click()),
        page.waitForURL(`${APP_URL}/**`, { timeout: 15000 }),
    ]).catch(() => {});

    await page.waitForURL(`${APP_URL}/**`, { timeout: 15000 }).catch(async () => {
        throw new Error(`login did not return to the app, stuck at ${await where(page)}`);
    });
    const signedIn = page.getByText('Angemeldet als');
    const denied = page.getByText('hat keinen Zugriff');
    await Promise.race([signedIn.waitFor({ timeout: 20000 }), denied.waitFor({ timeout: 20000 })]).catch(async () => {
        // app page only, contains no credentials
        const text = (await page.locator('main').textContent())?.replace(/\s+/g, ' ').trim();
        throw new Error(`unexpected app state: ${text?.slice(0, 300)}`);
    });
    if (await denied.isVisible()) throw new Error('test user was denied access to the site');

    const schema = await page.getByText(/Schema:/).textContent();
    console.log(`ok    signed in; ${schema?.replace(/\s+/g, ' ').trim()}`);
    const rows = await page.locator('tbody tr').count();
    console.log(`ok    config table visible (${rows} entries)`);
    ok = true;
} catch (e) {
    console.log(`FAIL  ${e instanceof Error ? e.message.split('\n')[0] : e}`);
} finally {
    await browser.close();
    stopServer();
}
process.exit(ok ? 0 : 1);
