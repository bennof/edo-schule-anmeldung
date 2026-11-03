// Registration with the school form: book -> fill in -> keep or not keep on
// the device -> resume -> submit -> PDF -> application in SharePoint ->
// secretariat opens it and downloads the same PDF.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import { AppointmentService, Repository } from '../../packages/sharepoint/src/index.ts';
import { launch, signIn, startApiServer, startDevServer, URLS, watchConsole, type ApiServer } from '../support/browser.ts';
import { day, env, testSite } from '../support/env.ts';

const site = testSite();
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const CATALOGS = ['laender.json', 'sprachen.json', 'staatsangehoerigkeiten.json'];
const tag = `E2E Anmeldung ${Date.now()}`;
const created = { form: '', procedure: '', catalogs: [] as string[], template: false };
let existingAssets = new Set<string>();
let server: ApiServer | undefined;
let stopSecretariat = () => {};
let stopPublic = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let admin: Page;
let pub: Page;
let adminProblems: string[] = [];
let pubProblems: string[] = [];
let appId = '';

const field = (p: Page, path: string) => p.locator(`[data-path="${path}"]`);
const text = (p: Page, path: string, value: string) => field(p, path).locator('input').first().fill(value);
const yesNo = (p: Page, path: string, yes: boolean) => field(p, path).getByLabel(yes ? 'Ja' : 'Nein', { exact: true }).check();
const choose = (p: Page, path: string, value: string) => field(p, path).locator('select').selectOption(value);
async function search(p: Page, path: string, query: string, option: string): Promise<void> {
    await field(p, path).locator('input').fill(query);
    await p.getByRole('option', { name: option, exact: true }).click();
}
const deviceKeys = (p: Page) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('anmeldung.')));
const keep = (p: Page) => p.getByRole('checkbox', { name: /Eingaben auf diesem Gerät speichern/ });

/** Downloads via a button and returns the PDF's text fields and checkboxes. */
async function downloadedPdf(p: Page, button: string): Promise<{ text: (n: string) => string | undefined; checked: (n: string) => boolean }> {
    const [download] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.getByRole('button', { name: button }).click()]);
    const pdf = await PDFDocument.load(fs.readFileSync(await download.path()));
    const form = pdf.getForm();
    return {
        text: (n) => (form.getField(n) as PDFTextField).getText(),
        checked: (n) => (form.getField(n) as PDFCheckBox).isChecked(),
    };
}

beforeAll(async () => {
    existingAssets = new Set((await site.listAssets()).map((a) => a.key));
    server = await startApiServer();
    stopSecretariat = await startDevServer('secretariat');
    stopPublic = await startDevServer('public');
    browser = await launch();
    admin = await browser.newPage();
    adminProblems = watchConsole(admin);
    admin.on('dialog', (d) => d.accept());
    pub = await (await browser.newContext()).newPage();
    pubProblems = watchConsole(pub);
    await admin.goto(URLS.secretariat);
    await signIn(admin, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
    await admin.getByText('Angemeldet als').waitFor({ timeout: 20000 });
});

afterAll(async () => {
    await browser?.close();
    stopSecretariat();
    stopPublic();
    server?.stop();
    if (created.procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${created.procedure}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        const list = await appointments.listForProcedure(created.procedure).catch(() => []);
        if (list.length) await site.deleteItems('appointments', list.map((a) => a.id)).catch(() => {});
        await procedures.delete(created.procedure).catch(() => {});
    }
    if (created.form) await forms.delete(created.form).catch(() => {});
    for (const key of created.catalogs) await site.deleteAsset(key).catch(() => {});
    if (created.template) await site.deleteAsset('anmeldebogen.pdf').catch(() => {});
});

it('secretariat imports the school form with its catalogs', async () => {
    await admin.getByRole('navigation').getByRole('link', { name: 'Formulare' }).click();
    await admin.getByRole('button', { name: 'Schulformular anlegen' }).click();
    const msg = (await admin.getByText(/Formular „Anmeldung Klasse 5.*angelegt \(ID \d+\)/).textContent({ timeout: 30000 }))!;
    created.form = /ID (\d+)/.exec(msg)![1];
    created.catalogs = CATALOGS.filter((c) => !existingAssets.has(c));
    created.template = !existingAssets.has('anmeldebogen.pdf');
    assert(!created.template || msg.includes('Anmeldebogen-Vorlage hochgeladen'), `template not uploaded: ${msg}`);
    assert(msg.includes('Kataloge aktualisiert: laender.json, sprachen.json, staatsangehoerigkeiten.json'), msg);
    const row = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: created.form, exact: true }) });
    assert(!(await row.getByText('Fehlende Kataloge').isVisible()), 'catalogs reported missing');
});

