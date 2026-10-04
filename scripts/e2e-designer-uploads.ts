// Sprint 7 browser test: form designer (D2), form versions (D3) and uploads
// incl. the student photo. Creates its own data and removes it afterwards.
// Usage: node scripts/e2e-designer-uploads.ts
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import type { Page } from 'playwright-core';
import type { Application, Procedure } from '../packages/domain/src/index.ts';
import { AppointmentService, FormService, GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startApiServer, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const formService = new FormService(site);
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');
const title = `E2E Designer ${Date.now()}`;
const created = { formKey: '', procedure: '' };
const tmp = fs.mkdtempSync('/tmp/claude-e2e-designer-');

// a large "camera" photo (1600x2000) and a small PDF
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

const server = await startApiServer();
const stopSecretariat = await startDevServer('secretariat');
const stopPublic = await startDevServer('public');
const browser = await launch();

try {
    const admin = await (await browser.newContext()).newPage();
    const problems = watchConsole(admin);
    admin.on('dialog', (d) => d.accept());
    const nav = (label: string) => admin.getByRole('navigation').getByRole('link', { name: label }).click();
    const tree = admin.getByRole('navigation', { name: 'Formularstruktur' });
    const props = admin.locator('.props');
    const previewPane = admin.getByLabel('Vorschau', { exact: true });
    const selectNode = (text: string | RegExp) => tree.getByRole('button', { name: text }).first().click();

    await step('build a new form in the designer (D2)', async () => {
        await admin.goto(URLS.secretariat);
        await signIn(admin, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await admin.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await nav('Formulare');
        await admin.getByRole('button', { name: 'Neues Formular' }).click();
        await props.getByLabel('Titel').fill(title);

        // field 1: required child name
        await selectNode(/Neues Feld/);
        await props.getByLabel('ID (Datenname)').fill('nachname');
        await props.getByLabel('Beschriftung').fill('Name des Kindes');
        await props.getByLabel('Pflichtfeld').check();

        // field 2: Ja/Nein
        await tree.getByRole('button', { name: '+ Feld' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('geschwister');
        await props.getByLabel('Beschriftung').fill('Geschwister an der Schule?');
        await props.getByLabel('Feldtyp').selectOption('boolean');

        // field 3: visible only if field 2 is Ja
        await tree.getByRole('button', { name: '+ Feld' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('geschwisterName');
        await props.getByLabel('Beschriftung').fill('Name der Geschwister');
        await props.getByLabel('Sichtbar, wenn: Feld').fill('geschwister');
        await props.getByLabel('Sichtbar, wenn: Feld').blur();
        await props.getByLabel('Sichtbar, wenn: Wert').fill('true');
        await props.getByLabel('Sichtbar, wenn: Wert').blur();

        // field 4: selection with options
        await tree.getByRole('button', { name: '+ Feld' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('klasse');
        await props.getByLabel('Beschriftung').fill('Gewünschte Klasse');
        await props.getByLabel('Feldtyp').selectOption('select');
        await props.getByLabel('Anzeigetext 1').fill('5a');
        await props.getByRole('button', { name: 'Option hinzufügen' }).click();
        await props.getByLabel('Schlüssel 2').fill('5b');
        await props.getByLabel('Anzeigetext 2').fill('5b');

        // field 5: photo, field 6: documents
        await tree.getByRole('button', { name: '+ Feld' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('passfoto');
        await props.getByLabel('Beschriftung').fill('Passfoto');
        await props.getByLabel('Feldtyp').selectOption('file');
        await props.getByLabel(/Passfoto des Kindes/).check();
        await tree.getByRole('button', { name: '+ Feld' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('unterlagen');
        await props.getByLabel('Beschriftung').fill('Unterlagen');
        await props.getByLabel('Feldtyp').selectOption('file');
        await props.getByLabel('Mehrere Dateien').check();

        // a reusable, repeatable group
        await tree.getByRole('button', { name: '+ Gruppe definieren' }).click();
        await props.getByLabel('Name').fill('kontakt');
        await props.getByLabel('Name').blur();
        await tree.getByRole('button', { name: '+ Gruppe' }).first().click();
        await props.getByLabel('ID (Datenname)').fill('notfall');
        await props.getByLabel('Beschriftung').fill('Notfallkontakte');
        await props.getByLabel(/Wiederholbar/).check();
        await admin.waitForTimeout(300);
        const shown = await admin.locator('.problems li').allTextContents();
        assert(shown.length === 0, `problems: ${shown.join(' | ')}`);
    });

    await step('live preview reflects the condition', async () => {
        await previewPane.locator('[data-path="nachname"]').waitFor();
        assert(!(await previewPane.locator('[data-path="geschwisterName"]').isVisible()), 'conditional field visible');
        await previewPane.locator('[data-path="geschwister"]').getByLabel('Ja', { exact: true }).check();
        await previewPane.locator('[data-path="geschwisterName"]').waitFor();
    });

    await step('invalid definitions block saving', async () => {
        await selectNode(/Name der Geschwister/);
        await props.getByLabel('ID (Datenname)').fill('nachname'); // duplicate id
        await admin.getByText(/Problem\(e\)/).waitFor();
        assert(await admin.getByRole('button', { name: 'Als Version 1 speichern' }).isDisabled(), 'save enabled');
        await props.getByLabel('ID (Datenname)').fill('geschwisterName');
        await admin.getByRole('button', { name: 'Als Version 1 speichern' }).waitFor({ state: 'visible' });
    });

    await step('save as version 1', async () => {
        await admin.getByRole('button', { name: 'Als Version 1 speichern' }).click();
        await admin.getByText(/Neue Version gespeichert/).waitFor({ timeout: 20000 });
        const family = (await formService.families()).find((f) => f.title === title)!;
        created.formKey = family.formKey;
        assert(family.versions.length === 1 && family.versions[0].version === '1', 'version 1');
    });

    await step('editing saves version 2, version 1 stays unchanged (D3)', async () => {
        const row = admin.locator(`[data-form-key="${created.formKey}"]`);
        await row.getByRole('button', { name: 'Bearbeiten → Version 2' }).click();
        await selectNode(/Name des Kindes/);
        await props.getByLabel('Beschriftung').fill('Nachname des Kindes');
        await admin.getByRole('button', { name: 'Als Version 2 speichern' }).click();
        await admin.getByText(/Neue Version gespeichert/).waitFor({ timeout: 20000 });
        const [family] = (await formService.families()).filter((f) => f.formKey === created.formKey);
        assert(family.versions.map((v) => v.version).join() === '2,1', 'versions');
        const v1 = family.versions[1].formJson as { sections: { items: { label: string }[] }[] };
        assert(v1.sections[0].items[0].label === 'Name des Kindes', 'version 1 changed');
    });

    const [v2, v1] = (await formService.families()).find((f) => f.formKey === created.formKey)!.versions;
    const procedure = await procedures.create({ formId: v1.id, info: { title }, startDate: day(-1), endDate: day(20) });
    created.procedure = procedure.id;
    const slots = await appointments.createDrafts([
        { procedureId: procedure.id, datetime: `${day(5)}T13:00`, state: 'draft' },
        { procedureId: procedure.id, datetime: `${day(5)}T13:20`, state: 'draft' },
    ]);
    await appointments.publish(slots.map((s) => s.id));

    const pub = await (await browser.newContext()).newPage();
    const pubProblems = watchConsole(pub);
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

    let appId = '';
    await step('family uploads a photo (scaled) and a PDF, then submits', async () => {
        await bookAndOpen(pub, '13:00');
        await pub.locator('[data-path="nachname"] input').fill('Uploadkind');
        await pub.locator('[data-path="passfoto"] input[type=file]').setInputFiles(`${tmp}/kamera.png`);
        await pub.locator('[data-path="passfoto"]').getByAltText('Passfoto').waitFor({ timeout: 30000 });
        await pub.locator('[data-path="unterlagen"] input[type=file]').setInputFiles(`${tmp}/zeugnis.pdf`);
        await pub.locator('[data-path="unterlagen"]').getByText('zeugnis.pdf').waitFor({ timeout: 30000 });
        await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
        await pub.getByRole('heading', { name: /Vielen Dank/ }).waitFor({ timeout: 20000 });

        const [booked] = (await appointments.listForProcedure(procedure.id)).filter((a) => a.state === 'booked');
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

    await step('new bookings use the new version once the procedure is switched (D3)', async () => {
        await procedures.update(procedure.id, { formId: v2.id });
        const other = await (await browser.newContext()).newPage();
        await bookAndOpen(other, '13:20');
        assert(await other.locator('[data-path="nachname"]').getByText('Nachname des Kindes').isVisible(), 'new label');
        await other.context().close();
    });

    await step('secretariat: old application opens with version 1, photo shown (D3, uploads)', async () => {
        await nav('Anmeldungen');
        await admin.locator(`tr[data-id="${appId}"]`).getByRole('button', { name: 'Öffnen' }).click();
        await admin.locator('[data-path="nachname"] label').getByText(/^Name des Kindes/).waitFor({ timeout: 20000 });
        const photo = admin.getByTestId('photo');
        await photo.waitFor({ timeout: 20000 });
        const [w, h] = await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
        assert(w <= 600 && h <= 800 && w > 0, `photo size ${w}x${h}`);
    });

    await step('secretariat adds and removes a document (autosaved reference)', async () => {
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

    await step('no console errors or warnings', async () => {
        const all = [...problems, ...pubProblems];
        assert(all.length === 0, all.join(' | ').slice(0, 1500));
    });
} finally {
    await browser.close();
    stopSecretariat();
    stopPublic();
    server.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (created.procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${created.procedure}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        const list = await appointments.listForProcedure(created.procedure).catch(() => []);
        if (list.length) await site.deleteItems('appointments', list.map((a) => a.id)).catch(() => {});
        await procedures.delete(created.procedure).catch(() => {});
    }
    const versions = (await formService.listVersions().catch(() => [])).filter((v) => v.formKey === created.formKey || (v.formJson as { title?: string })?.title?.startsWith(title));
    for (const v of versions) await formService.repo.delete(v.id).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
