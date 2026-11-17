// Fills an AcroForm PDF template with application data in the browser or
// in Node (backlog I1, I3); no server round trip.
import fontkit from '@pdf-lib/fontkit';
import { PDFButton, PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { fileRefs, splitTarget, type FormData, type FormJson } from '@anmeldung/forms';
import { isChecked, pdfValues, type OptionLists } from './values.ts';

export interface FillInput {
    template: ArrayBuffer | Uint8Array;
    /** TrueType font for field values (Unicode names), e.g. DejaVuSans.ttf */
    font: ArrayBuffer | Uint8Array;
    form: FormJson;
    data: FormData;
    options?: OptionLists;
    /** values for fields that are not data paths, e.g. `anmeldung.termin` */
    extra?: Record<string, string>;
    /** JPEG/PNG bytes of the photo (file field with role "photo") */
    photo?: ArrayBuffer | Uint8Array;
}

/** Data path of the photo field (button field of the same name in the template). */
export function photoFieldPath(form: FormJson): string | undefined {
    const walk = (items: FormJson['sections'][number]['items'], base: string): string | undefined => {
        for (const item of items) {
            const path = base ? `${base}.${item.id}` : item.id;
            if (item.kind === 'field' && item.type === 'file' && item.role === 'photo') return path;
            if (item.kind === 'group' && !item.repeat) {
                const found = walk(form.groups?.[item.group]?.items ?? [], path);
                if (found) return found;
            }
        }
        return undefined;
    };
    return walk(form.sections.flatMap((s) => s.items), '');
}

/**
 * Fills the PDF with the data. With `FormJson.pdf` the field names are
 * translated by its assignment (fields without an assignment stay empty);
 * without it the field names are the data paths themselves (the standard
 * registration form).
 */
export async function fillRegistrationPdf(input: FillInput): Promise<Uint8Array> {
    const pdf = await PDFDocument.load(input.template);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(input.font, { subset: true });
    const values = pdfValues(input.form, input.data, input.options);
    const acroForm = pdf.getForm();
    const assigned = input.form.pdf?.fields;
    /** data target of a PDF field name */
    const targetOf = (name: string): string | undefined => (assigned ? assigned[name] : name);

    for (const field of acroForm.getFields()) {
        const target = targetOf(field.getName());
        if (!target) continue;
        const { path, value } = splitTarget(target);
        if (field instanceof PDFCheckBox) {
            // `path=value`: ticked for that value; a plain path: ticked when the value is true
            if (isChecked(values.raw.get(path), value ?? 'true')) field.check();
        } else if (field instanceof PDFTextField) {
            const text = input.extra?.[target] ?? values.text.get(path);
            if (text !== undefined) field.setText(text);
        } else if (field instanceof PDFRadioGroup) {
            const choice = field.getOptions().find((o) => o === values.raw.get(path) || o === values.text.get(path));
            if (choice) field.select(choice);
        } else if (field instanceof PDFDropdown) {
            const options = field.getOptions();
            const choice = options.find((o) => o === values.text.get(path) || o === values.raw.get(path));
            if (choice) field.select(choice);
            else if (field.isEditable() && values.text.has(path)) field.select(values.text.get(path)!);
        }
    }
    const photoPath = photoFieldPath(input.form);
    if (input.photo && photoPath && fileRefs(input.form, input.data, 'photo').length) {
        const button = acroForm.getFields().find((f) => targetOf(f.getName()) === photoPath);
        if (button instanceof PDFButton) {
            const bytes = new Uint8Array(input.photo);
            const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
            button.setImage(isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes));
        }
    }
    acroForm.updateFieldAppearances(font);
    return pdf.save();
}

export type PdfFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'button' | 'other';

export interface PdfFieldInfo {
    name: string;
    type: PdfFieldType;
    /** radio groups and dropdowns: the choices */
    options?: string[];
}

/** Fields of a PDF with their type, for the assignment in the secretariat. */
export async function templateFields(template: ArrayBuffer | Uint8Array): Promise<PdfFieldInfo[]> {
    const pdf = await PDFDocument.load(template);
    return pdf.getForm().getFields().map((f): PdfFieldInfo => {
        const name = f.getName();
        if (f instanceof PDFTextField) return { name, type: 'text' };
        if (f instanceof PDFCheckBox) return { name, type: 'checkbox' };
        if (f instanceof PDFRadioGroup) return { name, type: 'radio', options: f.getOptions() };
        if (f instanceof PDFDropdown) return { name, type: 'dropdown', options: f.getOptions() };
        if (f instanceof PDFButton) return { name, type: 'button' };
        return { name, type: 'other' };
    });
}

/** Field names of a template, to check it against a form definition. */
export async function templateFieldNames(template: ArrayBuffer | Uint8Array): Promise<string[]> {
    const pdf = await PDFDocument.load(template);
    return pdf.getForm().getFields().map((f) => f.getName());
}
