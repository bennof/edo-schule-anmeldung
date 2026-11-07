// Transfer of a released application from the secretariat to the SVWS server
// from .env via the development proxy, including the photo; checks SVWS and
// SharePoint and removes everything again.
import { createCanvas } from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import schoolForm from '../../packages/forms/examples/anmeldung-klasse5.json' with { type: 'json' };
import { FormService, Repository } from '../../packages/sharepoint/src/index.ts';
import { SvwsClient, createTransport } from '../../packages/svws/src/index.ts';
import { launch, signIn, startDevServer, URLS, watchConsole } from '../support/browser.ts';
import { day, env, svws, testSite } from '../support/env.ts';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // SVWS uses a self-signed certificate

const site = testSite();
const formService = new FormService(site);
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const svwsApi = new SvwsClient(createTransport({ url: svws.url, transport: 'direct' }), svws.schema, { user: svws.user, password: svws.password });

const CATALOGS = ['laender.json', 'sprachen.json', 'staatsangehoerigkeiten.json'];
const stamp = Date.now().toString(36);
const createdSvws: string[] = [];
let addedCatalogs: string[] = [];
let form: FormDefinition | undefined;
let procedure: Procedure | undefined;
let app: Application | undefined;
let data: Record<string, unknown> = {};
let stop = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];
const nav = (label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();

beforeAll(async () => {
    // school form with its catalogs, procedure, released application with photo
    const existing = new Set((await site.listAssets()).map((a) => a.key));
    addedCatalogs = CATALOGS.filter((c) => !existing.has(c));
    for (const c of addedCatalogs) {
        await site.putAsset(c, new Blob([fs.readFileSync(`packages/forms/catalogs/${c}`)], { type: 'application/json' }));
    }
    form = await formService.saveVersion(schoolForm);
    procedure = await procedures.create({ formId: form.id, info: { title: `E2E SVWS ${stamp}` }, startDate: day(-1), endDate: day(20) });
    app = await applications.create({
        procedureId: procedure.id,
        formId: form.id,
        state: 'ready_for_svws',
        data: {},
        childName: `Übertrag-${stamp}, Lina`,
        contactName: 'Familie Übertrag',
    });
    const canvas = createCanvas(600, 800);
    const g = canvas.getContext('2d');
    g.fillStyle = '#2456a6';
    g.fillRect(0, 0, 600, 800);
    const photoId = `${app.id}/${'ab'.repeat(16)}.jpg`;
    const photo = canvas.toBuffer('image/jpeg');
    await site.putUpload(photoId, new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }));
    data = {
        nachname: `Übertrag-${stamp}`,
        vorname: 'Lina',
        geschlecht: 'w',
        geburtsdatum: '2015-02-03',
        geburtsort: 'Wuppertal',
        geburtsland: 'DE',
        staatsangehoerigkeit: 'DE',
        herkunftssprache: 'DE',
        religion: 'ev',
        religionsunterricht: 'er',
        adresse: { strasse: 'Viehofstraße 7', plz: '42103', ort: 'Wuppertal' },
        erziehungsberechtigter1: { rolle: 'mutter', nachname: `Übertrag-${stamp}`, vorname: 'Anna', abweichendeAdresse: false, telefonMobil: '0170 7654321' },
        zweiterErziehungsberechtigter: false,
        passfoto: { id: photoId, name: 'foto.jpg', contentType: 'image/jpeg', size: photo.length },
    };
    await applications.update(app.id, { data, submittedAt: new Date().toISOString() });

    stop = await startDevServer('secretariat');
    browser = await launch();
    page = await (await browser.newContext()).newPage();
    problems = watchConsole(page);
    await page.goto(URLS.secretariat);
    await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
    await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
});

afterAll(async () => {
    await browser?.close();
    stop();
    if (createdSvws.length) await svwsApi.call('DELETE', '/schueler/delete/multiple', createdSvws.map(Number)).catch(() => {});
    if (app) {
        await site.deleteUploads(app.id).catch(() => {});
        await applications.delete(app.id).catch(() => {});
    }
    if (procedure) await procedures.delete(procedure.id).catch(() => {});
    if (form) await formService.repo.delete(form.id).catch(() => {});
    for (const c of addedCatalogs) await site.deleteAsset(c).catch(() => {});
});

it('configure the SVWS endpoint (proxy, schema) in this browser', async () => {
    await nav('Einstellungen');
    await page.getByLabel('SVWS-Adresse').fill(svws.url);
    await page.getByLabel('Verbindung').selectOption('proxy');
    await page.getByLabel('Proxy-Adresse').fill(`${URLS.secretariat}/svws-proxy`);
    await page.getByLabel('Datenbank-Schema der Schule').fill(svws.schema);
    // saving reloads the app shortly afterwards
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.getByRole('button', { name: 'Speichern', exact: true }).click()]);
    await page.getByText('Angemeldet als').waitFor({ timeout: 30000 });
});

it('settings: SVWS connection check through the proxy', async () => {
    await nav('Einstellungen');
    await page.getByLabel('SVWS-Benutzer').fill(svws.user);
    if (svws.password) await page.getByLabel('Passwort').fill(svws.password);
    await page.getByRole('button', { name: 'SVWS prüfen' }).click();
    await page.getByTestId('check-svws').getByText(/SVWS \d+\.\d+.*Albert Zweistein Gymnasium/).waitFor({ timeout: 20000 });
});

