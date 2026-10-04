// Builds the fixed registration form PDF (backlog I2): AcroForm fields named
// by data path, dense layout, boxes for handwriting when printed empty.
// Labels and options come from the school form definition.
// Usage: node packages/pdf/scripts/build-template.ts
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import { PDFDocument, rgb, type PDFFont, type PDFForm, type PDFPage } from 'pdf-lib';
import schoolForm from '../../forms/examples/anmeldung-klasse5.json' with { type: 'json' };
import type { FieldItem, FormJson, Item, Option } from '../../forms/src/types.ts';

const form = schoolForm as FormJson;
const A4 = { w: 595.28, h: 841.89 };
const M = 32; // margin
const W = A4.w - 2 * M;
const GRAY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.92, 0.93, 0.95);
const BORDER = rgb(0.55, 0.55, 0.55);
const LABEL = 6.5;
const BOX = 13;
const ROW = LABEL + 2 + BOX + 3;

/** Field definition by data path, e.g. `erziehungsberechtigter1.rolle`. */
function fieldAt(path: string): FieldItem {
    let items: Item[] = form.sections.flatMap((s) => s.items);
    const parts = path.replace(/\[\d+\]/g, '').split('.');
    for (const [i, part] of parts.entries()) {
        const item = items.find((x) => x.id === part);
        if (!item) throw new Error(`unknown path ${path}`);
        if (i === parts.length - 1) {
            if (item.kind !== 'field') throw new Error(`${path} is a group`);
            return item;
        }
        if (item.kind !== 'group') throw new Error(`${path}: ${part} is not a group`);
        items = form.groups![item.group].items;
    }
    throw new Error(`unknown path ${path}`);
}

type Cell =
    | { kind: 'text'; path: string; label?: string; w: number }
    | { kind: 'checks'; path: string; label?: string; w: number; options?: Option[] }
    | { kind: 'yesno'; path: string; label?: string; w: number };

class Layout {
    page!: PDFPage;
    y = 0;
    pageNo = 0;
    readonly pdf: PDFDocument;
    readonly acro: PDFForm;
    readonly font: PDFFont;
    readonly bold: PDFFont;

    constructor(pdf: PDFDocument, acro: PDFForm, font: PDFFont, bold: PDFFont) {
        this.pdf = pdf;
        this.acro = acro;
        this.font = font;
        this.bold = bold;
        this.newPage();
    }

    newPage(): void {
        this.page = this.pdf.addPage([A4.w, A4.h]);
        this.pageNo++;
        this.y = A4.h - M;
        this.page.drawText(`${form.title} – Seite ${this.pageNo}`, { x: M, y: M / 2, size: 6.5, font: this.font, color: GRAY });
    }

    ensure(height: number): void {
        if (this.y - height < M) this.newPage();
    }

    title(text: string): void {
        this.page.drawText(text, { x: M, y: this.y - 14, size: 14, font: this.bold });
        this.y -= 22;
    }

    heading(text: string): void {
        this.ensure(16 + ROW);
        this.page.drawRectangle({ x: M, y: this.y - 13, width: W, height: 13, color: LIGHT });
        this.page.drawText(text, { x: M + 4, y: this.y - 9.5, size: 9, font: this.bold });
        this.y -= 17;
    }

