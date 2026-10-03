// Sprint 5 end-to-end test: a complete registration day in the secretariat.
// Three families book via the public API (two submit the form), then the
// secretariat works the day: day view, phone cancellation, "arrived",
// editing with autosave and comments, review up to the SVWS release,
// conflict detection, name search after cancellation, status filter.
// Usage: node scripts/e2e-day.ts
import { execSync, spawn } from 'node:child_process';
import type { Application, FormDefinition, Procedure } from '../packages/domain/src/index.ts';
import testForm from '../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, GraphClient, Repository, SharePointSite } from '../packages/sharepoint/src/index.ts';
import { appTokenProvider, readEnv } from './env.ts';
import { assert, failureCount, launch, signIn, startDevServer, step, URLS, watchConsole } from './e2e-util.ts';

const env = readEnv();
const site = new SharePointSite(new GraphClient(appTokenProvider(env)), env.SHAREPOINT_ID);
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const API = 'http://127.0.0.1:8080/api';
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');
const testDay = day(5);
const tag = `E2E Tag ${Date.now()}`;

const form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
const procedure = await procedures.create({ formId: form.id, info: { title: tag }, startDate: day(-1), endDate: day(20) });
const slots = await appointments.createDrafts([
    { procedureId: procedure.id, datetime: `${testDay}T09:00`, state: 'draft', verantwortlicherId: 'Raum 1' },
    { procedureId: procedure.id, datetime: `${testDay}T09:00`, state: 'draft', verantwortlicherId: 'Raum 2' },
    { procedureId: procedure.id, datetime: `${testDay}T09:20`, state: 'draft', verantwortlicherId: 'Raum 1' },
]);
await appointments.publish(slots.map((s) => s.id));

