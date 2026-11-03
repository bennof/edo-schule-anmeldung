// Rust public server against the SharePoint test site. Test data is created
// with the app identity, the server uses the daemon identity.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, Appointment, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import testForm from '../../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, ConfigStore, Repository } from '../../packages/sharepoint/src/index.ts';
import { startApiServer, type ApiServer } from '../support/browser.ts';
import { clientCredentialsToken, day, env, testSite } from '../support/env.ts';

const site = testSite();
const forms = new Repository<FormDefinition>(site, 'forms');
const applications = new Repository<Application & { accessTokenHash?: string }>(site, 'applications');
const procedures = new Repository<Procedure>(site, 'procedures');
const appointments = new AppointmentService(site);
const config = new ConfigStore(site);

// own port, so a running development server does not interfere
const PORT = 23189;
const API = `http://127.0.0.1:${PORT}/api`;
const tag = `itest-${Date.now()}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let form: FormDefinition;
let active: Procedure;
let inactive: Procedure;
let drafts: Appointment[] = [];
let slotA: Appointment, slotB: Appointment, slot2: Appointment, draftSlot: Appointment, pastSlot: Appointment, inactiveSlot: Appointment, slotLimit: Appointment;
let previousLimit: string | undefined;
let server: ApiServer | undefined;

beforeAll(async () => {
    form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
    active = await procedures.create({ formId: form.id, info: { title: `${tag} aktiv` }, startDate: day(-1), endDate: day(30) });
    inactive = await procedures.create({ formId: form.id, info: { title: `${tag} alt` }, startDate: day(-60), endDate: day(-30) });
    drafts = await appointments.createDrafts([
        { procedureId: active.id, datetime: `${day(3)}T08:00`, state: 'draft', verantwortlicherId: 'A' },
        { procedureId: active.id, datetime: `${day(3)}T08:00`, state: 'draft', verantwortlicherId: 'B' },
        { procedureId: active.id, datetime: `${day(3)}T08:20`, state: 'draft', verantwortlicherId: 'A' },
        { procedureId: active.id, datetime: `${day(3)}T08:40`, state: 'draft', verantwortlicherId: 'A' },
        { procedureId: active.id, datetime: `${day(-2)}T08:00`, state: 'draft', verantwortlicherId: 'A' },
        { procedureId: inactive.id, datetime: `${day(3)}T09:00`, state: 'draft' },
        { procedureId: active.id, datetime: `${day(3)}T09:20`, state: 'draft', verantwortlicherId: 'A' },
    ]);
    [slotA, slotB, slot2, draftSlot, pastSlot, inactiveSlot, slotLimit] = drafts;
    await appointments.publish([slotA.id, slotB.id, slot2.id, pastSlot.id, inactiveSlot.id, slotLimit.id]);
    previousLimit = await config.get('maxBookingsPerIp');
    await config.set('maxBookingsPerIp', '2', false);
    await config.set(`${tag}-public`, 'sichtbar', true);
    await config.set(`${tag}-intern`, 'geheim', false);
    await site.putAsset(`${tag}-intern.txt`, new Blob(['intern'], { type: 'text/plain' }));
    server = await startApiServer({ port: PORT });
});

afterAll(async () => {
    server?.stop();
    if (drafts.length) await site.deleteItems('appointments', drafts.map((d) => d.id)).catch(() => {});
    if (active) {
        const created = await applications.list(applications.filter('procedureId', active.id)).catch(() => []);
        for (const a of created) await site.deleteUploads(a.id).catch(() => {});
        if (created.length) await site.deleteItems('applications', created.map((a) => a.id)).catch(() => {});
        await procedures.delete(active.id).catch(() => {});
    }
    if (inactive) await procedures.delete(inactive.id).catch(() => {});
    if (form) await forms.delete(form.id).catch(() => {});
    await config.delete(`${tag}-public`).catch(() => {});
    await config.delete(`${tag}-intern`).catch(() => {});
    if (previousLimit === undefined) await config.delete('maxBookingsPerIp').catch(() => {});
    else await config.set('maxBookingsPerIp', previousLimit, false).catch(() => {});
    await site.deleteAsset(`${tag}-intern.txt`).catch(() => {});
});

const get = async (path: string) => {
    const r = await fetch(API + path);
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
};
const book = (id: string, name = 'Test Person', email = 'test@example.org') =>
    fetch(`${API}/appointments/${id}/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