    /** One row of cells; widths are fractions of the content width. */
    row(cells: Cell[]): void {
        this.ensure(ROW);
        let x = M;
        for (const cell of cells) {
            const width = cell.w * W - 4;
            const field = fieldAt(cell.path);
            const label = cell.label ?? field.label;
            this.page.drawText(this.fit(label, LABEL, width), { x, y: this.y - LABEL, size: LABEL, font: this.font, color: GRAY });
            const boxY = this.y - LABEL - 2 - BOX;
            if (cell.kind === 'text') {
                const tf = this.acro.createTextField(cell.path);
                tf.addToPage(this.page, { x, y: boxY, width, height: BOX, borderWidth: 0.5, borderColor: BORDER, font: this.font });
                tf.setFontSize(8);
            } else {
                const options =
                    cell.kind === 'yesno'
                        ? [
                              { key: 'true', value: 'Ja' },
                              { key: 'false', value: 'Nein' },
                          ]
                        : (cell.options ?? field.options ?? []);
                let cx = x;
                for (const o of options) {
                    const cb = this.acro.createCheckBox(`${cell.path}=${o.key}`);
                    cb.addToPage(this.page, { x: cx, y: boxY + 3, width: 8, height: 8, borderWidth: 0.5, borderColor: BORDER });
                    this.page.drawText(o.value, { x: cx + 10, y: boxY + 4.5, size: 7, font: this.font });
                    cx += 10 + this.font.widthOfTextAtSize(o.value, 7) + 8;
                }
            }
            x += cell.w * W;
        }
        this.y -= ROW;
    }

    /** Wrapped text; returns nothing, moves the cursor. */
    paragraph(text: string, size = 7.5, indent = 0, font = this.font): void {
        for (const line of this.wrap(text, size, W - indent, font)) {
            this.ensure(size + 3);
            this.page.drawText(line, { x: M + indent, y: this.y - size, size, font });
            this.y -= size + 2.5;
        }
    }

    /** Acknowledgement: checkbox in front of the wrapped label. */
    acknowledgement(path: string): void {
        const field = fieldAt(path);
        const lines = this.wrap(field.label, 7.5, W - 16, this.font);
        this.ensure(lines.length * 10 + 4);
        const cb = this.acro.createCheckBox(`${path}=true`);
        cb.addToPage(this.page, { x: M, y: this.y - 9, width: 8, height: 8, borderWidth: 0.5, borderColor: BORDER });
        for (const line of lines) {
            this.page.drawText(line, { x: M + 14, y: this.y - 7.5, size: 7.5, font: this.font });
            this.y -= 10;
        }
        this.y -= 3;
    }

    /** Consent question with Ja/Nein boxes. */
    consent(path: string): void {
        const field = fieldAt(path);
        this.paragraph(field.label, 7.5, 0, this.bold);
        if (field.help) this.paragraph(field.help, 6.5);
        this.ensure(14);
        let x = M;
        for (const [key, label] of [
            ['true', 'Ja'],
            ['false', 'Nein'],
        ]) {
            const cb = this.acro.createCheckBox(`${path}=${key}`);
            cb.addToPage(this.page, { x, y: this.y - 10, width: 8, height: 8, borderWidth: 0.5, borderColor: BORDER });
            this.page.drawText(label, { x: x + 10, y: this.y - 8.5, size: 7.5, font: this.font });
            x += 50;
        }
        this.y -= 16;
    }

    signatures(labels: string[]): void {
        this.ensure(40);
        this.y -= 26;
        const w = W / labels.length;
        labels.forEach((label, i) => {
            const x = M + i * w;
            this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w - 12, y: this.y }, thickness: 0.5, color: BORDER });
            this.page.drawText(label, { x, y: this.y - 8, size: 6.5, font: this.font, color: GRAY });
        });
        this.y -= 16;
    }

    gap(h = 4): void {
        this.y -= h;
    }

    private fit(text: string, size: number, width: number): string {
        if (this.font.widthOfTextAtSize(text, size) <= width) return text;
        let t = text;
        while (t.length > 1 && this.font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
        return `${t}…`;
    }

    private wrap(text: string, size: number, width: number, font: PDFFont): string[] {
        const lines: string[] = [];
        for (const paragraph of text.split('\n')) {
            let line = '';
            for (const word of paragraph.split(/\s+/)) {
                const next = line ? `${line} ${word}` : word;
                if (font.widthOfTextAtSize(next, size) > width && line) {
                    lines.push(line);
                    line = word;
                } else line = next;
            }
            lines.push(line);
        }
        return lines;
    }
}

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(fs.readFileSync(new URL('../fonts/DejaVuSans.ttf', import.meta.url)), { subset: true });
const bold = await pdf.embedFont(fs.readFileSync(new URL('../fonts/DejaVuSans-Bold.ttf', import.meta.url)), { subset: true });
pdf.setTitle(`Anmeldebogen – ${form.title}`);
const acro = pdf.getForm();
const l = new Layout(pdf, acro, font, bold);

