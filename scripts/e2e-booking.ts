// Sprint 3 end-to-end test, the first real technical run from the backlog:
// SharePoint -> create appointments (secretariat) -> publish -> public SPA
// -> book -> SharePoint. Starts the Rust server and both dev servers.
// Creates its own test data and removes it afterwards.
// Usage: node scripts/e2e-booking.ts
import type { FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import testForm from '../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, ConfigStore, GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole, startApiServer } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const appointments = new AppointmentService(site);
const config = new ConfigStore(site);

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const tag = `E2E Termine ${Date.now()}`;
const slotDay = day(3);
const cleanup = { logo: false, schoolName: false };

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
const procedure = await procedures.create({
    formId: form.id,
    info: { title: tag, description: 'Testverfahren aus dem automatischen Test' },
    startDate: day(-1),
    endDate: day(20),
});
if ((await config.get('schoolName')) === undefined) {
    await config.set('schoolName', 'Testschule', true);
    cleanup.schoolName = true;
}

const server = await startApiServer();
const stopSecretariat = await startDevServer('secretariat');
const stopPublic = await startDevServer('public');
const browser = await launch();

try {
    const page = await browser.newPage();
    const problems = watchConsole(page);
    page.on('dialog', (d) => d.accept());

    await step('sign in to the secretariat', async () => {
        await page.goto(URLS.secretariat);
        await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
    });

    await step('upload logo (B4) if none exists', async () => {
        await page.getByRole('navigation').getByRole('link', { name: 'Dateien' }).click();
        await page.getByRole('heading', { name: 'Dateien' }).waitFor();
        await page.getByText(/Noch keine Dateien|Löschen/).first().waitFor({ timeout: 20000 });
        if (await page.getByRole('cell', { name: 'logo', exact: true }).isVisible()) return;
        await page.locator('input[type=file]').setInputFiles({ name: 'Logo.png', mimeType: 'image/png', buffer: PNG });
        await page.getByRole('button', { name: 'Als Logo' }).click();
        cleanup.logo = true;
        await page.getByRole('button', { name: 'Hochladen', exact: true }).click();
        await page.getByText('„logo“ gespeichert.').waitFor({ timeout: 20000 });
        await page.getByRole('img', { name: 'logo' }).waitFor({ timeout: 20000 });
    });

    await step('generate a parallel plan with a break (E2, E5)', async () => {
        await page.getByRole('navigation').getByRole('link', { name: 'Termine' }).click();
        await page.getByLabel('Verfahren').selectOption(procedure.id);
        await page.getByLabel('Datum').fill(slotDay);
        await page.getByLabel('Anfang').fill('08:00');
        await page.getByLabel('Ende').fill('09:20');
        await page.getByLabel('Intervall (Minuten)').fill('20');
        await page.getByLabel(/Verantwortliche/).fill('Raum 1, Raum 2');
        await page.getByRole('button', { name: 'Pause hinzufügen' }).click();
        await page.getByLabel('Pause von').fill('08:40');
        await page.getByLabel('Pause bis').fill('09:00');
        await page.getByText('6 Termine', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Entwürfe anlegen' }).click();
        await page.getByText('6 Entwürfe angelegt.').waitFor({ timeout: 30000 });
        const list = await appointments.listForProcedure(procedure.id);
        const times = list.map((a) => `${a.datetime.slice(11)}/${a.verantwortlicherId}`);
        assert(
            JSON.stringify(times) === JSON.stringify(['08:00/Raum 1', '08:00/Raum 2', '08:20/Raum 1', '08:20/Raum 2', '09:00/Raum 1', '09:00/Raum 2']),
            `plan ${times}`,
        );
        assert(list.every((a) => a.state === 'draft'), 'not drafts');
    });

    await step('generating the same day again skips existing slots', async () => {
        await page.getByText('(6 davon bereits vorhanden)').waitFor();
        assert(await page.getByRole('button', { name: 'Entwürfe anlegen' }).isDisabled(), 'button enabled');
    });

    await step('edit and delete drafts (E3)', async () => {
        const list = await appointments.listForProcedure(procedure.id);
        const last = list[list.length - 1];
        const row = page.locator(`tr[data-id="${last.id}"]`);
        await row.getByRole('button', { name: 'Ändern' }).click();
        await row.getByLabel('Uhrzeit').fill('09:10');
        await row.getByRole('button', { name: 'Speichern' }).click();
        await page.getByText('Termin geändert.').waitFor({ timeout: 20000 });
        assert((await appointments.repo.get(last.id))?.datetime === `${slotDay}T09:10`, 'time not changed');
        await page.locator(`tr[data-id="${last.id}"]`).getByRole('button', { name: 'Löschen' }).click();
        await page.getByText('1 Entwürfe gelöscht.').waitFor({ timeout: 20000 });
        assert((await appointments.listForProcedure(procedure.id)).length === 5, 'not deleted');
    });

    await step('publish (E4)', async () => {
        await page.getByRole('button', { name: 'Alle Entwürfe veröffentlichen' }).click();
        await page.getByText('5 Termine veröffentlicht.').waitFor({ timeout: 30000 });
        assert((await appointments.listForProcedure(procedure.id)).every((a) => a.state === 'available'), 'not available');
    });

    const pub = await browser.newPage();
    const pubProblems = watchConsole(pub);
    const openProcedure = async (p = pub) => {
        await p.goto(URLS.public);
        const choice = p.getByRole('button', { name: new RegExp(tag) });
        await Promise.race([choice.waitFor({ timeout: 15000 }), p.getByRole('heading', { name: tag }).waitFor({ timeout: 15000 })]);
        if (await choice.isVisible()) await choice.click();
        await p.getByRole('heading', { name: 'Termin wählen' }).waitFor({ timeout: 15000 });
    };

    await step('public SPA shows branding and the procedure (G1)', async () => {
        await openProcedure();
        assert(await pub.getByRole('heading', { name: tag }).isVisible(), 'procedure title');
        await pub.locator('header img').waitFor({ timeout: 10000 });
        const natural = await pub.locator('header img').evaluate((img: HTMLImageElement) => img.naturalWidth);
        assert(natural === 1, `logo not decoded (naturalWidth ${natural})`);
        assert((await pub.locator('.school').textContent())?.length, 'school name missing');
    });

    await step('slot selection shows parallel times once (G2)', async () => {
        const times = await pub.locator('.times button').allTextContents();
        assert(JSON.stringify(times) === JSON.stringify(['08:00 Uhr', '08:20 Uhr', '09:00 Uhr']), `times ${times}`);
    });

    await step('book an appointment and reach the form (G3)', async () => {
        await pub.getByRole('button', { name: '08:00 Uhr' }).click();
        await pub.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Eva Testfamilie');
        await pub.getByLabel('E-Mail-Adresse', { exact: true }).fill('eva@example.org');
        assert(await pub.getByRole('button', { name: 'Termin verbindlich buchen' }).isDisabled(), 'consent not required');
        const consent = await pub.getByTestId('consent-text').textContent();
        assert(consent === (await config.get('consentText')), `consent text not from config: ${consent}`);
        await pub.getByRole('checkbox').check();
        await pub.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
        await pub.getByRole('heading', { name: 'Ihr Termin ist gebucht' }).waitFor({ timeout: 20000 });
        await pub.getByRole('button', { name: 'Weiter zum Anmeldeformular' }).click();
        await pub.getByRole('heading', { name: testForm.title }).waitFor({ timeout: 20000 });
        await pub.getByRole('heading', { name: 'Angaben zum Kind' }).waitFor();
    });

    await step('booking stored in SharePoint', async () => {
        const booked = (await appointments.listForProcedure(procedure.id)).filter((a) => a.state === 'booked');
        assert(booked.length === 1, `booked ${booked.length}`);
        const [a] = booked;
        assert(a.datetime === `${slotDay}T08:00` && a.nameCustomer === 'Eva Testfamilie' && a.emailCustomer === 'eva@example.org', 'data');
        assert(a.requestTime && Date.now() - Date.parse(a.requestTime) < 120000, `requestTime ${a.requestTime}`);
        assert(a.applicationId, 'no application linked (F5)');
    });

    await step('two families pick the last 08:00 slot: one wins, the other is told', async () => {
        // separate browser contexts = two devices without a stored booking
        const first = await (await browser.newContext()).newPage();
        const other = await (await browser.newContext()).newPage();
        await openProcedure(first);
        await openProcedure(other);
        for (const p of [first, other]) {
            await p.getByRole('button', { name: '08:00 Uhr' }).click();
            await p.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Familie Parallel');
            await p.getByLabel('E-Mail-Adresse', { exact: true }).fill('parallel@example.org');
            await p.getByRole('checkbox').check();
        }
        await first.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
        await first.getByRole('heading', { name: 'Ihr Termin ist gebucht' }).waitFor({ timeout: 20000 });
        await other.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
        await other.getByText('Dieser Termin wurde gerade vergeben').waitFor({ timeout: 20000 });
        const times = await other.locator('.times button').allTextContents();
        assert(!times.includes('08:00 Uhr'), `08:00 still offered: ${times}`);
        await first.context().close();
        await other.context().close();
    });

    await step('the first device resumes its booking after reload', async () => {
        await pub.goto(URLS.public);
        await pub.getByRole('heading', { name: 'Willkommen zurück' }).waitFor({ timeout: 20000 });
    });

    await step('secretariat sees the bookings', async () => {
        await page.reload();
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await page.getByLabel('Verfahren').selectOption(procedure.id);
        await page.getByText('Eva Testfamilie').waitFor({ timeout: 20000 });
        await page.getByText('Gebucht: 2').waitFor();
    });

    await step('no console errors or warnings', async () => {
        const all = [...problems, ...pubProblems.filter((p) => !p.includes('409'))];
        assert(all.length === 0, all.join(' | '));
    });
} finally {
    await browser.close();
    stopSecretariat();
    stopPublic();
    server.stop();
    const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
    for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
    if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
    const list = await appointments.listForProcedure(procedure.id).catch(() => []);
    if (list.length) await site.deleteItems('appointments', list.map((a) => a.id)).catch(() => {});
    await procedures.delete(procedure.id).catch(() => {});
    await forms.delete(form.id).catch(() => {});
    if (cleanup.logo) await site.deleteAsset('logo').catch(() => {});
    if (cleanup.schoolName) await config.delete('schoolName').catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
