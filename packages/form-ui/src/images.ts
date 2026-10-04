// Prepares files for upload in the browser: the photo is scaled to passport
// size, other images are scaled down if they exceed the upload limit.
import type { FieldItem } from '@anmeldung/forms';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const PHOTO = { width: 600, height: 800, quality: 0.85 };
const LARGE_IMAGE = { width: 2400, height: 2400, quality: 0.85 };

export class UploadError extends Error {}

/** Returns the bytes to upload, or throws UploadError with a German message. */
export async function prepareUpload(file: File, field: FieldItem): Promise<{ blob: Blob; name: string }> {
    const accept = field.accept ?? ['application/pdf', 'image/jpeg', 'image/png'];
    if (!accept.includes(file.type as never)) {
        throw new UploadError(`Dateityp nicht erlaubt. Erlaubt: ${accept.map(label).join(', ')}`);
    }
    if (file.type.startsWith('image/') && (field.role === 'photo' || file.size > MAX_UPLOAD_BYTES)) {
        const size = field.role === 'photo' ? PHOTO : LARGE_IMAGE;
        const blob = await scale(file, size.width, size.height, size.quality);
        return { blob, name: file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg' };
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('Die Datei ist größer als 4 MB.');
    return { blob: file, name: file.name };
}

function label(type: string): string {
    return { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' }[type] ?? type;
}

/** Scales into the box (keeps the aspect ratio, never enlarges) as JPEG. */
async function scale(file: Blob, maxWidth: number, maxHeight: number, quality: number): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const factor = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; // transparent PNG areas
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new UploadError('Das Bild konnte nicht verarbeitet werden.');
    return blob;
}
