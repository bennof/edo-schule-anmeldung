// Form renderer in the preview of the public SPA (test form, no backend).
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, it } from 'vitest';
import { launch, startDevServer, URLS, watchConsole } from '../support/browser.ts';

let stop = () => {};
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let page: Page;
let problems: string[] = [];
const field = (path: string) => page.locator(`[data-path="${path}"]`);

beforeAll(async () => {
    stop = await startDevServer('public');
    browser = await launch();
    page = await browser.newPage();
    problems = watchConsole(page);
    await page.goto(`${URLS.public}/#vorschau`);
});

afterAll(async () => {
    await browser?.close();
    stop();
});

it('renders all sections of the test form', async () => {
    await page.getByRole('heading', { name: 'Angaben zum Kind' }).waitFor();
    assert(await page.getByRole('heading', { name: 'Bisherige Schullaufbahn' }).isVisible(), 'section missing');
    assert(!(await field('sorgeberechtigter2').isVisible()), 'conditional group visible initially');
});

it('shows required errors after submit attempt', async () => {
    assert((await page.getByText('Pflichtfeld').count()) === 0, 'errors shown before submit');
    await page.getByRole('button', { name: 'Prüfen' }).click();
    assert((await page.getByText('Pflichtfeld').count()) === 7, `expected 7 required errors, got ${await page.getByText('Pflichtfeld').count()}`);
});

it('fills text, date, select, multiselect and nested groups', async () => {
    await field('nachname').locator('input').fill('Muster');
    await field('geburtsdatum').locator('input').fill('2015-04-01');
    await field('geschlecht').locator('select').selectOption('w');
    await field('sprachen').getByLabel('Englisch').check();
    await field('adresse.strasse').locator('input').fill('Weg 1');
    await field('adresse.plz').locator('input').fill('1234');
    await field('adresse.ort').locator('input').fill('Stadt');
    await field('sorgeberechtigter1.nachname').locator('input').fill('Muster');
    await field('sorgeberechtigter1.vorname').locator('input').fill('Eva');
    assert(await field('adresse.plz').getByText('Ungültiges Format').isVisible(), 'pattern error missing');
    await field('adresse.plz').locator('input').fill('12345');
    assert((await page.getByText('Pflichtfeld').count()) === 0, 'required errors remain');
});

it('conditional field inside group (Ja/Nein)', async () => {
    await field('sorgeberechtigter1.andereAdresse').getByLabel('Ja').check();
    await field('sorgeberechtigter1.adresse.strasse').waitFor();
    await field('sorgeberechtigter1.andereAdresse').getByLabel('Nein').check();
    assert(!(await field('sorgeberechtigter1.adresse').isVisible()), 'nested address still visible');
});

it('copies guardian 1 into guardian 2 once', async () => {
    await field('zweiterSorgeberechtigter').getByLabel('Ja').check();
    await page.getByRole('button', { name: /Angaben von „1\. Sorgeberechtigte Person“ übernehmen/ }).click();
    assert((await field('sorgeberechtigter2.nachname').locator('input').inputValue()) === 'Muster', 'not copied');
    await field('sorgeberechtigter2.vorname').locator('input').fill('Max');
    assert((await field('sorgeberechtigter1.vorname').locator('input').inputValue()) === 'Eva', 'copy is linked');
});

it('repeat group: add, limit fields, remove', async () => {
    await page.getByRole('button', { name: 'Schule hinzufügen' }).click();
    await field('schulen[1]').waitFor();
    await field('schulen[1].von').locator('input').fill('1999');
    await field('schulen[1].von').locator('input').blur();
    assert(await field('schulen[1].von').getByText('Mindestens 2010').isVisible(), 'min error missing');
    await field('schulen[1]').getByRole('button', { name: 'Eintrag entfernen' }).click();
    assert(!(await field('schulen[1]').isVisible()), 'entry not removed');
    assert((await page.getByRole('button', { name: 'Eintrag entfernen' }).count()) === 0, 'minItems not respected');
});

it('searchable select', async () => {
    await field('schulen[0].schule').locator('input').fill('park');
    await page.getByRole('option', { name: 'Grundschule am Park' }).click();
    assert(await field('schulen[0].schule').getByText('Grundschule am Park').isVisible(), 'selection not shown');
    await field('schulen[0].von').locator('input').fill('2021');
});

it('conditional required field (requiredIf)', async () => {
    await field('foerderbedarf').locator('select').selectOption('ja');
    await field('foerderschwerpunkt').getByText('Pflichtfeld').waitFor();
    await field('foerderschwerpunkt').locator('input').fill('Sprache');
});

it('valid submission returns clean data', async () => {
    await page.getByRole('button', { name: 'Prüfen' }).click();
    const data = JSON.parse((await page.getByTestId('result').textContent()) ?? '{}');
    assert(data.nachname === 'Muster' && data.geburtsdatum === '2015-04-01', 'basic values');
    assert(JSON.stringify(data.sprachen) === '["en"]', `multiselect ${JSON.stringify(data.sprachen)}`);
    assert(data.schulen.length === 1 && data.schulen[0].schule === 'gs-am-park' && data.schulen[0].von === 2021, 'repeat data');
    assert(data.sorgeberechtigter2.vorname === 'Max' && data.sorgeberechtigter1.adresse === undefined, 'group data');
    assert(data.foerderschwerpunkt === 'Sprache', 'conditional value');
});

it('no console errors or warnings', async () => {
    assert(problems.length === 0, problems.join(' | '));
});
