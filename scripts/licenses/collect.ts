// Third-party licenses of all release artifacts in one file:
//   JavaScript of the two SPAs (license-checker-rseidelsohn, production dependencies),
//   Rust crates of server and desktop app (cargo-about, per release target),
//   the PDF font (packages/pdf/fonts/LICENSE).
// Identical license texts are listed once with all components using them.
//   node scripts/licenses/collect.ts [output]   (default dist/THIRD_PARTY_LICENSES.txt)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? 'dist/THIRD_PARTY_LICENSES.txt';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version ?? /^version = "(.*)"/m.exec(fs.readFileSync('server/Cargo.toml', 'utf8'))?.[1];

/** where a component ends up in the release */
const PARTS = {
    public: 'Server (Anmeldeseite)',
    server: 'Server',
    secretariat: 'Desktop-App, Web-Zip',
    desktop: 'Desktop-App',
    font: 'Server, Desktop-App, Web-Zip',
};
type Part = keyof typeof PARTS;

interface Component {
    name: string;
    version: string;
    license: string;
    parts: Set<Part>;
}
interface Text {
    license: string;
    text: string;
    users: Set<string>;
}

// standard MIT text for packages that declare MIT but ship no license file
const MIT = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const components = new Map<string, Component>();
const texts = new Map<string, Text>();

function add(part: Part, name: string, ver: string, license: string, text: string | undefined): void {
    const id = `${name} ${ver}`;
    const c = components.get(id) ?? { name, version: ver, license, parts: new Set() };
    c.parts.add(part);
    components.set(id, c);
    if (!text?.trim()) throw new Error(`${id}: kein Lizenztext gefunden`);
    const norm = text.replace(/\s+/g, ' ').trim();
    const t = texts.get(norm) ?? { license, text: text.trim(), users: new Set() };
    t.users.add(id);
    texts.set(norm, t);
}

// JavaScript: production dependencies of the SPAs, own workspace packages excluded
const checker = path.resolve('node_modules/.bin/license-checker-rseidelsohn');
for (const part of ['public', 'secretariat'] as const) {
    const json = execFileSync(checker, ['--production', '--excludePrivatePackages', '--json', '--start', `apps/${part}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const [id, info] of Object.entries(JSON.parse(json) as Record<string, { licenses: string | string[]; licenseFile?: string; publisher?: string }>)) {
        const at = id.lastIndexOf('@');
        const file = info.licenseFile && /licen[cs]e|copying/i.test(path.basename(info.licenseFile)) ? info.licenseFile : undefined;
        const license = [info.licenses].flat().join(' OR ');
        const text = file ? fs.readFileSync(file, 'utf8') : license === 'MIT' && info.publisher ? MIT(info.publisher) : undefined;
        add(part, id.slice(0, at), id.slice(at + 1), license, text);
    }
}

// Rust: crates compiled into the release targets
const TARGETS: Record<'server' | 'desktop', string[]> = {
    server: ['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl'],
    desktop: ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin'],
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
for (const part of ['server', 'desktop'] as const) {
    const file = path.join(tmp, `${part}.json`);
    const args = ['about', 'generate', '--format', 'json', '--fail', '--locked', '-c', 'scripts/licenses/about.toml', '-m', `${part}/Cargo.toml`, '-o', file];
    for (const t of TARGETS[part]) args.push('--target', t);
    execFileSync('cargo', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    const about = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        licenses: { id: string; text: string; used_by: { crate: { name: string; version: string } }[] }[];
    };
    for (const l of about.licenses) for (const u of l.used_by) add(part, u.crate.name, u.crate.version, l.id, l.text);
}
fs.rmSync(tmp, { recursive: true });

// the PDF font, bundled as a file in both SPAs
add('font', 'DejaVu Sans (Schrift im PDF)', '2.37', 'Bitstream-Vera', fs.readFileSync('packages/pdf/fonts/LICENSE', 'utf8'));

// output
const rule = (title: string) => `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`;
const list = [...components.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const width = Math.min(40, Math.max(...list.map((c) => `${c.name} ${c.version}`.length)));
const lines = [
    `Anmeldesystem (edo-anmeldung) ${version}: Lizenzen der enthaltenen Fremdkomponenten`,
    '',
    'Das Anmeldesystem selbst steht unter der MIT-Lizenz (Datei LICENSE im Repository).',
    'Die Release-Dateien enthalten außerdem die folgenden Komponenten. Ihre Lizenztexte',
    'stehen unten; gleiche Texte sind zusammengefasst.',
    rule(`Komponenten (${list.length})`),
    ...list.map((c) => `${`${c.name} ${c.version}`.padEnd(width)}  ${c.license.padEnd(22)}  ${[...c.parts].map((p) => PARTS[p]).join('; ')}`),
    rule(`Lizenztexte (${texts.size})`),
];
const sorted = [...texts.values()].sort((a, b) => a.license.localeCompare(b.license) || b.users.size - a.users.size);
for (const t of sorted) {
    lines.push(`${'-'.repeat(78)}`, `${t.license}, verwendet von: ${[...t.users].sort().join(', ')}`, `${'-'.repeat(78)}`, '', t.text, '');
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n').replace(/[ \t]+$/gm, '') + '\n');
console.log(`${out}: ${list.length} Komponenten, ${texts.size} Lizenztexte`);
