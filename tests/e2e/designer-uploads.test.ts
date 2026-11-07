// Form designer, form versions and uploads incl. the student photo.
import { createCanvas } from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import { AppointmentService, FormService, Repository } from '../../packages/sharepoint/src/index.ts';
import { launch, signIn, startApiServer, startDevServer, URLS, watchConsole, type ApiServer } from '../support/browser.ts';
import { day, env, testSite } from '../support/env.ts';

const site = testSite();
const formService = new FormService(site);
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const title = `E2E Designer ${Date.now()}`;
const created = { formKey: '', procedure: '' };
let tmp = '';
let server: ApiServer | undefined;
let stopSecretariat = () => {};
let stopPublic = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let admin: Page;
let pub: Page;
let problems: string[] = [];
let pubProblems: string[] = [];
let v1: FormDefinition;
let v2: FormDefinition;
let appId = '';

const nav = (label: string) => admin.getByRole('navigation').getByRole('link', { name: label }).click();
const canvas = () => admin.getByRole('region', { name: 'Formular-Arbeitsfläche' });
const props = () => admin.getByRole('complementary', { name: 'Einstellungen' });
// click the label area of a field on the work surface
const select = (path: string) => canvas().locator(`[data-path="${path}"]`).first().click({ position: { x: 4, y: 4 } });
const addField = () => canvas().getByRole('button', { name: '+ Feld' }).first().click();

async function bookAndOpen(p: Page, time: string): Promise<void> {
    await p.goto(URLS.public);
    const choice = p.getByRole('button', { name: new RegExp(title) });
    await Promise.race([choice.waitFor({ timeout: 15000 }), p.getByRole('heading', { name: title }).waitFor({ timeout: 15000 })]);
    if (await choice.isVisible()) await choice.click();
    await p.getByRole('button', { name: `${time} Uhr` }).click();
    await p.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Familie Upload');
    await p.getByLabel('E-Mail-Adresse', { exact: true }).fill('upload@example.org');
    await p.getByRole('checkbox').check();
    await p.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
    await p.getByRole('button', { name: 'Weiter zum Anmeldeformular' }).click();
    await p.locator('[data-path="nachname"]').waitFor({ timeout: 20000 });
}

beforeAll(async () => {
    // a large "camera" photo (1600x2000) and a small PDF
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anmeldung-designer-'));
    const canvas = createCanvas(1600, 2000);
    const g = canvas.getContext('2d');
    g.fillStyle = '#9ec5fe';
    g.fillRect(0, 0, 1600, 2000);
    g.fillStyle = '#f2d2b6';
    g.beginPath();
    g.arc(800, 750, 350, 0, Math.PI * 2);
    g.fill();
    fs.writeFileSync(`${tmp}/kamera.png`, canvas.toBuffer('image/png'));
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([200, 200]);
    fs.writeFileSync(`${tmp}/zeugnis.pdf`, await pdfDoc.save());

    server = await startApiServer();
    stopSecretariat = await startDevServer('secretariat');
    stopPublic = await startDevServer('public');
    browser = await launch();
    admin = await (await browser.newContext()).newPage();
    problems = watchConsole(admin);
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
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (created.procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${created.procedure}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        const list = await appointments.listForProcedure(created.procedure).catch(() => []);
        if (list.length) await site.deleteItems('appointments', list.map((a) => a.id)).catch(() => {});
        await procedures.delete(created.procedure).catch(() => {});
    }
    const versions = (await formService.listVersions().catch(() => [])).filter(
        (v) => v.formKey === created.formKey || (v.formJson as { title?: string })?.title?.startsWith(title),
    );
    for (const v of versions) await formService.repo.delete(v.id).catch(() => {});
});

