// End-to-end check of the secretariat login (J1) with the M365 test user.
// Usage: node scripts/e2e-login.ts
import { readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS } from './e2e-util.ts';

const env = readEnv();
const stop = await startDevServer('secretariat');
const browser = await launch();
try {
    const page = await browser.newPage();
    await page.goto(URLS.secretariat);
    await step('sign in with the test user', () => signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD));
    await step('site access granted, schema visible', async () => {
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await page.getByRole('navigation').getByRole('link', { name: 'Einstellungen' }).click();
        await page.getByText(/Schema: Version \d+/).waitFor({ timeout: 20000 });
        const schema = (await page.getByText(/Schema:/).textContent())?.replace(/\s+/g, ' ').trim();
        assert(!schema?.includes('nicht initialisiert'), `unexpected: ${schema}`);
        console.log(`      ${schema}`);
    });
} finally {
    await browser.close();
    stop();
}
process.exit(failureCount() ? 1 : 0);
