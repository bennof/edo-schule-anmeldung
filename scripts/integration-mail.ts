// H1 test: one booking -> exactly one confirmation mail. The server runs
// with MAIL_REDIRECT, so the mail goes to MAIL_TEST_TO from .env instead of
// the booking address. Also checks the resume link from the mail.
// Usage: node scripts/integration-mail.ts   (then check the test inbox)
import { execSync, spawn } from 'node:child_process';
import type { FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import testForm from '../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, ConfigStore, GraphClient, Repository, SharePointSite, provision } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, startDevServer, step, URLS } from './e2e-util.ts';

const env = readEnv();
if (!env.MAIL_TEST_TO) throw new Error('MAIL_TEST_TO missing in .env');
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const config = new ConfigStore(site);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const appointments = new AppointmentService(site);
// port 8080: the public dev server proxies /api there
const API = 'http://127.0.0.1:8080/api';
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');

await provision(site);
for (const [key, value] of [['mailSender', 'anmeldung@schule.de'], ['publicUrl', URLS.public]] as const) {
    if (!(await config.get(key))) {
        await config.set(key, value, false);
        console.log(`      config ${key} set to ${value}`);
    }
}

const form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
const procedure = await procedures.create({ formId: form.id, info: { title: 'Anmeldung Klasse 5 (Mailtest)' }, startDate: day(-1), endDate: day(20) });
const [slot] = await appointments.createDrafts([{ procedureId: procedure.id, datetime: `${day(6)}T11:40`, state: 'draft' }]);
await appointments.publish([slot.id]);

execSync('cargo build -q', { cwd: 'server', stdio: 'inherit', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
const server = spawn('./target/debug/anmeldung-server', {
    cwd: 'server',
    env: { ...process.env, BIND_ADDR: '127.0.0.1:8080', MAIL_REDIRECT: env.MAIL_TEST_TO },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 50 && !(await fetch(`${API}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));

let booking: { applicationId: string; token: string } | undefined;
const stopPublic = await startDevServer('public');
try {
    await step('one booking sends exactly one confirmation mail (H1)', async () => {
        const res = await fetch(`${API}/appointments/${slot.id}/booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Familie Mailtest', email: 'kunde@example.org' }),
        });
        booking = await res.json();
        assert(res.ok, `booking ${res.status}`);
        await new Promise((r) => setTimeout(r, 500));
        const sent = log.split('\n').filter((l) => l.includes('confirmation mail sent')).length;
        assert(sent === 1, `mails sent: ${sent}; log: ${log.split('\n').filter((l) => /mail/.test(l)).join(' | ')}`);
        assert(!log.includes('example.org') && !log.includes(env.MAIL_TEST_TO), 'address in log');
        console.log(`      sent to ${env.MAIL_TEST_TO} (redirected): ${day(6)} 11:40, "Anmeldung Klasse 5 (Mailtest)"`);
    });

    await step('resume link from the mail opens the booking on another device', async () => {
        const browser = await launch();
        try {
            const page = await (await browser.newContext()).newPage();
            await page.goto(`${URLS.public}/#fortsetzen/${booking!.applicationId}/${booking!.token}`);
            await page.getByRole('heading', { name: 'Willkommen zurück' }).waitFor({ timeout: 20000 }).catch(async () => {
                throw new Error(`page shows: ${(await page.locator('main').textContent())?.replace(/\s+/g, ' ').slice(0, 300)}`);
            });
            assert(!page.url().includes(booking!.token), 'token left in the address bar');
            await page.goto(`${URLS.public}/#fortsetzen/${booking!.applicationId}/${'0'.repeat(64)}`);
            await page.getByText('Der Link ist ungültig').waitFor({ timeout: 20000 });
        } finally {
            await browser.close();
        }
    });
} finally {
    server.kill();
    stopPublic();
    const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
    if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
    await appointments.repo.delete(slot.id).catch(() => {});
    await procedures.delete(procedure.id).catch(() => {});
    await forms.delete(form.id).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