it('"Aus SVWS": a school table becomes an option list file', async () => {
    const file = `test-religionen-${stamp}.json`;
    await nav('Aus SVWS');
    await page.getByLabel('Tabelle der Schule').check();
    await page.getByRole('combobox', { name: /^Tabelle/ }).selectOption('religionen');
    await page.getByTestId('svws-sample').waitFor({ timeout: 20000 });
    assert((await page.getByLabel('Schlüssel (key)').inputValue()) === 'kuerzel', 'key column not suggested');
    await page.getByLabel('Dateiname').fill(file);
    await page.getByRole('button', { name: 'Lesen und speichern' }).click();
    addedCatalogs.push(file);
    await page.getByText(new RegExp(`„${file}“ mit \\d+ Einträgen`)).waitFor({ timeout: 20000 });
    const saved = JSON.parse(await (await site.getAsset(file))!.text()) as { key: string; value: string }[];
    const religionen = await svwsApi.get<{ kuerzel: string; bezeichnung: string; istSichtbar: boolean }[]>('/schule/religionen');
    assert.deepEqual(saved.map((o) => o.key).sort(), religionen.filter((r) => r.istSichtbar).map((r) => r.kuerzel).sort());
});

it('"Aus SVWS": nationalities with ISO codes, expired ones left out', async () => {
    const file = `test-laender-${stamp}.json`;
    await page.getByLabel('Nationalitäten').check();
    await page.getByTestId('svws-sample').waitFor({ timeout: 20000 });
    await page.getByLabel('Dateiname').fill(file);
    await page.getByRole('button', { name: 'Lesen und speichern' }).click();
    addedCatalogs.push(file);
    await page.getByText(new RegExp(`„${file}“ mit \\d+ Einträgen`)).waitFor({ timeout: 20000 });
    const saved = JSON.parse(await (await site.getAsset(file))!.text()) as { key: string; value: string }[];
    assert(saved.some((o) => o.key === 'DE' && o.value === 'Deutschland'), 'DE missing');
    assert(saved.some((o) => o.key === 'XA' && o.value === 'staatenlos'), 'stateless missing');
    assert(!saved.some((o) => o.key === 'DD'), 'expired entry kept');
});

const openTransferDialog = async () => {
    await nav('Anmeldungen');
    await page.locator(`tr[data-id="${app!.id}"]`).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Ausgewählte an SVWS übertragen …' }).click();
    const dialog = page.getByTestId('svws-dialog');
    await dialog.getByText(`Schema ${svws.schema} (proxy)`).waitFor();
    return dialog;
};

it('user name is remembered, the password stays in memory only', async () => {
    const marker = 'nur-im-speicher';
    await nav('Einstellungen');
    await page.getByLabel('Passwort').fill(marker);
    let dialog = await openTransferDialog();
    assert((await dialog.getByLabel('SVWS-Benutzer').inputValue()) === svws.user, 'user name not shared');
    assert((await dialog.getByLabel('Passwort').inputValue()) === marker, 'password not shared within the session');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert(!stored.includes(marker), 'password written to browser storage');

    await page.reload();
    await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
    dialog = await openTransferDialog();
    assert((await dialog.getByLabel('SVWS-Benutzer').inputValue()) === svws.user, 'user name not remembered');
    assert((await dialog.getByLabel('Passwort').inputValue()) === '', 'password survived the reload');
});

it('connection check through the proxy', async () => {
    const dialog = page.getByTestId('svws-dialog');
    if (svws.password) await dialog.getByLabel('Passwort').fill(svws.password);
    await dialog.getByRole('button', { name: 'Verbindung prüfen' }).click();
    await dialog.getByText(/SVWS \d+\.\d+.*Albert Zweistein Gymnasium/).waitFor({ timeout: 20000 });
});

it('transfer: student incl. photo in SVWS, application imported', async () => {
    const dialog = page.getByTestId('svws-dialog');
    await dialog.getByRole('button', { name: '1 Anmeldung(en) übertragen' }).click();
    const result = await dialog.getByText(/Übertragen als Schüler-ID \d+/).textContent({ timeout: 60000 });
    const svwsId = /Schüler-ID (\d+)/.exec(result ?? '')![1];
    createdSvws.push(svwsId);
    const stored = (await applications.get(app!.id))!;
    assert(stored.state === 'imported' && stored.svwsId === svwsId, `application ${stored.state} ${stored.svwsId}`);
    const s = await svwsApi.get<Record<string, any>>(`/schueler/${svwsId}/stammdaten`);
    assert(s.nachname === data.nachname && s.vorname === 'Lina' && s.wohnortID === 203 && s.hausnummer === '7', `stammdaten ${s.nachname} ${s.wohnortID}`);
    assert(typeof s.foto === 'string' && Buffer.from(s.foto, 'base64').length > 1000, 'photo missing');
    const erzieher = await svwsApi.get<Record<string, any>[]>(`/schueler/${svwsId}/erzieher`);
    assert(erzieher.length === 1 && erzieher[0].vorname === 'Anna', `erzieher ${erzieher.length}`);
});

it('imported application leaves the transfer selection, shows the SVWS id', async () => {
    await page.getByRole('button', { name: /^In SVWS übernommen \(\d+\)$/ }).click();
    const row = page.locator(`tr[data-id="${app!.id}"]`);
    await row.waitFor({ timeout: 20000 });
    assert((await row.getByRole('checkbox').count()) === 0, 'imported application still selectable');
    await row.getByRole('button', { name: 'Öffnen' }).click();
    await page.getByText(`Schüler-ID ${createdSvws[0]}`).waitFor({ timeout: 20000 });
});

it('no console errors or warnings', async () => {
    assert(problems.length === 0, problems.join(' | '));
});
