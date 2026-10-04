// Fills an AcroForm PDF template with application data in the browser or
// in Node (backlog I1, I3); no server round trip.
import fontkit from '@pdf-lib/fontkit';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import type { FormData, FormJson } from '@anmeldung/forms';
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
}

export async function fillRegistrationPdf(input: FillInput): Promise<Uint8Array> {
    const pdf = await PDFDocument.load(input.template);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(input.font, { subset: true });
    const values = pdfValues(input.form, input.data, input.options);
    const acroForm = pdf.getForm();

    for (const field of acroForm.getFields()) {
        const name = field.getName();
        if (field instanceof PDFCheckBox) {
            const at = name.lastIndexOf('=');
            if (at > 0 && isChecked(values.raw.get(name.slice(0, at)), name.slice(at + 1))) field.check();
        } else if (field instanceof PDFTextField) {
            const text = input.extra?.[name] ?? values.text.get(name);
            if (text !== undefined) field.setText(text);
        }
    }
    acroForm.updateFieldAppearances(font);
    return pdf.save();
}

/** Field names of a template, to check it against a form definition. */
export async function templateFieldNames(template: ArrayBuffer | Uint8Array): Promise<string[]> {
    const pdf = await PDFDocument.load(template);
    return pdf.getForm().getFields().map((f) => f.getName());
}
