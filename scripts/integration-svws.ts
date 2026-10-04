// Integration test of the SVWS adapter against the local SVWS test server
// (make svws-init). Transfers a complete school-form application with photo,
// checks the result through the SVWS API and deletes the student again.
// Usage: node scripts/integration-svws.ts
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import { createSvwsAdapter, SvwsClient, createTransport, type SvwsEndpoint } from '../packages/svws/src/index.ts';

// the test server uses a self-signed certificate (localhost only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const svwsEnv = Object.fromEntries(
    fs.readFileSync('docker/svws/.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const endpoint: SvwsEndpoint = { url: `https://localhost:${svwsEnv.SVWS_PORT || 8443}`, transport: 'direct', schema: svwsEnv.MARIADB_DATABASE || 'gymabi' };
const creds = { user: 'Admin', password: '' };
const client = new SvwsClient(createTransport(endpoint), endpoint.schema!, creds);

let failures = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`ok    ${name}`);
    } catch (e) {
        failures++;
        console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
    }
}
function assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new Error(message);
}

const canvas = createCanvas(600, 800);
const g = canvas.getContext('2d');
g.fillStyle = '#9ec5fe';
g.fillRect(0, 0, 600, 800);
const photo = new Uint8Array(canvas.toBuffer('image/jpeg'));

const stamp = Date.now().toString(36);
const data = {
    nachname: `Testkind-${stamp}`,
    vorname: 'Mia Sophie',
    geschlecht: 'w',
    geburtsdatum: '2015-05-04',
    geburtsort: 'Kraków',
    geburtsland: 'PL',
    staatsangehoerigkeit: 'DE',
    herkunftssprache: 'PL',
    zuzugsdatum: '2019-08-01',
    religion: 'rk',
    adresse: { strasse: 'Am Weg 12a', plz: '42103', ort: 'Wuppertal' },
    erziehungsberechtigter1: { rolle: 'mutter', nachname: `Testkind-${stamp}`, vorname: 'Ewa', abweichendeAdresse: false, telefonMobil: '0170 1234567', email: 'ewa@example.org' },
    zweiterErziehungsberechtigter: true,
    erziehungsberechtigter2: { rolle: 'vater', nachname: 'Nowak', vorname: 'Jan', abweichendeAdresse: true, adresse: { strasse: 'Hauptstr. 5', plz: '52066', ort: 'Aachen' } },
};
const created: string[] = [];
const adapter = createSvwsAdapter(endpoint);

try {
    await step('connection check', async () => {
        const info = await adapter.check(creds);
        assert(/SVWS \d+\.\d+.*Albert Zweistein Gymnasium/.test(info), info);
        console.log(`      ${info}`);
    });

    await step('wrong credentials are reported, nothing is created', async () => {
        const [r] = await adapter.transfer([{ applicationId: 'x', formId: 'f', data }], { user: 'Admin', password: 'falsch' });
        assert(!r.ok && !r.svwsId && /Anmeldung/.test(r.message), r.message);
    });

    let svwsId = '';
    await step('transfer creates student, master data, photo and guardians', async () => {
        const [r] = await adapter.transfer([{ applicationId: 'a1', formId: 'f', data, submittedAt: '2026-10-04T10:00:00Z', photo }], creds);
        if (r.svwsId) created.push(r.svwsId); // also partial results, for cleanup
        assert(r.ok && r.svwsId, `${r.message} ${JSON.stringify(r.warnings)}`);
        svwsId = r.svwsId;
        console.log(`      ${r.message}; warnings: ${r.warnings?.length ? r.warnings.join(' | ') : '-'}`);
    });

    await step('SVWS master data match the application', async () => {
        assert(svwsId, 'no student created');
        const s = await client.get<Record<string, any>>(`/schueler/${svwsId}/stammdaten`);
        assert(s.nachname === data.nachname && s.vorname === 'Mia' && s.alleVornamen === 'Mia Sophie', `names ${s.nachname} ${s.vorname}`);
        assert(s.geschlecht === 4 && s.geburtsdatum === '2015-05-04' && s.geburtsort === 'Kraków', 'person');
        assert(s.strassenname === 'Am Weg' && s.hausnummer === '12' && s.hausnummerZusatz === 'a' && s.wohnortID === 203, `address ${s.strassenname} ${s.wohnortID}`);
        assert(s.status === 0 && s.anmeldedatum === '2026-10-04', `status ${s.status} ${s.anmeldedatum}`);
        assert(s.zuzugsjahr === 2019 && s.idStaatsangehoerigkeit && s.idGeburtsland && s.idVerkehrspracheFamilie, 'origin');
        assert(s.religionID, 'religion');
        assert(typeof s.foto === 'string' && s.foto.length > 1000, 'photo missing');
        assert(Buffer.from(s.foto, 'base64')[0] === 0xff, 'photo is not a JPEG');
    });

    await step('guardians in SVWS', async () => {
        assert(svwsId, 'no student created');
        const list = await client.get<Record<string, any>[]>(`/schueler/${svwsId}/erzieher`);
        const byName = (n: string) => list.find((e) => e.vorname === n);
        assert(list.length === 2, `${list.length} guardians`);
        assert(byName('Ewa')?.idErzieherArt === 2 && byName('Ewa')?.eMail === 'ewa@example.org' && byName('Ewa')?.wohnortID === 203, 'mother');
        assert(byName('Jan')?.idErzieherArt === 1 && byName('Jan')?.strassenname === 'Hauptstr.' && byName('Jan')?.wohnortID === 648, 'father');
        assert(String(byName('Ewa')?.bemerkungen ?? '').includes('0170 1234567'), 'phone note');
    });

    await step('already transferred applications are not created again', async () => {
        assert(svwsId, 'no student created');
        const [r] = await adapter.transfer([{ applicationId: 'a1', formId: 'f', data, svwsId }], creds);
        assert(!r.ok && r.svwsId === svwsId && /Bereits/.test(r.message), r.message);
    });
} finally {
    if (created.length) await client.call('DELETE', '/schueler/delete/multiple', created.map(Number)).catch((e) => console.log(`      cleanup failed: ${e}`));
    console.log(`      SVWS test students removed: ${created.join(', ') || '-'}`);
}
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
process.exit(failures ? 1 : 0);
