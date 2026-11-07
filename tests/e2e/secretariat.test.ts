// Secretariat basics: form import and preview, procedures, editing an
// existing application with autosave, creating an empty application.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import { AppointmentService, Repository } from '../../packages/sharepoint/src/index.ts';
import { confirmDialog, launch, signIn, startDevServer, URLS, watchConsole } from '../support/browser.ts';
import { env, testSite } from '../support/env.ts';

const site = testSite();
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');

const tag = `E2E ${Date.now()}`;
const created = { form: '', procedure: '', applications: [] as string[] };
let stop = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];
const nav = (label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();
const field = (path: string) => page.locator(`[data-path="${path}"]`);

beforeAll(async () => {
    stop = await startDevServer('secretariat');
    browser = await launch();
    page = await browser.newPage();
    problems = watchConsole(page);
    await page.goto(URLS.secretariat);
    await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
    await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
});

afterAll(async () => {
    await browser?.close();
    stop();
    for (const id of created.applications) await applications.delete(id).catch(() => {});
    if (created.procedure) await procedures.delete(created.procedure).catch(() => {});
    if (created.form) await forms.delete(created.form).catch(() => {});
});

it('import test form', async () => {
    await nav('Formulare');
    await page.getByRole('button', { name: 'Testformular anlegen' }).click();
    const msg = await page.getByText(/Formular „.*“ als Version \d+ angelegt \(ID \d+\)/).textContent({ timeout: 20000 });
    created.form = /ID (\d+)/.exec(msg ?? '')![1];
    await page.getByRole('cell', { name: created.form, exact: true }).waitFor();
});

it('reject invalid form JSON on import', async () => {
    await page.locator('input[type=file]').setInputFiles({
        name: 'kaputt.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ formatVersion: 1, title: 'X', sections: [] })),
    });
    await page.getByText('Das Formular ist ungültig:').waitFor();
});

it('preview in secretariat mode shows conditionally hidden items', async () => {
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: created.form, exact: true }) });
    await row.getByRole('button', { name: 'Vorschau' }).click();
    await field('sorgeberechtigter2').waitFor();
    assert(await field('foerderschwerpunkt').isVisible(), 'hidden field not shown');
    assert((await page.getByText('Im Online-Formular ausgeblendet').count()) >= 3, 'hidden markers missing');
});

it('create procedure with validation', async () => {
    await nav('Verfahren');
    await page.getByRole('button', { name: 'Neues Verfahren' }).click();
    await page.getByLabel('Titel').fill(tag);
    await page.getByLabel('Beginn').fill('2030-03-01');
    await page.getByLabel('Ende').fill('2030-02-01');
    await page.getByText('Beginn liegt nach dem Ende').waitFor();
    await page.getByLabel('Ende').fill('2030-03-20');
    await page.getByLabel('Formular').selectOption(created.form);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('cell', { name: tag }).waitFor({ timeout: 20000 });
    const [p] = (await procedures.list()).filter((x) => x.info.title === tag);
    assert(p && p.formId === created.form && p.startDate === '2030-03-01', `stored procedure ${JSON.stringify(p)}`);
    created.procedure = p.id;
});

it('edit procedure', async () => {
    const row = page.getByRole('row').filter({ hasText: tag });
    await row.getByRole('button', { name: 'Bearbeiten' }).click();
    await page.getByLabel('Beschreibung').fill('Geändert im Test');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByText('Geändert im Test').waitFor({ timeout: 20000 });
    assert((await procedures.get(created.procedure))?.info.description === 'Geändert im Test', 'not stored');
});

it('open existing application with all fields', async () => {
    const app = await applications.create({
        procedureId: created.procedure,
        formId: created.form,
        state: 'submitted',
        childName: 'Testkind',
        data: { nachname: 'Testkind', foerderbedarf: 'nein', sorgeberechtigter1: { nachname: 'Eltern' } },
    });
    created.applications.push(app.id);
    await nav('Anmeldungen');
    await page.locator(`tr[data-id="${app.id}"]`).getByRole('button', { name: 'Öffnen' }).click();
    await field('nachname').waitFor({ timeout: 20000 });
    assert((await field('nachname').locator('input').inputValue()) === 'Testkind', 'value not loaded');
    assert(await field('foerderschwerpunkt').isVisible(), 'hidden field not shown');
    assert(await field('sorgeberechtigter2.nachname').isVisible(), 'hidden group not shown');
    assert((await field('geburtsdatum').locator('input').inputValue()) === '', 'unanswered field not empty');
});

