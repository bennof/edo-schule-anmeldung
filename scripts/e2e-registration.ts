// Sprint 4 end-to-end test: book -> fill in the school's registration form ->
// reload and resume -> submit -> application in SharePoint -> secretariat.
// Usage: node scripts/e2e-registration.ts
import { execSync, spawn } from 'node:child_process';
import type { Page } from 'playwright-core';
import type { Application, FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import { AppointmentService, GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const CATALOGS = ['laender.json', 'sprachen.json', 'staatsangehoerigkeiten.json'];
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const tag = `E2E Anmeldung ${Date.now()}`;
const created = { form: '', procedure: '', catalogs: [] as string[] };
const existingAssets = new Set((await site.listAssets()).map((a) => a.key));

execSync('cargo build -q', { cwd: 'server', stdio: 'inherit', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
const server = spawn('./target/debug/anmeldung-server', { cwd: 'server', env: { ...process.env, BIND_ADDR: '127.0.0.1:8080' }, stdio: 'ignore' });
const stopSecretariat = await startDevServer('secretariat');
const stopPublic = await startDevServer('public');
const browser = await launch();

const field = (p: Page, path: string) => p.locator(`[data-path="${path}"]`);
const text = (p: Page, path: string, value: string) => field(p, path).locator('input').first().fill(value);
const yesNo = (p: Page, path: string, yes: boolean) => field(p, path).getByLabel(yes ? 'Ja' : 'Nein', { exact: true }).check();
const choose = (p: Page, path: string, value: string) => field(p, path).locator('select').selectOption(value);
async function search(p: Page, path: string, query: string, option: string): Promise<void> {
    await field(p, path).locator('input').fill(query);
    await p.getByRole('option', { name: option, exact: true }).click();
}

try {
    const admin = await browser.newPage();
    const adminProblems = watchConsole(admin);
    admin.on('dialog', (d) => d.accept());

    await step('secretariat imports the school form with its catalogs (C5)', async () => {
        await admin.goto(URLS.secretariat);
        await signIn(admin, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await admin.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await admin.getByRole('navigation').getByRole('link', { name: 'Formulare' }).click();
        await admin.getByRole('button', { name: 'Schulformular anlegen' }).click();
        const msg = (await admin.getByText(/Formular „Anmeldung Klasse 5.*angelegt \(ID \d+\)/).textContent({ timeout: 30000 }))!;
        created.form = /ID (\d+)/.exec(msg)![1];
        created.catalogs = CATALOGS.filter((c) => !existingAssets.has(c));
        assert(msg.includes('Kataloge aktualisiert: laender.json, sprachen.json, staatsangehoerigkeiten.json'), msg);
        const row = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: created.form, exact: true }) });
        assert(!(await row.getByText('Fehlende Kataloge').isVisible()), 'catalogs reported missing');
    });

    // procedure and published appointments via the adapter (covered by e2e-booking in the UI)
    const procedure = await procedures.create({ formId: created.form, info: { title: tag }, startDate: day(-1), endDate: day(20) });
    created.procedure = procedure.id;
    const drafts = await appointments.createDrafts([
        { procedureId: procedure.id, datetime: `${day(4)}T10:00`, state: 'draft' },
        { procedureId: procedure.id, datetime: `${day(4)}T10:20`, state: 'draft' },
    ]);
    await appointments.publish(drafts.map((d) => d.id));

    const pub = await (await browser.newContext()).newPage();
    const pubProblems = watchConsole(pub);
    const openProcedure = async () => {
        await pub.goto(URLS.public);
        const choice = pub.getByRole('button', { name: new RegExp(tag) });
        await Promise.race([choice.waitFor({ timeout: 15000 }), pub.getByRole('heading', { name: tag }).waitFor({ timeout: 15000 })]);
        if (await choice.isVisible()) await choice.click();
    };

    await step('book and open the form (G3, G4)', async () => {
        await openProcedure();
        await pub.getByRole('button', { name: '10:00 Uhr' }).click();
        await pub.getByLabel('Name (sorgeberechtigte Person)', { exact: true }).fill('Eva Testkind');
        await pub.getByLabel('E-Mail-Adresse', { exact: true }).fill('eva.testkind@example.org');
        await pub.getByRole('checkbox').check();
        await pub.getByRole('button', { name: 'Termin verbindlich buchen' }).click();
        await pub.getByRole('button', { name: 'Weiter zum Anmeldeformular' }).click();
        await pub.getByRole('heading', { name: '1. Personalien Schülerin / Schüler' }).waitFor({ timeout: 20000 });
        const [booked] = (await appointments.listForProcedure(procedure.id)).filter((a) => a.state === 'booked');
        assert((await applications.get(booked.applicationId!))?.state === 'form_in_progress', 'state not form_in_progress');
    });

    await step('fill in the school form incl. catalogs, groups, copy and repeat', async () => {
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

    const deviceKeys = (p: Page) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('anmeldung.')));
    const keep = (p: Page) => p.getByRole('checkbox', { name: /Eingaben auf diesem Gerät speichern/ });

    await step('default: nothing stored on the device, a new tab starts fresh', async () => {
        await pub.waitForTimeout(700);
        assert(!(await keep(pub).isChecked()), 'keep option ticked by default');
        assert((await deviceKeys(pub)).length === 0, 'data in localStorage without consent');
        const tab = await pub.context().newPage();
        await tab.goto(URLS.public);
        await tab.getByRole('heading', { name: /Termin wählen|Bitte wählen Sie das Anmeldeverfahren/ }).waitFor({ timeout: 15000 });
        assert(!(await tab.getByRole('heading', { name: 'Willkommen zurück' }).isVisible()), 'new tab resumed');
        await tab.close();
    });

    await step('ticked: kept on the device, a new tab resumes; unticked: removed', async () => {
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

    await step('reload keeps the draft and resumes at the form', async () => {
        await pub.waitForTimeout(700); // draft is saved with a short debounce
        await pub.reload();
        await pub.getByRole('heading', { name: 'Willkommen zurück' }).waitFor({ timeout: 20000 });
        await pub.getByRole('button', { name: 'Anmeldeformular fortsetzen' }).click();
        await field(pub, 'nachname').waitFor({ timeout: 20000 });
        assert((await field(pub, 'nachname').locator('input').inputValue()) === 'Testkind', 'draft lost');
        assert((await field(pub, 'erziehungsberechtigter2.nachname').locator('input').inputValue()) === 'Testkind', 'copy lost');
        await field(pub, 'geburtsland').getByText('Deutschland').waitFor({ timeout: 10000 });
    });

    await step('missing acknowledgement blocks submission (G5)', async () => {
        await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
        await pub.getByText('Bitte prüfen Sie die markierten Angaben (1).').waitFor();
        assert(await field(pub, 'kenntnisDatenschutz').getByText('Pflichtfeld').isVisible(), 'error not at field');
    });

    await step('submit -> thank you, local data removed', async () => {
        await field(pub, 'kenntnisDatenschutz').getByRole('checkbox').check();
        await pub.getByRole('button', { name: 'Anmeldung absenden' }).click();
        await pub.getByRole('heading', { name: /Vielen Dank/ }).waitFor({ timeout: 20000 });
        const stored = await pub.evaluate(() =>
            [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('anmeldung.')),
        );
        assert(stored.length === 0, `left in storage: ${stored}`);
    });

    let appId = '';
    await step('application is submitted in SharePoint with clean data (F6)', async () => {
        const [booked] = (await appointments.listForProcedure(procedure.id)).filter((a) => a.state === 'booked');
        appId = booked.applicationId!;
        const app = (await applications.get(appId))!;
        const d = app.data as Record<string, any>;
        assert(app.state === 'submitted' && app.submittedAt && app.formId === created.form, `state ${app.state}`);
        assert(d.nachname === 'Testkind' && d.geburtsland === 'DE' && d.herkunftssprache === 'DE', 'basic values');
        assert(d.erziehungsberechtigter2.rolle === 'vater' && d.erziehungsberechtigter2.nachname === 'Testkind', 'copied group');
        assert(d.weitereSchulen.length === 1 && d.weitereSchulen[0].schule.name === 'KGS Süd', 'repeat group');
        assert(d.notfallkontakte[0].name === 'Oma Gerda', 'notfall');
        assert(d.kenntnisDatenschutz === true && d.zustimmungZecke === false, 'consents');
        assert(!('zuzugsdatum' in d) && !('foerderschwerpunkte' in d), 'hidden fields stored');
        assert(d.erziehungsberechtigter1.adresse === undefined, 'hidden nested group stored');
    });

    await step('secretariat opens the submitted application with catalog labels', async () => {
        await admin.getByRole('navigation').getByRole('link', { name: 'Anmeldungen' }).click();
        const row = admin.getByRole('row').filter({ has: admin.getByRole('cell', { name: appId, exact: true }) });
        await row.getByText('Mia Testkind').waitFor({ timeout: 20000 });
        await row.getByRole('button', { name: 'Öffnen' }).click();
        await admin.getByText(/abgeschickt \d/).waitFor();
        await field(admin, 'staatsangehoerigkeit').getByText('Deutschland').waitFor({ timeout: 20000 });
        assert(await field(admin, 'foerderschwerpunkte').isVisible(), 'secretariat mode should show hidden fields');
    });

    await step('no console errors or warnings', async () => {
        const all = [...adminProblems, ...pubProblems];
        assert(all.length === 0, all.join(' | '));
    });
} finally {
    await browser.close();
    stopSecretariat();
    stopPublic();
    server.kill();
    if (created.procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${created.procedure}'`).catch(() => []);
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        const list = await appointments.listForProcedure(created.procedure).catch(() => []);
        if (list.length) await site.deleteItems('appointments', list.map((a) => a.id)).catch(() => {});
        await procedures.delete(created.procedure).catch(() => {});
    }
    if (created.form) await forms.delete(created.form).catch(() => {});
    for (const key of created.catalogs) await site.deleteAsset(key).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
