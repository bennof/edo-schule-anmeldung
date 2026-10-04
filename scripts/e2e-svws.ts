// Sprint 8 browser test: transfer a released application from the
// secretariat to the local SVWS test server (make svws-up) via the
// development proxy, including the photo; checks SVWS and SharePoint and
// removes everything again.
// Usage: node scripts/e2e-svws.ts
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import type { Application, Procedure } from '../packages/domain/src/index.ts';
import schoolForm from '../packages/forms/examples/anmeldung-klasse5.json' with { type: 'json' };
import { FormService, GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { SvwsClient, createTransport } from '../packages/svws/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local SVWS test server, self-signed

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const formService = new FormService(site);
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const svwsEnv = Object.fromEntries(
    fs.readFileSync('docker/svws/.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const schema = svwsEnv.MARIADB_DATABASE || 'gymabi';
const svwsUrl = `https://localhost:${svwsEnv.SVWS_PORT || 8443}`;
const svwsApi = new SvwsClient(createTransport({ url: svwsUrl, transport: 'direct' }), schema, { user: 'Admin', password: '' });

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');
const stamp = Date.now().toString(36);
const created = { svws: [] as string[] };

// setup: school form with its catalogs, procedure, released application with photo
const CATALOGS = ['laender.json', 'sprachen.json', 'staatsangehoerigkeiten.json'];
const existing = new Set((await site.listAssets()).map((a) => a.key));
const addedCatalogs = CATALOGS.filter((c) => !existing.has(c));
for (const c of addedCatalogs) {
    await site.putAsset(c, new Blob([fs.readFileSync(`packages/forms/catalogs/${c}`)], { type: 'application/json' }));
}
const form = await formService.saveVersion(schoolForm);
const procedure = await procedures.create({ formId: form.id, info: { title: `E2E SVWS ${stamp}` }, startDate: day(-1), endDate: day(20) });
const app = await applications.create({ procedureId: procedure.id, formId: form.id, state: 'ready_for_svws', data: {}, childName: `Übertrag-${stamp}, Lina`, contactName: 'Familie Übertrag' });
const canvas = createCanvas(600, 800);
const g = canvas.getContext('2d');
g.fillStyle = '#2456a6';
g.fillRect(0, 0, 600, 800);
const photoId = `${app.id}/${'ab'.repeat(16)}.jpg`;
const photo = canvas.toBuffer('image/jpeg');
await site.putUpload(photoId, new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }));
const data = {
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

const stop = await startDevServer('secretariat');
const browser = await launch();
const tmp = fs.mkdtempSync('/tmp/claude-e2e-svws-');
try {
    const page = await (await browser.newContext()).newPage();
    const problems = watchConsole(page);
    const nav = (label: string) => page.getByRole('navigation').getByRole('link', { name: label }).click();

    await step('configure the SVWS endpoint (proxy, schema) in this browser', async () => {
        await page.goto(URLS.secretariat);
        await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await nav('Einstellungen');
        await page.getByLabel('SVWS-Adresse').fill(svwsUrl);
        await page.getByLabel('Verbindung').selectOption('proxy');
        await page.getByLabel('Proxy-Adresse').fill(`${URLS.secretariat}/svws-proxy`);
        await page.getByLabel('Datenbank-Schema der Schule').fill(schema);
        await page.getByRole('button', { name: 'Speichern', exact: true }).click();
        await page.getByText('Angemeldet als').waitFor({ timeout: 30000 });
    });

    await step('connection check through the proxy', async () => {
        await nav('Anmeldungen');
        await page.locator(`tr[data-id="${app.id}"]`).getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Ausgewählte an SVWS übertragen …' }).click();
        const dialog = page.getByTestId('svws-dialog');
        await dialog.getByText(`Schema ${schema} (proxy)`).waitFor();
        await dialog.getByLabel('SVWS-Benutzer').fill('Admin');
        await dialog.getByRole('button', { name: 'Verbindung prüfen' }).click();
        await dialog.getByText(/SVWS \d+\.\d+.*Albert Zweistein Gymnasium/).waitFor({ timeout: 20000 });
    });

    await step('transfer: student incl. photo in SVWS, application imported', async () => {
        const dialog = page.getByTestId('svws-dialog');
        await dialog.getByRole('button', { name: '1 Anmeldung(en) übertragen' }).click();
        const result = await dialog.getByText(/Übertragen als Schüler-ID \d+/).textContent({ timeout: 60000 });
        const svwsId = /Schüler-ID (\d+)/.exec(result ?? '')![1];
        created.svws.push(svwsId);
        const stored = (await applications.get(app.id))!;
        assert(stored.state === 'imported' && stored.svwsId === svwsId, `application ${stored.state} ${stored.svwsId}`);
        const s = await svwsApi.get<Record<string, any>>(`/schueler/${svwsId}/stammdaten`);
        assert(s.nachname === data.nachname && s.vorname === 'Lina' && s.wohnortID === 203 && s.hausnummer === '7', `stammdaten ${s.nachname} ${s.wohnortID}`);
        assert(typeof s.foto === 'string' && Buffer.from(s.foto, 'base64').length > 1000, 'photo missing');
        const erzieher = await svwsApi.get<Record<string, any>[]>(`/schueler/${svwsId}/erzieher`);
        assert(erzieher.length === 1 && erzieher[0].vorname === 'Anna', `erzieher ${erzieher.length}`);
    });

    await step('imported application leaves the transfer selection, shows the SVWS id', async () => {
        await page.getByRole('button', { name: /^In SVWS übernommen \(\d+\)$/ }).click();
        const row = page.locator(`tr[data-id="${app.id}"]`);
        await row.waitFor({ timeout: 20000 });
        assert((await row.getByRole('checkbox').count()) === 0, 'imported application still selectable');
        await row.getByRole('button', { name: 'Öffnen' }).click();
        await page.getByText(`Schüler-ID ${created.svws[0]}`).waitFor({ timeout: 20000 });
    });

    await step('no console errors or warnings', async () => {
        assert(problems.length === 0, problems.join(' | '));
    });
} finally {
    await browser.close();
    stop();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (created.svws.length) await svwsApi.call('DELETE', '/schueler/delete/multiple', created.svws.map(Number)).catch(() => {});
    await site.deleteUploads(app.id).catch(() => {});
    await applications.delete(app.id).catch(() => {});
    await procedures.delete(procedure.id).catch(() => {});
    await formService.repo.delete(form.id).catch(() => {});
    for (const c of addedCatalogs) await site.deleteAsset(c).catch(() => {});
    console.log(`      test data removed (SVWS: ${created.svws.join(', ') || '-'})`);
}
process.exit(failureCount() ? 1 : 0);
