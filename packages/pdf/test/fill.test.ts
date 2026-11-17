// I1/I3: the template is filled from application data and yields a valid PDF.
import fs from 'node:fs';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import schoolForm from '../../forms/examples/anmeldung-klasse5.json' with { type: 'json' };
import laender from '../../forms/catalogs/laender.json' with { type: 'json' };
import sprachen from '../../forms/catalogs/sprachen.json' with { type: 'json' };
import staaten from '../../forms/catalogs/staatsangehoerigkeiten.json' with { type: 'json' };
import type { FormJson } from '../../forms/src/types.ts';
import { fillRegistrationPdf, templateFieldNames, templateFields } from '../src/fill.ts';
import { pdfValues } from '../src/values.ts';

const form = schoolForm as FormJson;
const template = fs.readFileSync(new URL('../templates/anmeldebogen.pdf', import.meta.url));
const font = fs.readFileSync(new URL('../fonts/DejaVuSans.ttf', import.meta.url));
const options = { 'laender.json': laender, 'sprachen.json': sprachen, 'staatsangehoerigkeiten.json': staaten };

export const sample = {
    nachname: 'Şahin',
    vorname: 'Łukasz',
    geschlecht: 'm',
    adresse: { strasse: 'Am Weg 1', plz: '52222', ort: 'Stolberg', ortsteil: 'Büsbach' },
    geburtsdatum: '2015-05-04',
    geburtsort: 'Kraków',
    geburtsland: 'PL',
    zuzugsdatum: '2019-08-01',
    herkunftssprache: 'PL',
    staatsangehoerigkeit: 'PL',
    religion: 'rk',
    religionsunterricht: 'kr',
    einschulungJahr: 2021,
    einschulungSchule: { name: 'GGS Nord', ort: 'Stolberg' },
    wiederholung: false,
    schulwechsel: true,
    weitereSchulen: [{ schule: { name: 'KGS Süd', ort: 'Eschweiler' }, von: 2023 }],
    foerderbedarf: true,
    foerderschwerpunkte: ['LE', 'SQ'],
    oepnv: true,
    schwerbehinderung: false,
    lrs: true,
    autismus: false,
    erziehungsberechtigter1: { rolle: 'mutter', nachname: 'Şahin', vorname: 'Ewa', abweichendeAdresse: false, telefonMobil: '0170 1234567', email: 'ewa@example.org' },
    zweiterErziehungsberechtigter: true,
    erziehungsberechtigter2: { rolle: 'vater', nachname: 'Şahin', vorname: 'Mehmet', abweichendeAdresse: true, adresse: { strasse: 'Hauptstr. 5', plz: '52066', ort: 'Aachen' } },
    sorgerechtGemeinsam: true,
    notfallkontakte: [{ name: 'Oma Gerda', beziehung: 'Großmutter', telefon: '02402 12345' }],
    mitschuelerWunsch: 'Mia',
    zustimmungBilder: true,
    zustimmungUnterrichtsausfall: false,
    zustimmungZecke: true,
    kenntnisVeraenderungen: true,
    kenntnisKlassenfahrt: true,
    kenntnisDatenschutz: true,
    kenntnisKrankmeldung: true,
    kenntnisInfektionsschutz: true,
    passfoto: { id: '7/0123456789abcdef0123456789abcdef.png', name: 'foto.png', contentType: 'image/png', size: 70 },
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('pdf values (I3)', () => {
    it('maps data to display values', () => {
        const { text } = pdfValues(form, sample, options);
        expect(text.get('geburtsdatum')).toBe('04.05.2015');
        expect(text.get('geburtsland')).toBe('Polen');
        expect(text.get('herkunftssprache')).toBe('Polnisch');
        expect(text.get('religion')).toBe('römisch-katholisch');
        expect(text.get('foerderschwerpunkte')).toBe('Lernen, Sprache');
        expect(text.get('erziehungsberechtigter1.rolle')).toBe('Mutter');
        expect(text.get('weitereSchulen[0].schule.name')).toBe('KGS Süd');
        expect(text.get('einschulungJahr')).toBe('2021');
    });
});

describe('fill template (I1)', () => {
    it('covers every template field with a form path or booking field', async () => {
        const names = await templateFieldNames(template);
        const unknown = names
            .map((n) => n.replace(/=.*$/, '').replace(/\[\d+\]/g, ''))
            .filter((n) => !n.startsWith('anmeldung.'))
            .filter((path) => {
                let items = form.sections.flatMap((s) => s.items);
                for (const part of path.split('.')) {
                    const item = items.find((i) => i.id === part);
                    if (!item) return true;
                    items = item.kind === 'group' ? form.groups![item.group].items : [];
                }
                return false;
            });
        expect(unknown).toEqual([]);
    });

    it('produces a valid PDF with text, Unicode and checkboxes set', async () => {
        const bytes = await fillRegistrationPdf({
            template,
            font,
            form,
            data: sample,
            options,
            extra: { 'anmeldung.termin': 'Mittwoch, 7. Oktober 2026, 09:20 Uhr', 'anmeldung.nummer': '42' },
            photo: PNG,
        });
        fs.mkdirSync(new URL('../test-output/', import.meta.url), { recursive: true });
        fs.writeFileSync(new URL('../test-output/anmeldebogen-filled.pdf', import.meta.url), bytes);

        const pdf = await PDFDocument.load(bytes);
        const acro = pdf.getForm();
        const text = (n: string) => (acro.getField(n) as PDFTextField).getText();
        const checked = (n: string) => (acro.getField(n) as PDFCheckBox).isChecked();
        expect(text('nachname')).toBe('Şahin');
        expect(text('vorname')).toBe('Łukasz');
        expect(text('geburtsland')).toBe('Polen');
        expect(text('erziehungsberechtigter2.adresse.ort')).toBe('Aachen');
        expect(text('anmeldung.termin')).toContain('7. Oktober 2026');
        expect(text('notfallkontakte[0].telefon')).toBe('02402 12345');
        expect(text('weitereSchulen[1].schule.name')).toBeUndefined();
        expect(checked('geschlecht=m')).toBe(true);
        expect(checked('geschlecht=w')).toBe(false);
        expect(checked('religionsunterricht=kr')).toBe(true);
        expect(checked('wiederholung=false')).toBe(true);
        expect(checked('wiederholung=true')).toBe(false);
        expect(checked('zustimmungUnterrichtsausfall=false')).toBe(true);
        expect(checked('kenntnisDatenschutz=true')).toBe(true);
        expect(pdf.getPageCount()).toBe(2);
        // the photo is drawn as the appearance of the photo button
        const photo = acro.getButton('passfoto');
        const widget = photo.acroField.getWidgets()[0];
        expect(widget.getNormalAppearance()).toBeDefined();
    });
});

describe('own PDF with an assignment of its field names', () => {
    /** A PDF as made in Word: arbitrary field names. */
    async function wordPdf(): Promise<Uint8Array> {
        const doc = await PDFDocument.create();
        const page = doc.addPage();
        const acro = doc.getForm();
        const box = { x: 20, y: 700, width: 100, height: 14 };
        for (const [i, name] of ['Kind_Nachname', 'Kind_Vorname', 'Schule1', 'Termin', 'Nicht_zugeordnet'].entries())
            acro.createTextField(name).addToPage(page, { ...box, y: 700 - i * 20 });
        for (const [i, name] of ['Maedchen', 'Maennlich', 'Bus_Ja'].entries()) acro.createCheckBox(name).addToPage(page, { ...box, width: 14, y: 560 - i * 20 });
        const radio = acro.createRadioGroup('Konfession');
        for (const [i, o] of ['römisch-katholisch', 'evangelisch'].entries()) radio.addOptionToPage(o, page, { ...box, width: 14, y: 480 - i * 20 });
        return doc.save();
    }

    const own: FormJson = {
        ...form,
        pdf: {
            asset: 'form-test.pdf',
            fields: {
                Kind_Nachname: 'nachname',
                Kind_Vorname: 'vorname',
                Schule1: 'weitereSchulen[0].schule.name',
                Termin: 'anmeldung.termin',
                Maedchen: 'geschlecht=w',
                Maennlich: 'geschlecht=m',
                Bus_Ja: 'oepnv',
                Konfession: 'religion',
            },
        },
    };

    it('lists the fields with their type', async () => {
        const fields = await templateFields(await wordPdf());
        expect(fields.find((f) => f.name === 'Kind_Nachname')?.type).toBe('text');
        expect(fields.find((f) => f.name === 'Maedchen')?.type).toBe('checkbox');
        expect(fields.find((f) => f.name === 'Konfession')).toEqual({ name: 'Konfession', type: 'radio', options: ['römisch-katholisch', 'evangelisch'] });
    });

    it('fills by the assignment; fields without one stay empty', async () => {
        const bytes = await fillRegistrationPdf({ template: await wordPdf(), font, form: own, data: sample, options, extra: { 'anmeldung.termin': 'Mi, 7.10.' } });
        const acro = (await PDFDocument.load(bytes)).getForm();
        expect(acro.getTextField('Kind_Nachname').getText()).toBe('Şahin');
        expect(acro.getTextField('Schule1').getText()).toBe('KGS Süd');
        expect(acro.getTextField('Termin').getText()).toBe('Mi, 7.10.');
        expect(acro.getTextField('Nicht_zugeordnet').getText()).toBeUndefined();
        expect(acro.getCheckBox('Maennlich').isChecked()).toBe(true);
        expect(acro.getCheckBox('Maedchen').isChecked()).toBe(false);
        expect(acro.getCheckBox('Bus_Ja').isChecked()).toBe(true);
        expect(acro.getRadioGroup('Konfession').getSelected()).toBe('römisch-katholisch');
    });

    it('does not use field names as data paths when an assignment exists', async () => {
        const doc = await PDFDocument.create();
        doc.getForm().createTextField('nachname').addToPage(doc.addPage(), { x: 20, y: 700, width: 100, height: 14 });
        const unassigned = { ...form, pdf: { asset: 'x.pdf', fields: {} } };
        const bytes = await fillRegistrationPdf({ template: await doc.save(), font, form: unassigned, data: sample, options });
        expect((await PDFDocument.load(bytes)).getForm().getTextField('nachname').getText()).toBeUndefined();
    });
});