it('procedure with published appointments (via the adapter)', async () => {
    assert(created.form, 'no form');
    const procedure = await procedures.create({ formId: created.form, info: { title: tag }, startDate: day(-1), endDate: day(20) });
    created.procedure = procedure.id;
    const drafts = await appointments.createDrafts([
        { procedureId: procedure.id, datetime: `${day(4)}T10:00`, state: 'draft' },
        { procedureId: procedure.id, datetime: `${day(4)}T10:20`, state: 'draft' },
    ]);
    await appointments.publish(drafts.map((d) => d.id));
});

it('book and open the form', async () => {
    await pub.goto(URLS.public);
    const choice = pub.getByRole('button', { name: new RegExp(tag) });
    await Promise.race([choice.waitFor({ timeout: 15000 }), pub.getByRole('heading', { name: tag }).waitFor({ timeout: 15000 })]);
    if (await choice.isVisible()) await choice.click();
    await pub.getByRole('button', { name: '10:00 Uhr' }).click();
    await pub.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Eva Testkind');
    await pub.getByLabel('E-Mail-Adresse', { exact: true }).fill('eva.testkind@example.org');
    await pub.getByRole('checkbox').check();
    await pub.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
    await pub.getByRole('button', { name: 'Weiter zum Anmeldeformular' }).click();
    await pub.getByRole('heading', { name: '1. Personalien Schülerin / Schüler' }).waitFor({ timeout: 20000 });
    const [booked] = (await appointments.listForProcedure(created.procedure)).filter((a) => a.state === 'booked');
    assert((await applications.get(booked.applicationId!))?.state === 'form_in_progress', 'state not form_in_progress');
});

it('fill in the school form incl. catalogs, groups, copy and repeat', async () => {
    await text(pub, 'nachname', 'Testkind');
    await text(pub, 'vorname', 'Mia');
    await choose(pub, 'geschlecht', 'w');
    await text(pub, 'adresse.strasse', 'Am Weg 1');
    await text(pub, 'adresse.plz', '52222');
    await text(pub, 'adresse.ort', 'Stolberg');
    await text(pub, 'geburtsdatum', '2015-05-04');
    await text(pub, 'geburtsort', 'Aachen');
    await search(pub, 'geburtsland', 'Deutschl', 'Deutschland');
    assert(!(await field(pub, 'zuzugsdatum').isVisible()), 'zuzug visible for DE');
    await search(pub, 'herkunftssprache', 'Deutsch', 'Deutsch');
    await search(pub, 'staatsangehoerigkeit', 'Deutschl', 'Deutschland');
    await choose(pub, 'religion', 'rk');
    await choose(pub, 'religionsunterricht', 'kr');
    await text(pub, 'einschulungJahr', '2021');
    await text(pub, 'einschulungSchule.name', 'GGS Nord');
    await text(pub, 'einschulungSchule.ort', 'Stolberg');
    await yesNo(pub, 'wiederholung', false);
    await yesNo(pub, 'schulwechsel', true);
    await text(pub, 'weitereSchulen[0].schule.name', 'KGS Süd');
    await text(pub, 'weitereSchulen[0].schule.ort', 'Eschweiler');
    await text(pub, 'weitereSchulen[0].von', '2023');
    await yesNo(pub, 'foerderbedarf', false);
    await yesNo(pub, 'schwerbehinderung', false);
    await yesNo(pub, 'lrs', false);
    await yesNo(pub, 'autismus', false);
    await choose(pub, 'erziehungsberechtigter1.rolle', 'mutter');
    await text(pub, 'erziehungsberechtigter1.nachname', 'Testkind');
    await text(pub, 'erziehungsberechtigter1.vorname', 'Eva');
    await yesNo(pub, 'erziehungsberechtigter1.abweichendeAdresse', false);
    await text(pub, 'erziehungsberechtigter1.telefonMobil', '0170 1234567');
    await yesNo(pub, 'zweiterErziehungsberechtigter', true);
    await pub.getByRole('button', { name: /Angaben von „1\. Erziehungsberechtigte Person“ übernehmen/ }).click();
    await choose(pub, 'erziehungsberechtigter2.rolle', 'vater');
    await text(pub, 'erziehungsberechtigter2.vorname', 'Tom');
    await yesNo(pub, 'sorgerechtGemeinsam', true);
    await pub.getByRole('button', { name: 'Notfallkontakt hinzufügen' }).click();
    await text(pub, 'notfallkontakte[0].name', 'Oma Gerda');
    await text(pub, 'notfallkontakte[0].telefon', '02402 12345');
    await yesNo(pub, 'zustimmungBilder', true);
    await yesNo(pub, 'zustimmungUnterrichtsausfall', true);
    await yesNo(pub, 'zustimmungZecke', false);
    for (const k of ['kenntnisVeraenderungen', 'kenntnisKlassenfahrt', 'kenntnisKrankmeldung', 'kenntnisInfektionsschutz']) {
        await field(pub, k).getByRole('checkbox').check();
    }
});

