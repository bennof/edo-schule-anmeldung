// Renders PDF pages to PNG for visual checks (development tool); form fields
// are drawn with their appearance, as when printed.
// Usage: node scripts/render-pdf.ts <file.pdf> <outdir> [scale]
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, outDir, scale = '1.3'] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
fs.mkdirSync(outDir, { recursive: true });
for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: Number(scale) });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport, annotationMode: 1 }).promise;
    fs.writeFileSync(`${outDir}/page-${n}.png`, canvas.toBuffer('image/png'));
}
console.log(`${doc.numPages} page(s) rendered to ${outDir}`);
