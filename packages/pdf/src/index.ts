export { fillRegistrationPdf, templateFieldNames, type FillInput } from './fill.ts';
export { displayText, isChecked, pdfValues, type OptionLists, type PdfValues } from './values.ts';

/** Asset key of the registration form template. */
export const PDF_TEMPLATE_KEY = 'anmeldebogen.pdf';

/** Offers bytes as a file download in the browser. */
export function saveAs(bytes: Uint8Array, filename: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** File name like "Anmeldebogen_Sahin_Lukasz.pdf" (ASCII only). */
export function pdfFileName(childName: string | undefined): string {
    const ascii = (childName ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L')
        .replace(/ß/g, 'ss')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    return `Anmeldebogen${ascii ? `_${ascii}` : ''}.pdf`;
}
