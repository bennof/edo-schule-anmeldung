// Starts the apps for the tests and drives the browser (Playwright, headless Chromium).
import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const WINDOWS = process.platform === 'win32';

export const URLS = { secretariat: 'http://localhost:8944', public: 'http://localhost:8954' } as const;

/** Port of the Rust public server; the SPA dev servers proxy /api there. */
export const API_PORT = 23180;

/** Starts a SPA dev server unless one is already running on its port. */
export async function startDevServer(app: keyof typeof URLS): Promise<() => void> {
    if (await isUp(URLS[app])) return () => {};
    // pnpm is a .cmd script on Windows and needs a shell there
    const child: ChildProcess = spawn('pnpm', ['--filter', `@anmeldung/${app}`, 'dev'], { stdio: 'ignore', detached: !WINDOWS, shell: WINDOWS });
    for (let i = 0; i < 60; i++) {
        if (await isUp(URLS[app])) return () => killTree(child);
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${app} dev server did not start`);
}

export interface ApiServer {
    /** e.g. http://127.0.0.1:23180/api */
    api: string;
    /** everything the server wrote to stdout/stderr so far */
    log: () => string;
    stop: () => void;
}

/** Builds and starts the Rust public server. Mails are disabled unless `env` says otherwise. */
export async function startApiServer(options: { port?: number; env?: Record<string, string> } = {}): Promise<ApiServer> {
    const port = options.port ?? API_PORT;
    // cargo from rustup is not always on PATH; Windows calls the variable "Path"
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, [pathKey]: [path.join(os.homedir(), '.cargo', 'bin'), process.env[pathKey]].join(path.delimiter) };
    execSync('cargo build -q', { cwd: 'server', stdio: 'inherit', env });
    const binary = path.resolve('server', 'target', 'debug', WINDOWS ? 'edo-anmeldung-server.exe' : 'edo-anmeldung-server');
    const child = spawn(binary, {
        cwd: 'server',
        env: { ...env, MAIL_DISABLED: '1', BIND_ADDR: `127.0.0.1:${port}`, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const api = `http://127.0.0.1:${port}/api`;
    for (let i = 0; i < 100 && !(await isUp(`${api}/health`)); i++) await new Promise((r) => setTimeout(r, 200));
    if (!(await isUp(`${api}/health`))) {
        child.kill();
        throw new Error(`public server did not start: ${log.slice(-500)}`);
    }
    return { api, log: () => log, stop: () => child.kill() };
}

/** Stops a process with everything it started (the dev server runs below pnpm). */
function killTree(child: ChildProcess): void {
    if (!child.pid) return;
    try {
        if (WINDOWS) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid);
    } catch {
        // already gone
    }
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

/** Expected failures: an account without profile photo answers 404. */
const EXPECTED = (url: string) => url.includes('/me/photos/');

/**
 * Collects console errors/warnings, uncaught exceptions and failed requests
 * while one of our apps is shown (the Microsoft login page is ignored).
 */
export function watchConsole(page: Page): string[] {
    const problems: string[] = [];
    const ours = () => page.url().startsWith('http://localhost');
    page.on('console', (m) => {
        if (ours() && (m.type() === 'error' || m.type() === 'warning') && !EXPECTED(m.location().url)) {
            problems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
        }
    });
    page.on('pageerror', (e) => problems.push(`exception: ${e.message.slice(0, 300)}`));
    page.on('response', (r) => {
        if (ours() && r.status() >= 400 && !EXPECTED(r.url())) {
            const u = new URL(r.url());
            problems.push(`http ${r.status()} ${r.request().method()} ${u.host}${u.pathname}`);
        }
    });
    return problems;
}

/**
 * Signs in to the secretariat through the real Microsoft login page.
 * Credentials are typed into the page only and never logged; no screenshots are taken.
 */
export async function signIn(page: Page, user: string, password: string): Promise<void> {
    await page.getByRole('button', { name: 'Anmelden' }).click();
    // Microsoft's login page is sometimes slow after many logins in a row
    await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 60000 });
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
    await page.waitForURL(`${URLS.secretariat}/**`, { timeout: 45000 }).catch(() => {
        throw new Error(`login did not return to the app (stuck at ${new URL(page.url()).host})`);
    });
}