it('default: nothing stored on the device, a new tab starts fresh', async () => {
    await pub.waitForTimeout(700);
    assert(!(await keep(pub).isChecked()), 'keep option ticked by default');
    assert((await deviceKeys(pub)).length === 0, 'data in localStorage without consent');
    const tab = await pub.context().newPage();
    await tab.goto(URLS.public);
    await tab.getByRole('heading', { name: /Termin wählen|Bitte wählen Sie das Anmeldeverfahren/ }).waitFor({ timeout: 15000 });
    assert(!(await tab.getByRole('heading', { name: 'Willkommen zurück' }).isVisible()), 'new tab resumed');
    await tab.close();
});

it('ticked: kept on the device, a new tab resumes; unticked: removed', async () => {
    await keep(pub).check();
    assert((await deviceKeys(pub)).sort().join() === 'anmeldung.draft.v1,anmeldung.session.v1', `keys ${await deviceKeys(pub)}`);
    const tab = await pub.context().newPage();
    await tab.goto(URLS.public);
    await tab.getByRole('heading', { name: 'Willkommen zurück' }).waitFor({ timeout: 20000 });
    assert(await keep(tab).isChecked(), 'option not remembered');
    await tab.close();
    await keep(pub).uncheck();
    assert((await deviceKeys(pub)).length === 0, 'device data not removed');
});

it('reload keeps the draft and resumes at the form', async () => {
    await pub.waitForTimeout(700); // draft is saved with a short debounce
    await pub.reload();
    await pub.getByRole('heading', { name: 'Willkommen zurück' }).waitFor({ timeout: 20000 });
    await pub.getByRole('button', { name: 'Anmeldeformular fortsetzen' }).click();
    await field(pub, 'nachname').waitFor({ timeout: 20000 });
    assert((await field(pub, 'nachname').locator('input').inputValue()) === 'Testkind', 'draft lost');
    assert((await field(pub, 'erziehungsberechtigter2.nachname').locator('input').inputValue()) === 'Testkind', 'copy lost');
    await field(pub, 'geburtsland').getByText('Deutschland').waitFor({ timeout: 10000 });
});

it('missing acknowledgement blocks submission', async () => {
    await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
    await pub.getByText('Bitte prüfen Sie die markierten Angaben (1).').waitFor();
    assert(await field(pub, 'kenntnisDatenschutz').getByText('Pflichtfeld').isVisible(), 'error not at field');
});