it('edit is saved automatically and survives reload', async () => {
    const id = created.applications[0];
    await field('foerderschwerpunkt').locator('input').fill('Lernen');
    await field('schulen[0].von').locator('input').fill('2021');
    await page.getByTestId('save-status').getByText(/Gespeichert \d/).waitFor({ timeout: 20000 });

    await page.reload();
    await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
    await page.locator(`tr[data-id="${id}"]`).getByRole('button', { name: 'Öffnen' }).click();
    await field('foerderschwerpunkt').waitFor({ timeout: 20000 });
    assert((await field('foerderschwerpunkt').locator('input').inputValue()) === 'Lernen', 'edit lost after reload');

    const stored = (await applications.get(id))!.data as Record<string, any>;
    assert(stored.foerderschwerpunkt === 'Lernen' && stored.schulen[0].von === 2021, `stored ${JSON.stringify(stored)}`);
    assert(stored.nachname === 'Testkind', 'existing value lost');
});

it('create empty application for a procedure', async () => {
    await page.getByRole('button', { name: '← Zurück' }).click();
    await page.getByLabel('Verfahren').selectOption(created.procedure);
    await page.getByRole('button', { name: 'Leere Anmeldung anlegen' }).click();
    const heading = await page.getByRole('heading', { name: /#\d+/ }).textContent({ timeout: 20000 });
    created.applications.push(/#(\d+)/.exec(heading ?? '')![1]);
    assert((await applications.get(created.applications[1]))?.state === 'created', 'state not created');
});

it('a form in use cannot be deleted; the warning names the procedure', async () => {
    await nav('Formulare');
    await page.locator(`tr[data-id="${created.form}"]`).getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alert').filter({ hasText: `„${tag}“` }).waitFor({ timeout: 30000 });
    assert(await forms.get(created.form), 'form deleted');
});

it('delete procedure removes appointments, applications and uploads, not the form', async () => {
    const [slot] = await new AppointmentService(site).createDrafts([{ procedureId: created.procedure, datetime: '2030-03-05T10:00', state: 'draft' }]);
    const appId = created.applications[0]!;
    await site.putUpload(`${appId}/test.txt`, new Blob(['x'], { type: 'text/plain' }));
    await nav('Verfahren');
    const row = page.getByRole('row').filter({ hasText: tag });
    await row.getByRole('button', { name: 'Löschen' }).click();
    await confirmDialog(page);
    await page.getByText(`Verfahren „${tag}“ gelöscht, mit 2 Anmeldung(en) und 1 Termin(en).`).waitFor({ timeout: 30000 });
    await row.waitFor({ state: 'detached' });
    assert(!(await procedures.get(created.procedure).catch(() => undefined)), 'procedure still there');
    assert(!(await site.listItems('appointments', `fields/ProcedureId eq '${created.procedure}'`)).length && slot, 'appointments left');
    assert(!(await site.listItems('applications', `fields/ProcedureId eq '${created.procedure}'`)).length, 'applications left');
    assert(!(await site.listUploads(appId)).length, 'uploads left');
    assert(await forms.get(created.form), 'form deleted');
    created.procedure = '';
    created.applications = [];
});

it('an unused form version can be deleted', async () => {
    await nav('Formulare');
    const row = page.locator(`tr[data-id="${created.form}"]`);
    await row.getByRole('button', { name: 'Löschen' }).click();
    await confirmDialog(page);
    await page.getByText(/^Version \d+ von „.*“ gelöscht\.$/).waitFor({ timeout: 30000 });
    await row.waitFor({ state: 'detached' });
    assert(!(await forms.get(created.form).catch(() => undefined)), 'form still there');
    created.form = '';
});

it('no console errors or warnings', async () => {
    assert(problems.length === 0, problems.join(' | '));
});
