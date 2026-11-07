// A registration day in the secretariat. Three families book via the public
// API (two submit the form), then the secretariat works the day: day view,
// phone cancellation, "arrived", editing with autosave and comments, review up
// to the SVWS release, conflict detection, name search, status filter.
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import type { Application, Appointment, FormDefinition, Procedure } from '../../packages/domain/src/index.ts';
import testForm from '../../packages/forms/examples/test-form.json' with { type: 'json' };
import { AppointmentService, Repository } from '../../packages/sharepoint/src/index.ts';
import { confirmDialog, launch, signIn, startApiServer, startDevServer, URLS, watchConsole, type ApiServer } from '../support/browser.ts';
import { day, env, testSite } from '../support/env.ts';

const site = testSite();
const forms = new Repository<FormDefinition>(site, 'forms');
const procedures = new Repository<Procedure>(site, 'procedures');
const applications = new Repository<Application>(site, 'applications');
const appointments = new AppointmentService(site);

const testDay = day(5);
const tag = `E2E Tag ${Date.now()}`;

let form: FormDefinition | undefined;
let procedure: Procedure | undefined;
let slots: Appointment[] = [];
let server: ApiServer | undefined;
let stopSecretariat = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];
let appA = '';
let appB = '';
let appC = '';
const field = (path: string) => page.locator(`[data-path="${path}"]`);
const slotCell = (id: string) => page.locator(`td[data-id="${id}"]`);

async function bookAndMaybeSubmit(slotId: string, family: string, child?: string): Promise<string> {
    const api = server!.api;
    const res = await fetch(`${api}/appointments/${slotId}/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Familie ${family}`, email: `${family.toLowerCase()}@example.org` }),
    });
    const booking = await res.json();
    assert(res.ok && booking.applicationId, `booking failed: ${res.status}`);
    if (child) {
        const auth = { Authorization: `Bearer ${booking.token}`, 'Content-Type': 'application/json' };
        await fetch(`${api}/applications/${booking.applicationId}/start`, { method: 'POST', headers: auth });
        const sub = await fetch(`${api}/applications/${booking.applicationId}/submit`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ data: { nachname: child, geburtsdatum: '2015-04-01', sorgeberechtigter1: { nachname: family, vorname: 'Eva' } } }),
        });
        assert(sub.ok, `submit failed: ${sub.status}`);
    }
    return booking.applicationId;
}

beforeAll(async () => {
    form = await forms.create({ formJson: testForm, dateLastUpdate: new Date().toISOString() });
    procedure = await procedures.create({ formId: form.id, info: { title: tag }, startDate: day(-1), endDate: day(20) });
    slots = await appointments.createDrafts([
        { procedureId: procedure.id, datetime: `${testDay}T09:00`, state: 'draft', verantwortlicherId: 'Raum 1' },
        { procedureId: procedure.id, datetime: `${testDay}T09:00`, state: 'draft', verantwortlicherId: 'Raum 2' },
        { procedureId: procedure.id, datetime: `${testDay}T09:20`, state: 'draft', verantwortlicherId: 'Raum 1' },
    ]);
    await appointments.publish(slots.map((s) => s.id));
    server = await startApiServer();
    appA = await bookAndMaybeSubmit(slots[0].id, 'Adler', 'Adler');
    appB = await bookAndMaybeSubmit(slots[1].id, 'Berg', 'Berg');
    appC = await bookAndMaybeSubmit(slots[2].id, 'Clausen');

    stopSecretariat = await startDevServer('secretariat');
    browser = await launch();
    page = await browser.newPage();
    problems = watchConsole(page);
    await page.goto(`${URLS.secretariat}/#tag/${testDay}`);
    await signIn(page, env.APP_TEST_USER, env.APP_TEST_USER_PWD);
});

afterAll(async () => {
    await browser?.close();
    stopSecretariat();
    server?.stop();
    if (procedure) {
        const apps = await site.listItems('applications', `fields/ProcedureId eq '${procedure.id}'`).catch(() => []);
        for (const a of apps) await site.deleteUploads(a.id).catch(() => {});
        if (apps.length) await site.deleteItems('applications', apps.map((a) => a.id)).catch(() => {});
        await procedures.delete(procedure.id).catch(() => {});
    }
    if (slots.length) await site.deleteItems('appointments', slots.map((s) => s.id)).catch(() => {});
    if (form) await forms.delete(form.id).catch(() => {});
});