it('build a new form in the designer', async () => {
    await nav('Formulare');
    await admin.getByRole('button', { name: 'Neues Formular' }).click();
    await props().getByLabel('Titel').fill(title);

    // field 1: required child name
    await select('feld1');
    await props().getByLabel('ID (Datenname)').fill('nachname');
    await props().getByLabel('Beschriftung').fill('Name des Kindes');
    await props().getByLabel('Pflichtfeld').check();

    // field 2: Ja/Nein
    await addField();
    await props().getByLabel('ID (Datenname)').fill('geschwister');
    await props().getByLabel('Beschriftung').fill('Geschwister an der Schule?');
    await props().getByLabel('Feldtyp').selectOption('boolean');

    // field 3: visible only if field 2 is Ja
    await addField();
    await props().getByLabel('ID (Datenname)').fill('geschwisterName');
    await props().getByLabel('Beschriftung').fill('Name der Geschwister');
    await props().getByLabel('Sichtbar, wenn: Feld').fill('geschwister');
    await props().getByLabel('Sichtbar, wenn: Feld').blur();
    await props().getByLabel('Sichtbar, wenn: Wert').fill('true');
    await props().getByLabel('Sichtbar, wenn: Wert').blur();

    // field 4: selection with options
    await addField();
    await props().getByLabel('ID (Datenname)').fill('klasse');
    await props().getByLabel('Beschriftung').fill('Gewünschte Klasse');
    await props().getByLabel('Feldtyp').selectOption('select');
    await props().getByLabel('Anzeigetext 1').fill('5a');
    await props().getByRole('button', { name: 'Option hinzufügen' }).click();
    await props().getByLabel('Schlüssel 2').fill('5b');
    await props().getByLabel('Anzeigetext 2').fill('5b');

    // field 5: photo, field 6: documents
    await addField();
    await props().getByLabel('ID (Datenname)').fill('passfoto');
    await props().getByLabel('Beschriftung').fill('Passfoto');
    await props().getByLabel('Feldtyp').selectOption('file');
    await props().getByLabel(/Passfoto des Kindes/).check();
    await addField();
    await props().getByLabel('ID (Datenname)').fill('unterlagen');
    await props().getByLabel('Beschriftung').fill('Unterlagen');
    await props().getByLabel('Feldtyp').selectOption('file');
    await props().getByLabel('Mehrere Dateien').check();

    // a reusable, repeatable group
    await canvas().getByRole('button', { name: title }).click(); // form settings
    await props().getByRole('button', { name: '+ Gruppe definieren' }).click();
    await props().getByLabel('Name').fill('kontakt');
    await props().getByLabel('Name').blur();
    await canvas().getByRole('button', { name: '+ Gruppe' }).first().click();
    await props().getByLabel('ID (Datenname)').fill('notfall');
    await props().getByLabel('Beschriftung').fill('Notfallkontakte');
    await props().getByLabel(/Wiederholbar/).check();
    await admin.waitForTimeout(300);
    const shown = await admin.locator('.problems li').allTextContents();
    assert(shown.length === 0, `problems: ${shown.join(' | ')}`);
});

it('work surface shows the condition and selects what is clicked', async () => {
    const conditional = canvas().locator('[data-path="geschwisterName"]');
    await conditional.getByText('Im Online-Formular ausgeblendet').waitFor();
    await canvas().locator('[data-path="geschwister"]').getByLabel('Ja', { exact: true }).check();
    await conditional.getByText('Im Online-Formular ausgeblendet').waitFor({ state: 'detached' });
    await select('klasse');
    assert((await props().getByLabel('Beschriftung').inputValue()) === 'Gewünschte Klasse', 'selection');
    // fields inside a group edit the shared definition
    await canvas().locator('[data-path="notfall"] .design-item').first().click({ position: { x: 4, y: 4 } });
    await props().getByText(/Teil der Gruppe „kontakt“/).waitFor();
});

it('invalid definitions block saving', async () => {
    await select('geschwisterName');
    await props().getByLabel('ID (Datenname)').fill('nachname'); // duplicate id
    await admin.getByText(/Problem\(e\)/).waitFor();
    assert(await admin.getByRole('button', { name: 'Speichern', exact: true }).isDisabled(), 'save enabled');
    await props().getByLabel('ID (Datenname)').fill('geschwisterName');
    await admin.getByRole('button', { name: 'Speichern', exact: true }).waitFor({ state: 'visible' });
});

it('save as version 1', async () => {
    await admin.getByRole('button', { name: 'Speichern', exact: true }).click();
    await admin.getByText(/Neue Version gespeichert/).waitFor({ timeout: 20000 });
    const family = (await formService.families()).find((f) => f.title === title)!;
    created.formKey = family.formKey;
    assert(family.versions.length === 1 && family.versions[0].version === '1', 'version 1');
});

it('editing saves version 2, version 1 stays unchanged', async () => {
    const row = admin.locator(`[data-form-key="${created.formKey}"]`);
    await row.getByRole('button', { name: 'Bearbeiten → neue Version' }).click();
    await select('nachname');
    await props().getByLabel('Beschriftung').fill('Nachname des Kindes');
    assert((await admin.getByLabel('Version', { exact: true }).inputValue()) === '2', 'next version not suggested');
    await admin.getByLabel('Version', { exact: true }).fill('Entwurf 2');
    await admin.getByRole('button', { name: 'Speichern', exact: true }).click();
    await admin.getByText(/Neue Version gespeichert/).waitFor({ timeout: 20000 });
    const [family] = (await formService.families()).filter((f) => f.formKey === created.formKey);
    assert(family.versions.map((v) => v.version).join() === 'Entwurf 2,1', 'versions');
    const first = family.versions[1].formJson as { sections: { items: { label: string }[] }[] };
    assert(first.sections[0].items[0].label === 'Name des Kindes', 'version 1 changed');
});