execSync('cargo build -q', { cwd: 'server', stdio: 'inherit', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
const server = spawn('./target/debug/anmeldung-server', { cwd: 'server', env: { ...process.env, BIND_ADDR: '127.0.0.1:8080' }, stdio: 'ignore' });
for (let i = 0; i < 50 && !(await fetch(`${API}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));
const stopSecretariat = await startDevServer('secretariat');
const browser = await launch();

async function bookAndMaybeSubmit(slotId: string, family: string, child?: string): Promise<string> {
    const res = await fetch(`${API}/appointments/${slotId}/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Familie ${family}`, email: `${family.toLowerCase()}@example.org` }),
    });
    const booking = await res.json();
    assert(res.ok && booking.applicationId, `booking failed: ${res.status}`);
    if (child) {
        const auth = { Authorization: `Bearer ${booking.token}`, 'Content-Type': 'application/json' };
        await fetch(`${API}/applications/${booking.applicationId}/start`, { method: 'POST', headers: auth });
        const sub = await fetch(`${API}/applications/${booking.applicationId}/submit`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ data: { nachname: child, geburtsdatum: '2015-04-01', sorgeberechtigter1: { nachname: family, vorname: 'Eva' } } }),
        });
        assert(sub.ok, `submit failed: ${sub.status}`);
    }
    return booking.applicationId;
}

try {
    const appA = await bookAndMaybeSubmit(slots[0].id, 'Adler', 'Adler');
    const appB = await bookAndMaybeSubmit(slots[1].id, 'Berg', 'Berg');
    const appC = await bookAndMaybeSubmit(slots[2].id, 'Clausen');

    const page = await browser.newPage();
    const problems = watchConsole(page);
    page.on('dialog', (d) => d.accept());
    const field = (path: string) => page.locator(`[data-path="${path}"]`);
    const slotCell = (id: string) => page.locator(`td[data-id="${id}"]`);
    const state = () => page.getByTestId('application-state').textContent();

    await step('day view shows parallel slots with appointment and application state (J2)', async () => {
        await page.goto(`${URLS.secretariat}/#tag/${testDay}`);
        await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
        await page.getByRole('heading', { name: 'Tagesansicht' }).waitFor({ timeout: 20000 });
        await page.getByLabel('Datum').fill(testDay);
        await page.getByRole('columnheader', { name: 'Raum 2' }).waitFor({ timeout: 20000 });
        assert(await slotCell(slots[0].id).getByText('Adler').first().isVisible(), 'child A');
        assert(await slotCell(slots[1].id).getByText('Online abgeschickt').isVisible(), 'application state B');
        assert(await slotCell(slots[2].id).getByText('Familie Clausen').isVisible(), 'booking name C');
    });

    await step('phone cancellation frees the slot, application stays (L1)', async () => {
        await slotCell(slots[2].id).getByRole('button', { name: 'Absage' }).click();
        await slotCell(slots[2].id).getByText('Frei').waitFor({ timeout: 20000 });
        const freed = (await appointments.repo.get(slots[2].id))!;
        assert(freed.state === 'available' && !freed.applicationId && !freed.nameCustomer && !freed.requestIp, `freed ${JSON.stringify(freed)}`);
        assert((await applications.get(appC))?.contactName === 'Familie Clausen', 'application lost');
        const publicSlots = await (await fetch(`${API}/procedures/${procedure.id}/appointments`)).json();
        assert(publicSlots.some((s: { id: string }) => s.id === slots[2].id), 'slot not public again');
    });

    await step('family arrived: application interview, appointment done (J4)', async () => {
        await slotCell(slots[0].id).getByRole('button', { name: 'Erschienen' }).click();
        await slotCell(slots[0].id).getByText('Gespräch angetreten').waitFor({ timeout: 20000 });
        assert((await applications.get(appA))?.state === 'interview', 'application state');
        assert((await appointments.repo.get(slots[0].id))?.state === 'done', 'appointment state');
    });

    await step('open from the day view, edit with autosave and comment (J3, J5, J6)', async () => {
        await slotCell(slots[0].id).getByRole('button', { name: 'Öffnen' }).click();
        await field('nachname').waitFor({ timeout: 20000 });
        await field('nachname').locator('input').fill('Adler-Schmidt');
        await page.getByLabel('Kommentar Sekretariat').fill('Geburtsurkunde fehlt');
        await page.getByTestId('save-status').getByText(/Gespeichert \d/).waitFor({ timeout: 20000 });
        await page.reload();
        await page.getByText('Angemeldet als').waitFor({ timeout: 20000 });
        await slotCell(slots[0].id).getByRole('button', { name: 'Öffnen' }).click();
        await field('nachname').waitFor({ timeout: 20000 });
        assert((await field('nachname').locator('input').inputValue()) === 'Adler-Schmidt', 'data lost after reload');
        assert((await page.getByLabel('Kommentar Sekretariat').inputValue()) === 'Geburtsurkunde fehlt', 'comment lost');
        const stored = (await applications.get(appA))!;
        assert(stored.childName === 'Adler-Schmidt' && stored.secretariatComment === 'Geburtsurkunde fehlt', 'stored');
    });

    await step('review flow up to the explicit SVWS release (K5)', async () => {
        await page.getByRole('button', { name: 'Prüfung beginnen' }).click();
        await page.getByTestId('application-state').getByText('In Prüfung').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Als geprüft markieren' }).click();
        await page.getByTestId('application-state').getByText('Geprüft').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Für SVWS freigeben' }).click();
        await page.getByTestId('application-state').getByText('Freigegeben für SVWS').waitFor({ timeout: 20000 });
        assert((await applications.get(appA))?.state === 'ready_for_svws', `state ${await state()}`);
        assert(!(await page.getByRole('button', { name: /freigeben|Prüfung|geprüft/ }).isVisible()), 'further transition offered');
    });

    await step('concurrent change is detected instead of overwritten', async () => {
        await applications.update(appA, { interviewerComment: 'von anderer Stelle geändert' });
        await page.getByLabel('Kommentar Sekretariat').fill('Geburtsurkunde liegt vor');
        await page.getByTestId('save-status').getByText('Konflikt').waitFor({ timeout: 20000 });
        assert((await applications.get(appA))?.secretariatComment === 'Geburtsurkunde fehlt', 'overwritten');
        await page.getByRole('button', { name: /Neu laden/ }).click();
        await page.getByTestId('save-status').getByText('Alles gespeichert').waitFor({ timeout: 20000 });
        assert((await page.getByLabel('Kommentar Gesprächsführung').inputValue()) === 'von anderer Stelle geändert', 'reload');
        await page.getByRole('button', { name: '← Zurück' }).click();
    });

    await step('name search finds the application after cancellation (K1, K2, K3)', async () => {
        await page.getByRole('navigation').getByRole('link', { name: 'Anmeldungen' }).click();
        await page.getByLabel('Suche').fill('clausen');
        const row = page.locator(`tr[data-id="${appC}"]`);
        await row.waitFor({ timeout: 20000 });
        assert((await page.locator('tbody tr[data-id]').count()) === 1, 'search not narrowing');
        await page.getByLabel('Suche').fill('ádler schmidt'); // accent and order insensitive
        await page.locator(`tr[data-id="${appA}"]`).waitFor();
        await page.getByLabel('Suche').fill('clausen');
        await row.getByRole('button', { name: 'Öffnen' }).click();
        await page.getByText('kein Termin').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: '← Zurück' }).click();
    });

    await step('status filter (K4)', async () => {
        await page.getByLabel('Suche').fill('');
        await page.getByRole('button', { name: /^Freigegeben für SVWS \(\d+\)$/ }).click();
        await page.locator(`tr[data-id="${appA}"]`).waitFor({ timeout: 10000 });
        assert(!(await page.locator(`tr[data-id="${appB}"]`).isVisible()), 'filter not applied');
        await page.getByRole('button', { name: /^Online abgeschickt \(\d+\)$/ }).click();
        await page.locator(`tr[data-id="${appB}"]`).waitFor({ timeout: 10000 });
    });

    await step('no console errors or warnings', async () => {
        // the 412 of the deliberate conflict above is expected
        const unexpected = problems.filter((p) => !p.includes('412'));
        assert(unexpected.length === 0, unexpected.join(' | '));
    });
} finally {
    await browser.close();
    stopSecretariat();
    server.kill();
    const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
    if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
    await site.deleteItems('appointments', slots.map((s) => s.id)).catch(() => {});
    await procedures.delete(procedure.id).catch(() => {});
    await forms.delete(form.id).catch(() => {});
    console.log('      test data removed');
}
process.exit(failureCount() ? 1 : 0);
