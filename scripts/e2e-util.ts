// Helpers for the browser end-to-end scripts (Playwright, headless Chromium).
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

export const URLS = { secretariat: 'http://localhost:5173', public: 'http://localhost:5174' } as const;

/** Starts a SPA dev server unless one is already running on its port. */
export async function startDevServer(app: keyof typeof URLS): Promise<() => void> {
    if (await isUp(URLS[app])) return () => {};
    const child: ChildProcess = spawn('pnpm', ['--filter', `@anmeldung/${app}`, 'dev'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 60; i++) {
        if (await isUp(URLS[app])) {
            return () => {
                try {
                    process.kill(-child.pid!);
                } catch {
                    // already gone
                }
            };
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${app} dev server did not start`);
}

async function isUp(url: string): Promise<boolean> {
    try {
        return (await fetch(url)).ok;
    } catch {
        return false;
    }
}

export async function launch(): Promise<Browser> {
    return chromium.launch();
}

/**
 * Collects console errors/warnings, uncaught exceptions and failed requests
 * while one of our apps is shown (the Microsoft login page is ignored).
 */
export function watchConsole(page: Page): string[] {
    const problems: string[] = [];
    const ours = () => page.url().startsWith('http://localhost');
    page.on('console', (m) => {
        if (ours() && (m.type() === 'error' || m.type() === 'warning')) problems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => problems.push(`exception: ${e.message.slice(0, 300)}`));
    page.on('response', (r) => {
        if (ours() && r.status() >= 400) {
            const u = new URL(r.url());
            problems.push(`http ${r.status()} ${r.request().method()} ${u.host}${u.pathname}`);
        }
    });
    return problems;
}

let failures = 0;

export async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
    try {
        await fn();
        console.log(`ok    ${name}`);
        return true;
    } catch (e) {
        failures++;
        console.log(`FAIL  ${name}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
        return false;
    }
}

export function assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new Error(message);
}

export function failureCount(): number {
    return failures;
}

/**
 * Signs in through the real Microsoft login page. Credentials are typed into
 * the page only and never logged; no screenshots are taken.
 */
export async function signIn(page: Page, user: string, password: string): Promise<void> {
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.waitForURL(/login\.microsoftonline\.com/);
    await page.fill('input[name="loginfmt"]', user);
    await page.click('#idSIButton9');
    await page.fill('input[name="passwd"]', password);
    await page.click('#idSIButton9');

    // optional "Stay signed in?" prompt
    const back = page.locator('#idBackButton');
    await Promise.race([
        back.waitFor({ timeout: 15000 }).then(() => back.click()),
        page.waitForURL(`${URLS.secretariat}/**`, { timeout: 15000 }),
    ]).catch(() => {});
    await page.waitForURL(`${URLS.secretariat}/**`, { timeout: 15000 }).catch(() => {
        throw new Error(`login did not return to the app (stuck at ${new URL(page.url()).host})`);
    });
}
