// The registration page as embedded in the server binary (not Vite): page,
// assets, booking and submission under the server's Content-Security-Policy.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Appointment, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import testForm from '../../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, Repository } from '../../packages/sharepoint/src/index.ts';
import { launch, startApiServer, type ApiServer } from '../support/browser.ts';
import { day, testSite } from '../support/env.ts';

const site = testSite();
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const appointments = new AppointmentService(site);

// own port, so a running development server does not interfere
const PORT = 23187;
const BASE = `http://127.0.0.1:${PORT}`;
const tag = `E2E Eingebettet ${Date.now()}`;
let form: FormDefinition | undefined;
let procedure: Procedure | undefined;
let slots: Appointment[] = [];
let server: ApiServer | undefined;
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];
const field = (path: string) => page.locator(`[data-path="${path}"]`);

beforeAll(async () => {
    // the server embeds whatever apps/public/dist holds at build time
    execSync('pnpm --filter @anmeldung/public build', { stdio: 'ignore' });
    form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
    procedure = await procedures.create({ formId: form.id, info: { title: tag }, startDate: day(-1), endDate: day(20) });
    slots = await appointments.createDrafts([{ procedureId: procedure.id, datetime: `${day(4)}T14:00`, state: 'draft' }]);
    await appointments.publish(slots.map((s) => s.id));
    server = await startApiServer({ port: PORT });
    browser = await launch();
    page = await (await browser.newContext()).newPage();
    // the server's page is not on "localhost", so watch every console message
    problems = [];
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) => problems.push(`exception: ${e.message.slice(0, 300)}`));
});

afterAll(async () => {
    await browser?.close();
    server?.stop();
    if (procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        await procedures.delete(procedure.id).catch(() => {});
    }
    if (slots.length) await site.deleteItems('appointments', slots.map((s) => s.id)).catch(() => {});
    if (form) await forms.delete(form.id).catch(() => {});
});

it('server delivers the page with security headers', async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.ok && res.headers.get('content-type')?.startsWith('text/html'), `status ${res.status}`);
    assert(res.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"), 'CSP missing');
    assert(res.headers.get('cache-control') === 'no-cache', 'index.html must not be cached');
    const asset = /\/assets\/[^"]+\.js/.exec(await res.text())![0];
    const js = await fetch(BASE + asset);
    assert(js.ok && js.headers.get('cache-control')?.includes('immutable'), 'hashed asset not cacheable');
    assert((await fetch(`${BASE}/assets/..%2F..%2F.env`)).status === 404, 'traversal');
});

it('book an appointment on the embedded page', async () => {
    await page.goto(BASE);
    const choice = page.getByRole('button', { name: new RegExp(tag) });
    await Promise.race([choice.waitFor({ timeout: 20000 }), page.getByRole('heading', { name: tag }).waitFor({ timeout: 20000 })]);
    if (await choice.isVisible()) await choice.click();
    await page.getByRole('button', { name: '14:00 Uhr' }).click();
    await page.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Familie Eingebettet');
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill('eingebettet@example.org');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
    await page.getByRole('heading', { name: 'Ihr Termin ist gebucht' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Weiter zum Anmeldeformular' }).click();
    await page.getByRole('heading', { name: 'Angaben zum Kind' }).waitFor({ timeout: 20000 });
});

it('fill in and submit the form', async () => {
    await field('nachname').locator('input').fill('Muster');
    await field('geburtsdatum').locator('input').fill('2015-04-01');
    await field('adresse.strasse').locator('input').fill('Weg 1');
    await field('adresse.plz').locator('input').fill('12345');
    await field('adresse.ort').locator('input').fill('Stadt');
    await field('sorgeberechtigter1.nachname').locator('input').fill('Muster');
    await field('sorgeberechtigter1.vorname').locator('input').fill('Eva');
    await field('schulen[0].schule').locator('input').fill('park');
    await page.getByRole('option', { name: 'Grundschule am Park' }).click();
    await field('schulen[0].von').locator('input').fill('2021');
    await page.getByRole('button', { name: 'Anmeldung absenden' }).click();
    await page.getByRole('heading', { name: /Vielen Dank/ }).waitFor({ timeout: 20000 });
});


it('no console errors, warnings or CSP violations', async () => {
    assert(problems.length === 0, problems.join(' | '));
});