it('day view shows parallel slots with appointment and application state', async () => {
    await page.getByRole('heading', { name: 'Tagesansicht' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Datum').fill(testDay);
    await page.getByRole('columnheader', { name: 'Raum 2' }).waitFor({ timeout: 20000 });
    assert(await slotCell(slots[0].id).getByText('Adler').first().isVisible(), 'child A');
    assert(await slotCell(slots[1].id).getByText('Online abgeschickt').isVisible(), 'application state B');
    assert(await slotCell(slots[2].id).getByText('Familie Clausen').isVisible(), 'booking name C');
});

it('phone cancellation frees the slot, application stays', async () => {
    await slotCell(slots[2].id).getByRole('button', { name: 'Absage' }).click();
    await confirmDialog(page);
    await slotCell(slots[2].id).getByText('Frei').waitFor({ timeout: 20000 });
    const freed = (await appointments.repo.get(slots[2].id))!;
    assert(freed.state === 'available' && !freed.applicationId && !freed.nameCustomer && !freed.requestIp, `freed ${JSON.stringify(freed)}`);
    assert((await applications.get(appC))?.contactName === 'Familie Clausen', 'application lost');
    const publicSlots = await (await fetch(`${server!.api}/procedures/${procedure!.id}/appointments`)).json();
    assert(
        publicSlots.some((s: { id: string }) => s.id === slots[2].id),
        'slot not public again',
    );
});

it('family arrived: application interview, appointment done', async () => {
    await slotCell(slots[0].id).getByRole('button', { name: 'Erschienen' }).click();
    await slotCell(slots[0].id).getByText('Gespräch angetreten').waitFor({ timeout: 20000 });
    assert((await applications.get(appA))?.state === 'interview', 'application state');
    assert((await appointments.repo.get(slots[0].id))?.state === 'done', 'appointment state');
});

it('open from the day view, edit with autosave and comment', async () => {
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

it('review flow up to the explicit SVWS release', async () => {
    await page.getByRole('button', { name: 'Prüfung beginnen' }).click();
    await page.getByTestId('application-state').getByText('In Prüfung').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Als geprüft markieren' }).click();
    await page.getByTestId('application-state').getByText('Geprüft').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Für SVWS freigeben' }).click();
    await confirmDialog(page);
    await page.getByTestId('application-state').getByText('Freigegeben für SVWS').waitFor({ timeout: 20000 });
    assert((await applications.get(appA))?.state === 'ready_for_svws', `state ${await page.getByTestId('application-state').textContent()}`);
    assert(!(await page.getByRole('button', { name: /freigeben|Prüfung|geprüft/ }).isVisible()), 'further transition offered');
});

it('concurrent change is detected instead of overwritten', async () => {
    await applications.update(appA, { interviewerComment: 'von anderer Stelle geändert' });
    await page.getByLabel('Kommentar Sekretariat').fill('Geburtsurkunde liegt vor');
    await page.getByTestId('save-status').getByText('Konflikt').waitFor({ timeout: 20000 });
    assert((await applications.get(appA))?.secretariatComment === 'Geburtsurkunde fehlt', 'overwritten');
    await page.getByRole('button', { name: /Neu laden/ }).click();
    await page.getByTestId('save-status').getByText('Alles gespeichert').waitFor({ timeout: 20000 });
    assert((await page.getByLabel('Kommentar Gesprächsführung').inputValue()) === 'von anderer Stelle geändert', 'reload');
    await page.getByRole('button', { name: '← Zurück' }).click();
});

it('name search finds the application after cancellation', async () => {
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

it('status filter', async () => {
    await page.getByLabel('Suche').fill('');
    await page.getByRole('button', { name: /^Freigegeben für SVWS \(\d+\)$/ }).click();
    await page.locator(`tr[data-id="${appA}"]`).waitFor({ timeout: 10000 });
    assert(!(await page.locator(`tr[data-id="${appB}"]`).isVisible()), 'filter not applied');
    await page.getByRole('button', { name: /^Online abgeschickt \(\d+\)$/ }).click();
    await page.locator(`tr[data-id="${appB}"]`).waitFor({ timeout: 10000 });
});

it('no console errors or warnings', async () => {
    // the 412 of the deliberate conflict above is expected
    const unexpected = problems.filter((p) => !p.includes('412'));
    assert(unexpected.length === 0, unexpected.join(' | '));
});