l.title(`Anmeldebogen · ${form.title}`);
// booking data, filled by the application (not data paths)
for (const [name, label, x, w] of [
    ['anmeldung.termin', 'Termin', M, 0.4],
    ['anmeldung.nummer', 'Anmelde-Nr.', M + 0.42 * W, 0.18],
    ['anmeldung.kontakt', 'Kontakt (Buchung)', M + 0.62 * W, 0.38],
] as const) {
    l.page.drawText(label, { x, y: l.y - LABEL, size: LABEL, font, color: GRAY });
    const tf = acro.createTextField(name);
    tf.addToPage(l.page, { x, y: l.y - LABEL - 2 - BOX, width: w * W - 4, height: BOX, borderWidth: 0.5, borderColor: BORDER, font });
    tf.setFontSize(8);
}
l.y -= ROW + 4;

const t = (path: string, w: number, label?: string): Cell => ({ kind: 'text', path, w, label });
const yn = (path: string, w: number, label?: string): Cell => ({ kind: 'yesno', path, w, label });
const ch = (path: string, w: number, label?: string): Cell => ({ kind: 'checks', path, w, label });

l.heading('1. Personalien Schülerin / Schüler');
l.row([t('nachname', 0.3), t('vorname', 0.3), t('rufname', 0.2), t('geburtsdatum', 0.2)]);
l.row([ch('geschlecht', 0.4), t('geburtsort', 0.3), t('geburtsland', 0.3)]);
l.row([t('adresse.strasse', 0.4), t('adresse.plz', 0.12), t('adresse.ort', 0.28), t('adresse.ortsteil', 0.2)]);
l.row([t('staatsangehoerigkeit', 0.3), t('herkunftssprache', 0.3, 'Herkunftssprache'), t('zuzugsdatum', 0.2, 'In Deutschland seit'), t('religion', 0.2)]);
l.row([ch('religionsunterricht', 1, 'Teilnahme am verpflichtenden Unterricht (Wechsel nur zum Schuljahresende)')]);

l.heading('2. Bisherige Schullaufbahn');
l.row([t('einschulungJahr', 0.15, 'Einschulung (Jahr)'), t('einschulungSchule.name', 0.5, 'Grundschule bei Einschulung'), t('einschulungSchule.ort', 0.35, 'Ort')]);
l.row([yn('wiederholung', 0.3, 'Schuljahr wiederholt?'), t('wiederholteKlassen', 0.2, 'Welche Klasse'), yn('schulwechsel', 0.5, 'Grundschule gewechselt?')]);
for (const i of [0, 1]) {
    l.row([
        t(`weitereSchulen[${i}].schule.name`, 0.45, `${i + 1}. weitere Grundschule`),
        t(`weitereSchulen[${i}].schule.ort`, 0.25, 'Ort'),
        t(`weitereSchulen[${i}].von`, 0.15, 'von'),
        t(`weitereSchulen[${i}].bis`, 0.15, 'bis'),
    ]);
}

l.heading('3. Förderbedarf');
l.row([yn('foerderbedarf', 0.3, 'Sonderpädagogischer Förderbedarf?'), t('foerderschwerpunkte', 0.7)]);
l.row([t('hilfsmittel', 0.7, 'Besondere Hilfsmittel (z. B. Schulbegleitung)'), yn('oepnv', 0.3, 'Öffentliche Verkehrsmittel möglich?')]);
l.row([yn('schwerbehinderung', 0.33, 'Schwerbehinderung?'), yn('lrs', 0.33, 'Attestierte LRS?'), yn('autismus', 0.34, 'Attestierte Autismus-Spektrum-Störung?')]);