it('submit -> thank you, local data removed', async () => {
    await field(pub, 'kenntnisDatenschutz').getByRole('checkbox').check();
    await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
    await pub.getByRole('heading', { name: /Vielen Dank/ }).waitFor({ timeout: 20000 });
    const stored = await pub.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('anmeldung.')));
    assert(stored.length === 0, `left in storage: ${stored}`);
});

it('family downloads the filled registration form PDF', async () => {
    const pdf = await downloadedPdf(pub, 'Anmeldebogen als PDF herunterladen');
    assert(pdf.text('nachname') === 'Testkind' && pdf.text('vorname') === 'Mia', 'names');
    assert(pdf.text('geburtsland') === 'Deutschland' && pdf.text('geburtsdatum') === '04.05.2015', 'display values');
    assert(pdf.text('erziehungsberechtigter2.vorname') === 'Tom' && pdf.text('weitereSchulen[0].schule.name') === 'KGS Süd', 'groups');
    assert(pdf.checked('geschlecht=w') && pdf.checked('zustimmungZecke=false') && pdf.checked('kenntnisDatenschutz=true'), 'checkboxes');
    assert(pdf.text('anmeldung.termin')?.includes('10:00 Uhr'), `termin ${pdf.text('anmeldung.termin')}`);
});

it('application is submitted in SharePoint with clean data', async () => {
    const [booked] = (await appointments.listForProcedure(created.procedure)).filter((a) => a.state === 'booked');
    appId = booked.applicationId!;
    const app = (await applications.get(appId))!;
    const d = app.data as Record<string, any>;
    assert(app.state === 'submitted' && app.submittedAt && app.formId === created.form, `state ${app.state}`);
    assert(app.childName === 'Testkind, Mia' && app.contactName === 'Eva Testkind', `names ${app.childName}/${app.contactName}`);
    assert(d.nachname === 'Testkind' && d.geburtsland === 'DE' && d.herkunftssprache === 'DE', 'basic values');
    assert(d.erziehungsberechtigter2.rolle === 'vater' && d.erziehungsberechtigter2.nachname === 'Testkind', 'copied group');
    assert(d.weitereSchulen.length === 1 && d.weitereSchulen[0].schule.name === 'KGS Süd', 'repeat group');
    assert(d.notfallkontakte[0].name === 'Oma Gerda', 'notfall');
    assert(d.kenntnisDatenschutz === true && d.zustimmungZecke === false, 'consents');
    assert(!('zuzugsdatum' in d) && !('foerderschwerpunkte' in d), 'hidden fields stored');
    assert(d.erziehungsberechtigter1.adresse === undefined, 'hidden nested group stored');
});

it('secretariat opens the submitted application with catalog labels', async () => {
    await admin.getByRole('navigation').getByRole('link', { name: 'Anmeldungen' }).click();
    const row = admin.locator(`tr[data-id="${appId}"]`);
    await row.getByText('Testkind, Mia').waitFor({ timeout: 20000 });
    await row.getByRole('button', { name: 'Öffnen' }).click();
    await admin.locator('dt', { hasText: 'Online abgeschickt' }).waitFor({ timeout: 20000 });
    await field(admin, 'staatsangehoerigkeit').getByText('Deutschland').waitFor({ timeout: 20000 });
    assert(await field(admin, 'foerderschwerpunkte').isVisible(), 'secretariat mode should show hidden fields');
});

it('secretariat downloads the same PDF incl. booking contact', async () => {
    const pdf = await downloadedPdf(admin, 'Anmeldebogen (PDF)');
    assert(pdf.text('nachname') === 'Testkind' && pdf.text('staatsangehoerigkeit') === 'Deutschland', 'values');
    assert(pdf.text('anmeldung.kontakt') === 'Eva Testkind, eva.testkind@example.org', `kontakt ${pdf.text('anmeldung.kontakt')}`);
    assert(pdf.text('anmeldung.nummer') === appId, 'nummer');
});

it('no console errors or warnings', async () => {
    const all = [...adminProblems, ...pubProblems];
    assert(all.length === 0, all.join(' | '));
});
