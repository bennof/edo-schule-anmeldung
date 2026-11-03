// One booking -> exactly one confirmation mail. The server runs with
// MAIL_REDIRECT, so the mail goes to MAIL_TEST_TO from .env instead of the
// booking address (check that inbox afterwards). Also checks the resume link.
import assert from 'node:assert/strict';
import { afterAll, beforeAll, it } from 'vitest';
import type { Appointment, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import testForm from '../../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, ConfigStore, Repository, provision } from '../../packages/sharepoint/src/index.ts';
import { launch, startApiServer, startDevServer, URLS, type ApiServer } from '../support/browser.ts';
import { day, env, testSite } from '../support/env.ts';

const site = testSite();
const config = new ConfigStore(site);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const appointments = new AppointmentService(site);

let form: FormDefinition | undefined;
let procedure: Procedure | undefined;
let slot: Appointment | undefined;
let server: ApiServer | undefined;
let stopPublic = () => {};
let booking: { applicationId: string; token: string } | undefined;

beforeAll(async () => {
    assert(env.MAIL_TEST_TO, 'MAIL_TEST_TO missing in .env');
    await provision(site);
    for (const [key, value] of [
        ['mailSender', 'anmeldung@schule.de'],
        ['publicUrl', URLS.public],
    ] as const) {
        if (!(await config.get(key))) await config.set(key, value, false);
    }
    form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
    procedure = await procedures.create({ formId: form.id, info: { title: 'Anmeldung Klasse 5 (Mailtest)' }, startDate: day(-1), endDate: day(20) });
    [slot] = await appointments.createDrafts([{ procedureId: procedure.id, datetime: `${day(6)}T11:40`, state: 'draft' }]);
    await appointments.publish([slot.id]);
    server = await startApiServer({ env: { MAIL_DISABLED: '', MAIL_REDIRECT: env.MAIL_TEST_TO } });
    stopPublic = await startDevServer('public');
});

afterAll(async () => {
    server?.stop();
    stopPublic();
    if (procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        await procedures.delete(procedure.id).catch(() => {});
    }
    if (slot) await appointments.repo.delete(slot.id).catch(() => {});
    if (form) await forms.delete(form.id).catch(() => {});
});

it('one booking sends exactly one confirmation mail', async () => {
    const res = await fetch(`${server!.api}/appointments/${slot!.id}/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Familie Mailtest', email: 'kunde@example.org' }),
    });
    booking = await res.json();
    assert(res.ok, `booking ${res.status}`);
    await new Promise((r) => setTimeout(r, 500));
    const log = server!.log();
    const sent = log.split('\n').filter((l) => l.includes('confirmation mail sent')).length;
    assert(sent === 1, `mails sent: ${sent}; log: ${log.split('\n').filter((l) => /mail/.test(l)).join(' | ')}`);
    assert(!log.includes('example.org') && !log.includes(env.MAIL_TEST_TO), 'address in log');
});

it('resume link from the mail opens the booking on another device', async () => {
    const browser = await launch();
    try {
        const page = await (await browser.newContext()).newPage();
        await page.goto(`${URLS.public}/#fortsetzen/${booking!.applicationId}/${booking!.token}`);
        await page
            .getByRole('heading', { name: 'Willkommen zurück' })
            .waitFor({ timeout: 20000 })
            .catch(async () => {
                throw new Error(`page shows: ${(await page.locator('main').textContent())?.replace(/\s+/g, ' ').slice(0, 300)}`);
            });
        assert(!page.url().includes(booking!.token), 'token left in the address bar');
        await page.goto(`${URLS.public}/#fortsetzen/${booking!.applicationId}/${'0'.repeat(64)}`);
        await page.getByText('Der Link ist ungültig').waitFor({ timeout: 20000 });
    } finally {
        await browser.close();
    }
});