l.heading('4. Eltern / Erziehungsberechtigte');
const both = (attr: string, label: string, kind: 'text' | 'yesno' = 'text', split?: [string, string, number]): Cell[] =>
    [1, 2].flatMap((n): Cell[] => {
        const base = `erziehungsberechtigter${n}`;
        if (split) return [t(`${base}.${split[0]}`, 0.5 * split[2], `${n}. ${label}`), t(`${base}.${split[1]}`, 0.5 * (1 - split[2]), 'Ort')];
        return [kind === 'yesno' ? yn(`${base}.${attr}`, 0.5, `${n}. ${label}`) : t(`${base}.${attr}`, 0.5, `${n}. ${label}`)];
    });
l.row(both('rolle', 'Rolle'));
l.row([1, 2].flatMap((n): Cell[] => [t(`erziehungsberechtigter${n}.nachname`, 0.25, `${n}. Name`), t(`erziehungsberechtigter${n}.vorname`, 0.25, 'Vorname')]));
l.row(both('abweichendeAdresse', 'Andere Adresse als das Kind?', 'yesno'));
l.row(both('adresse.strasse', 'Straße, Hausnummer (falls abweichend)'));
l.row([1, 2].flatMap((n): Cell[] => [t(`erziehungsberechtigter${n}.adresse.plz`, 0.12, `${n}. PLZ`), t(`erziehungsberechtigter${n}.adresse.ort`, 0.38, 'Ort')]));
l.row(both('geburtsland', 'Geburtsland'));
l.row([1, 2].flatMap((n): Cell[] => [t(`erziehungsberechtigter${n}.telefonFestnetz`, 0.25, `${n}. Telefon Festnetz`), t(`erziehungsberechtigter${n}.telefonMobil`, 0.25, 'Telefon mobil')]));
l.row(both('email', 'E-Mail'));
l.row([yn('sorgerechtGemeinsam', 1, 'Sind beide Elternteile erziehungsberechtigt?')]);

l.heading('5. Erreichbarkeit im Notfall (weitere Personen)');
for (const i of [0, 1]) {
    l.row([t(`notfallkontakte[${i}].name`, 0.4, 'Name'), t(`notfallkontakte[${i}].beziehung`, 0.3, 'Beziehung zum Kind'), t(`notfallkontakte[${i}].telefon`, 0.3, 'Telefon')]);
}

l.heading('6. Wünsche zur Klassenzusammensetzung (ohne Gewähr)');
l.row([t('mitschuelerWunsch', 0.5, 'Gemeinsam in eine Klasse mit (ein Name)'), t('mitschuelerNichtWunsch', 0.5, 'Auf keinen Fall in eine Klasse mit')]);

l.newPage();
l.heading('7. Einverständniserklärungen');
for (const p of ['zustimmungBilder', 'zustimmungUnterrichtsausfall', 'zustimmungZecke']) l.consent(p);

l.heading('8. Kenntnisnahmen');
for (const p of ['kenntnisVeraenderungen', 'kenntnisKlassenfahrt', 'kenntnisDatenschutz', 'kenntnisKrankmeldung', 'kenntnisInfektionsschutz']) {
    l.acknowledgement(p);
}
l.gap(4);
l.paragraph(
    'Die vollständigen Informationsschreiben (Datenschutz nach Art. 13 DS-GVO, Belehrung nach § 34 Abs. 5 IfSG, Veränderungsmitteilung) liegen im Sekretariat aus und stehen auf der Homepage der Schule.',
    6.5,
);
l.gap(6);
l.paragraph('Mit unserer Unterschrift bestätigen wir die Richtigkeit der Angaben und die oben gemachten Erklärungen.', 7.5, 0, bold);
l.signatures(['Ort, Datum', 'Unterschrift 1. Erziehungsberechtigte/r', 'Unterschrift 2. Erziehungsberechtigte/r']);

const out = new URL('../templates/anmeldebogen.pdf', import.meta.url);
fs.writeFileSync(out, await pdf.save());
console.log(`templates/anmeldebogen.pdf: ${pdf.getPageCount()} pages, ${acro.getFields().length} fields`);