let appId = '';
let appToken = '';
let photoRef: { id: string; name: string; contentType: string; size: number } | undefined;
const authed = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${API}/applications/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }).then(async (r) => ({
        status: r.status,
        body: await r.json(),
    }));
const upload = (bytes: Buffer, type: string, name: string, token = appToken) =>
    fetch(`${API}/applications/${appId}/uploads?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
        body: new Uint8Array(bytes),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

it('status: server reaches SharePoint; status routes allow other origins', async () => {
    const r = await fetch(`${API}/status`);
    const body = await r.json();
    assert(r.status === 200 && body.status === 'ok' && body.sharepoint === 'ok' && body.version, JSON.stringify(body));
    assert(r.headers.get('access-control-allow-origin') === '*', 'status without CORS header');
    assert((await fetch(`${API}/health`)).headers.get('access-control-allow-origin') === '*', 'health without CORS header');
    assert((await fetch(`${API}/config`)).headers.get('access-control-allow-origin') === null, 'CORS header on data route');
});

it('config: public entries and active procedures only', async () => {
    const { status, body } = await get('/config');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.config[`${tag}-public`] === 'sichtbar', 'public entry missing');
    assert(!(`${tag}-intern` in body.config) && !('schemaVersion' in body.config), 'internal entry exposed');
    const ids = body.procedures.map((p: { id: string }) => p.id);
    assert(ids.includes(active.id) && !ids.includes(inactive.id), `procedures ${ids}`);
    assert(body.procedures.find((p: { id: string }) => p.id === active.id).title === `${tag} aktiv`, 'title');
    assert(typeof body.config.consentText === 'string' && body.config.consentText.length > 0, 'consentText missing');
    assert(!('maxBookingsPerIp' in body.config), 'internal limit exposed');
});

it('form of active procedure; inactive procedure hidden', async () => {
    const ok = await get(`/procedures/${active.id}/form`);
    assert(ok.status === 200 && ok.body.form.title === testForm.title, `form ${ok.status}`);
    assert((await get(`/procedures/${inactive.id}/form`)).status === 404, 'inactive form visible');
});

it('only future available slots, id and time only', async () => {
    const { status, body } = await get(`/procedures/${active.id}/appointments`);
    assert(status === 200, `status ${status}`);
    const ids = body.map((s: { id: string }) => s.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify([slotA.id, slotB.id, slot2.id, slotLimit.id].sort()), `slots ${JSON.stringify(body)}`);
    assert(
        body.every((s: object) => Object.keys(s).sort().join() === 'datetime,id'),
        'extra fields',
    );
    assert((await get(`/procedures/${inactive.id}/appointments`)).status === 404, 'inactive procedure slots visible');
});

it('invalid booking input is rejected', async () => {
    assert((await book(slotA.id, 'X')).status === 400, 'short name accepted');
    assert((await book(slotA.id, 'Eva', 'kein-mail')).status === 400, 'bad email accepted');
    assert((await book('abc')).status === 404, 'bad id accepted');
});

it('five concurrent bookings of one slot: exactly one succeeds', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => book(slot2.id, `Person ${n}`, `p${n}@example.org`)));
    const statuses = results.map((r) => r.status).sort();
    assert(JSON.stringify(statuses) === '[200,409,409,409,409]', `statuses ${statuses}`);
    const winner = results.find((r) => r.status === 200)!;
    assert(winner.body.datetime === `${day(3)}T08:20`, 'reply datetime');
    const stored = (await appointments.repo.get(slot2.id))!;
    assert(stored.state === 'booked' && stored.nameCustomer?.startsWith('Person') && stored.requestTime, 'stored booking');
});

it('booking creates a linked application; only the token hash is stored', async () => {
    const booked = (await appointments.repo.get(slot2.id))!;
    assert(booked.applicationId, 'appointment not linked');
    const app = (await applications.get(booked.applicationId))!;
    assert(app.state === 'created' && app.procedureId === active.id && app.formId === form.id, `application ${JSON.stringify(app)}`);
    assert(app.accessTokenHash && /^[0-9a-f]{64}$/.test(app.accessTokenHash), 'hash missing');
});

it('booking reply carries application id and token', async () => {
    const r = await book(slotB.id, 'Familie Token', 'token@example.org');
    assert(r.status === 200 && r.body.applicationId && /^[0-9a-f]{64}$/.test(r.body.token), `reply ${JSON.stringify(Object.keys(r.body))}`);
    const stored = (await applications.get(r.body.applicationId))!;
    assert(stored.accessTokenHash !== r.body.token, 'token stored in clear');
    assert((await appointments.repo.get(slotB.id))!.applicationId === r.body.applicationId, 'link differs');
    appId = r.body.applicationId;
    appToken = r.body.token;
});

it('application endpoints reject wrong or missing tokens with 404', async () => {
    assert((await authed(appId, 'f'.repeat(64))).status === 404, 'wrong token');
    assert((await fetch(`${API}/applications/${appId}`)).status === 404, 'no token');
    assert((await authed(`${appId}/submit`, 'x', { method: 'POST', body: '{}' })).status === 404, 'submit wrong token');
});

it('uploads: store a file and return its reference', async () => {
    const r = await upload(PNG, 'image/png', 'Passfoto Mia.png');
    assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.id.startsWith(`${appId}/`) && r.body.name === 'Passfoto Mia.png' && r.body.size === PNG.length, JSON.stringify(r.body));
    photoRef = r.body;
    const stored = await site.getUpload(r.body.id);
    assert(stored && Buffer.from(await stored.arrayBuffer()).equals(PNG), 'stored bytes differ');
    const file = r.body.id.split('/')[1];
    const own = await fetch(`${API}/applications/${appId}/uploads/${file}`, { headers: { Authorization: `Bearer ${appToken}` } });
    assert(own.ok && Buffer.from(await own.arrayBuffer()).equals(PNG), `own file ${own.status}`);
});

it('uploads: wrong type, fake signature, oversize, wrong token are refused', async () => {
    assert((await upload(Buffer.from('<html>'), 'text/html', 'x.html')).status === 415, 'html');
    assert((await upload(Buffer.from('<html>'), 'image/png', 'x.png')).status === 415, 'fake png');
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
    const tooBig = await fetch(`${API}/applications/${appId}/uploads?name=big.png`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'image/png' },
        body: new Uint8Array(big),
    });
    assert(tooBig.status === 413, `oversize ${tooBig.status}`);
    assert((await upload(PNG, 'image/png', 'x.png', 'f'.repeat(64))).status === 404, 'wrong token');
});

it('uploads: delete own file', async () => {
    const extra = await upload(PNG, 'image/png', 'weg.png');
    const file = extra.body.id.split('/')[1];
    const del = await fetch(`${API}/applications/${appId}/uploads/${file}`, { method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` } });
    assert(del.ok, `delete ${del.status}`);
    assert((await site.getUpload(extra.body.id)) === undefined, 'file still there');
});

