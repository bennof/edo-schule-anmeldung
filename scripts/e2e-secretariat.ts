// Browser test of the secretariat SPA (Sprint 2): form import and preview,
// procedure management (D1) and editing an existing application in the
// secretariat renderer mode (C4). Creates test data on the SharePoint test
// site and removes it afterwards.
// Usage: node scripts/e2e-secretariat.ts
import type { Application, FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import { GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');

const tag = `E2E ${Date.now()}`;
const created = { form: '', procedure: '', applications: [] as string[] };

const stop = await startDevServer('secretariat');
const browser = await launch();
try {
    const page = await browser.newPage();
    const problems = watchConsole(page);
    page.on('dialog', (d) => d.accept());
    await page.goto(URLS.secretariat);
    const ok = await step('sign in', async () => {
        await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
    });
    if (!ok) throw new Error('cannot continue without login');
    const nav = (label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();
    const field = (path: string) => page.locator(`[data-path="${path}"]`);

    await step('import test form', async () => {
        await nav('Formulare');
        await page.getByRole('button', { name: 'Testformular anlegen' }).click();
        const msg = await page.getByText(/Formular „.*“ angelegt \(ID \d+\)/).textContent({ timeout: 20000 });
        created.form = /ID (\d+)/.exec(msg ?? '')![1];
        await page.getByRole('cell', { name: created.form, exact: true }).waitFor();
    });

    await step('reject invalid form JSON on import', async () => {
        await page.locator('input[type=file]').setInputFiles({
            name: 'kaputt.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ formatVersion: 1, title: 'X', sections: [] })),
        });
        await page.getByText('Das Formular ist ungültig:').waitFor();
    });

    await step('preview in secretariat mode shows conditionally hidden items', async () => {
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: created.form, exact: true }) });
        await row.getByRole('button', { name: 'Vorschau' }).click();
        await field('sorgeberechtigter2').waitFor();
        assert(await field('foerderschwerpunkt').isVisible(), 'hidden field not shown');
        assert((await page.getByText('Im Online-Formular ausgeblendet').count()) >= 3, 'hidden markers missing');
    });

    await step('create procedure with validation', async () => {
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

    await step('edit procedure', async () => {
        const row = page.getByRole('row').filter({ hasText: tag });
        await row.getByRole('button', { name: 'Bearbeiten' }).click();
        await page.getByLabel('Beschreibung').fill('Geändert im Test');
        await page.getByRole('button', { name: 'Speichern' }).click();
        await page.getByText('Geändert im Test').waitFor({ timeout: 20000 });
        assert((await procedures.get(created.procedure))?.info.description === 'Geändert im Test', 'not stored');
    });

    await step('open existing application with all fields (C4)', async () => {
        const app = await applications.create({
            procedureId: created.procedure,
            formId: created.form,
            state: 'submitted',
            data: { nachname: 'Testkind', foerderbedarf: 'nein', sorgeberechtigter1: { nachname: 'Eltern' } },
        });
        created.applications.push(app.id);
        await nav('Anmeldungen');
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: app.id, exact: true }) });
        await row.getByRole('button', { name: 'Öffnen' }).click();
        assert((await field('nachname').locator('input').inputValue()) === 'Testkind', 'value not loaded');
        assert(await field('foerderschwerpunkt').isVisible(), 'hidden field not shown');
        assert(await field('sorgeberechtigter2.nachname').isVisible(), 'hidden group not shown');
        assert((await field('geburtsdatum').locator('input').inputValue()) === '', 'unanswered field not empty');
    });

    await step('edit and save, survives reload', async () => {
        const id = created.applications[0];
        await field('foerderschwerpunkt').locator('input').fill('Lernen');
        await field('schulen[0].von').locator('input').fill('2021');
        await page.getByRole('button', { name: 'Speichern' }).click();
        await page.getByText('Gespeichert.').waitFor({ timeout: 20000 });

        await page.reload();
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: id, exact: true }) });
        await row.getByRole('button', { name: 'Öffnen' }).click();
        assert((await field('foerderschwerpunkt').locator('input').inputValue()) === 'Lernen', 'edit lost after reload');

        const stored = (await applications.get(id))!.data as Record<string, any>;
        assert(stored.foerderschwerpunkt === 'Lernen' && stored.schulen[0].von === 2021, `stored ${JSON.stringify(stored)}`);
        assert(stored.nachname === 'Testkind', 'existing value lost');
    });

    await step('create empty application for a procedure', async () => {
        await page.getByRole('button', { name: '← Zur Liste' }).click();
        await page.getByLabel('Verfahren').selectOption(created.procedure);
        await page.getByRole('button', { name: 'Leere Anmeldung anlegen' }).click();
        const heading = await page.getByRole('heading', { name: /Anmeldung \d+/ }).textContent({ timeout: 20000 });
        created.applications.push(/Anmeldung (\d+)/.exec(heading ?? '')![1]);
        assert((await applications.get(created.applications[1]))?.state === 'created', 'state not created');
    });

    await step('no console errors or warnings', async () => {
        assert(problems.length === 0, problems.join(' | '));
    });
} finally {
    await browser.close();
    stop();
    for (const id of created.applications) await applications.delete(id).catch(() => {});
    if (created.procedure) await procedures.delete(created.procedure).catch(() => {});
    if (created.form) await forms.delete(created.form).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