it('procedure with version 1 and published appointments (via the adapter)', async () => {
    [v2, v1] = (await formService.families()).find((f) => f.formKey === created.formKey)!.versions;
    const procedure = await procedures.create({ formId: v1.id, info: { title }, startDate: day(-1), endDate: day(20) });
    created.procedure = procedure.id;
    const slots = await appointments.createDrafts([
        { procedureId: procedure.id, datetime: `${day(5)}T13:00`, state: 'draft' },
        { procedureId: procedure.id, datetime: `${day(5)}T13:20`, state: 'draft' },
    ]);
    await appointments.publish(slots.map((s) => s.id));
});

it('family uploads a photo (scaled) and a PDF, then submits', async () => {
    await bookAndOpen(pub, '13:00');
    await pub.locator('[data-path="nachname"] input').fill('Uploadkind');
    await pub.locator('[data-path="passfoto"] input[type=file]').setInputFiles(`${tmp}/kamera.png`);
    await pub.locator('[data-path="passfoto"]').getByAltText('Passfoto').waitFor({ timeout: 30000 });
    await pub.locator('[data-path="unterlagen"] input[type=file]').setInputFiles(`${tmp}/zeugnis.pdf`);
    await pub.locator('[data-path="unterlagen"]').getByText('zeugnis.pdf').waitFor({ timeout: 30000 });
    await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
    await pub.getByRole('heading', { name: /Vielen Dank/ }).waitFor({ timeout: 20000 });

    const [booked] = (await appointments.listForProcedure(created.procedure)).filter((a) => a.state === 'booked');
    appId = booked.applicationId!;
    const app = (await applications.get(appId))!;
    const d = app.data as Record<string, any>;
    assert(app.formId === v1.id, `application uses version ${app.formId}, expected ${v1.id}`);
    assert(d.passfoto?.contentType === 'image/jpeg' && d.passfoto.name === 'kamera.jpg', `photo ref ${JSON.stringify(d.passfoto)}`);
    assert(d.passfoto.size < 200_000, `photo not scaled: ${d.passfoto.size} bytes`);
    assert(d.unterlagen?.[0]?.contentType === 'application/pdf', 'document ref');
    const files = (await site.listUploads(appId)).map((f) => f.key).sort();
    assert(JSON.stringify(files) === JSON.stringify([d.passfoto.id, d.unterlagen[0].id].sort()), `stored files ${files}`);
});

it('new bookings use the new version once the procedure is switched', async () => {
    await procedures.update(created.procedure, { formId: v2.id });
    const other = await (await browser!.newContext()).newPage();
    await bookAndOpen(other, '13:20');
    assert(await other.locator('[data-path="nachname"]').getByText('Nachname des Kindes').isVisible(), 'new label');
    await other.context().close();
});

it('secretariat: old application opens with version 1, photo shown', async () => {
    await nav('Anmeldungen');
    await admin.locator(`tr[data-id="${appId}"]`).getByRole('button', { name: 'Öffnen' }).click();
    await admin.locator('[data-path="nachname"] label').getByText(/^Name des Kindes/).waitFor({ timeout: 20000 });
    const photo = admin.getByTestId('photo');
    await photo.waitFor({ timeout: 20000 });
    const [w, h] = await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    assert(w <= 600 && h <= 800 && w > 0, `photo size ${w}x${h}`);
});

it('secretariat adds and removes a document (autosaved reference)', async () => {
    await admin.locator('[data-path="unterlagen"] input[type=file]').setInputFiles(`${tmp}/zeugnis.pdf`);
    await admin.locator('[data-path="unterlagen"] [data-file]').nth(1).waitFor({ timeout: 30000 });
    await admin.getByTestId('save-status').getByText(/Gespeichert \d/).waitFor({ timeout: 20000 });
    let d = (await applications.get(appId))!.data as Record<string, any>;
    assert(d.unterlagen.length === 2, `refs ${d.unterlagen.length}`);
    await admin.locator('[data-path="unterlagen"] [data-file]').nth(1).getByRole('button', { name: 'Entfernen' }).click();
    await admin.getByTestId('save-status').getByText(/Gespeichert \d/).waitFor({ timeout: 20000 });
    await admin.waitForTimeout(2500);
    d = (await applications.get(appId))!.data as Record<string, any>;
    assert(d.unterlagen.length === 1, `after remove ${d.unterlagen.length}`);
    assert((await site.listUploads(appId)).length === 2, 'removed file still stored');
});

it('no console errors or warnings', async () => {
    const all = [...problems, ...pubProblems];
    assert(all.length === 0, all.join(' | ').slice(0, 1500));
});