it('start, reject invalid data, submit once', async () => {
    const status = await authed(appId, appToken);
    assert(status.status === 200 && status.body.state === 'created' && status.body.appointment.id === slotB.id, `status ${JSON.stringify(status.body)}`);
    const formReply = await authed(`${appId}/form`, appToken);
    assert(formReply.body.form.title === testForm.title, 'form');
    assert((await authed(`${appId}/start`, appToken, { method: 'POST' })).body.state === 'form_in_progress', 'start');
    assert((await applications.get(appId))!.state === 'form_in_progress', 'state not stored');

    const post = (data: unknown) =>
        authed(`${appId}/submit`, appToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const invalid = await post({ nachname: 'X', hacker: true });
    assert(invalid.status === 400 && invalid.body.error === 'invalid_data', `invalid ${invalid.status}`);
    const foreign = await post({ passfoto: { ...photoRef!, id: `999/${photoRef!.id.split('/')[1]}` } });
    assert(foreign.status === 400, `foreign file reference accepted: ${foreign.status}`);
    const data = {
        nachname: 'Muster',
        geburtsdatum: '2015-04-01',
        schulen: [{ von: 2021 }],
        sorgeberechtigter1: { nachname: 'M', vorname: 'E' },
        passfoto: photoRef,
    };
    const ok = await post(data);
    assert(ok.status === 200 && ok.body.state === 'submitted', `submit ${ok.status} ${JSON.stringify(ok.body)}`);
    const stored = (await applications.get(appId))!;
    assert(stored.state === 'submitted' && isDeepStrictEqual(stored.data, data) && stored.submittedAt, 'stored data');
    const again = await post(data);
    assert(again.status === 409 && again.body.error === 'already_submitted', `second submit ${again.status}`);
    assert((await authed(`${appId}/start`, appToken, { method: 'POST' })).status === 409, 'start after submit');
    assert((await upload(PNG, 'image/png', 'spaet.png')).status === 409, 'upload after submit');
    const file = photoRef!.id.split('/')[1];
    const del = await fetch(`${API}/applications/${appId}/uploads/${file}`, { method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` } });
    assert(del.status === 409, `delete after submit ${del.status}`);
});

it('booked, draft, past and inactive slots cannot be booked', async () => {
    assert((await book(slot2.id)).status === 409, 'booked slot');
    assert((await book(draftSlot.id)).status === 409, 'draft slot');
    assert((await book(pastSlot.id)).status === 409, 'past slot');
    assert((await book(inactiveSlot.id)).status === 404, 'inactive procedure slot');
});

it('parallel slot at the same time stays bookable', async () => {
    // slotB (08:00, B) was booked above; slotA (08:00, A) is still free
    await config.set('maxBookingsPerIp', '3', false);
    const r = await book(slotA.id);
    assert(r.status === 200, `status ${r.status}`);
    const left = (await get(`/procedures/${active.id}/appointments`)).body.map((s: { id: string }) => s.id);
    assert(JSON.stringify(left) === JSON.stringify([slotLimit.id]), `left ${left}`);
});

it('IP filter: fourth booking from the same address is refused (limit 3)', async () => {
    const stored = (await appointments.repo.get(slotA.id))!;
    assert(stored.requestIp === '127.0.0.1', `requestIp ${stored.requestIp}`);
    const r = await book(slotLimit.id, 'Dritte Buchung', 'drei@example.org');
    assert(r.status === 429 && r.body.error === 'limit', `status ${r.status}`);
    assert((await appointments.repo.get(slotLimit.id))!.state === 'available', 'slot booked despite limit');
    await config.set('maxBookingsPerIp', '0', false);
    assert((await book(slotLimit.id, 'Dritte Buchung', 'drei@example.org')).status === 200, 'limit 0 should disable the filter');
});

it('assets: unlisted keys are not public', async () => {
    assert((await get(`/assets/${tag}-intern.txt`)).status === 404, 'internal asset exposed');
    assert((await get('/assets/..%2F.env')).status === 404, 'traversal');
});

it('daemon has list-level access only: non-granted library content is invisible', async () => {
    const token = await clientCredentialsToken(env.DAEMON_CLIENT_ID, env.DAEMON_CLIENT_SECRET);
    const daemonGet = (path: string) =>
        fetch(`https://graph.microsoft.com/v1.0/sites/${env.SHAREPOINT_ID}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status);
    assert((await daemonGet('/lists/Config?$select=id')) === 200, 'granted list not readable');
    // a file in the default library "Dokumente", which has no grant
    const probe = `${tag}-probe.txt`;
    await site.graph.request('PUT', `/sites/${env.SHAREPOINT_ID}/drive/root:/${probe}:/content`, {
        raw: new Blob(['probe'], { type: 'text/plain' }),
        headers: { 'Content-Type': 'text/plain' },
    });
    try {
        const status = await daemonGet(`/drive/root:/${probe}:/content`);
        assert(status === 404 || status === 403, `daemon can read the default library (${status})`);
    } finally {
        await site.graph.request('DELETE', `/sites/${env.SHAREPOINT_ID}/drive/root:/${probe}:`);
    }
});

it('server log contains no personal data', async () => {
    assert(!/Person \d|example\.org|Dritte|Muster|[0-9a-f]{64}/.test(server!.log()), 'personal data or token in log');
});
