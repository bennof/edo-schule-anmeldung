// C5: the school's registration form covers every merge field of the
// previous Word form (docs/reference/AnmeldungFormular.docx).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import form from '../examples/anmeldung-klasse5.json' with { type: 'json' };
import mapping from '../examples/anmeldung-klasse5.mergefields.json' with { type: 'json' };
import { initialData, validateForm, withoutHidden, type FormData } from '../src/runtime.ts';
import type { FormJson, Item } from '../src/types.ts';

const school = form as FormJson;

/** Resolves `a.b[0].c` / `a[*]` against the item tree; returns the item or undefined. */
function resolve(path: string): Item | undefined {
    let items: Item[] | undefined = school.sections.flatMap((s) => s.items);
    let found: Item | undefined;
    for (const part of path.replace(/\[(\d+|\*)\]/g, '').split('.')) {
        found = items?.find((i) => i.id === part);
        if (!found) return undefined;
        items = found.kind === 'group' ? school.groups?.[found.group]?.items : undefined;
    }
    return found;
}

describe('school registration form (C5)', () => {
    it('maps every merge field of the Word form', async () => {
        const docx = fs.readFileSync(new URL('../../../docs/reference/AnmeldungFormular.docx', import.meta.url));
        // the merge field names appear as plain text in word/document.xml (stored, deflated)
        const names = await mergeFieldNames(docx);
        expect(names.length).toBe(59);
        const missing = names.filter((n) => !(n in mapping.fields));
        expect(missing).toEqual([]);
    });

    it('maps only to existing items', () => {
        const broken = Object.entries(mapping.fields).filter(([, path]) => !resolve(path));
        expect(broken).toEqual([]);
    });

    it('reuses groups instead of duplicating fields', () => {
        expect(Object.keys(school.groups ?? {})).toEqual(['adresse', 'schule', 'schulbesuch', 'erziehungsberechtigter', 'notfallkontakt']);
        const groupItems = school.sections.flatMap((s) => s.items).filter((i) => i.kind === 'group');
        expect(groupItems.filter((g) => g.kind === 'group' && g.group === 'erziehungsberechtigter')).toHaveLength(2);
    });

    it('accepts a complete realistic registration', () => {
        const data: FormData = initialData(school);
        Object.assign(data, {
            nachname: 'Muster', vorname: 'Mia', geschlecht: 'w', geburtsdatum: '2015-05-04', geburtsort: 'Aachen',
            geburtsland: 'DE', herkunftssprache: 'DE', staatsangehoerigkeit: 'DE', religion: 'rk', religionsunterricht: 'kr',
            einschulungJahr: 2021, wiederholung: false, schulwechsel: false, foerderbedarf: false,
            schwerbehinderung: false, lrs: false, autismus: false, zweiterErziehungsberechtigter: false, sorgerechtGemeinsam: true,
            zustimmungBilder: true, zustimmungUnterrichtsausfall: true, zustimmungZecke: false,
            kenntnisVeraenderungen: true, kenntnisKlassenfahrt: true, kenntnisDatenschutz: true, kenntnisKrankmeldung: true, kenntnisInfektionsschutz: true,
        });
        Object.assign(data.adresse as FormData, { strasse: 'Weg 1', plz: '52222', ort: 'Stolberg' });
        Object.assign(data.einschulungSchule as FormData, { name: 'GGS Nord', ort: 'Stolberg' });
        Object.assign(data.erziehungsberechtigter1 as FormData, { rolle: 'mutter', nachname: 'Muster', vorname: 'Eva', abweichendeAdresse: false, telefonMobil: '0170 1234567' });
        expect(validateForm(school, data)).toEqual([]);

        // repeat group only while visible; acknowledgements are mandatory
        expect(withoutHidden(school, data).weitereSchulen).toBeUndefined();
        data.kenntnisDatenschutz = false;
        expect(validateForm(school, data).map((e) => e.path)).toEqual(['kenntnisDatenschutz']);
    });
});

/** Extracts MERGEFIELD names from a .docx without a zip library (deflate via node:zlib). */
async function mergeFieldNames(docx: Buffer): Promise<string[]> {
    const zlib = await import('node:zlib');
    // walk local file headers to find word/document.xml
    for (let i = 0; i < docx.length - 30; ) {
        if (docx.readUInt32LE(i) !== 0x04034b50) break;
        const method = docx.readUInt16LE(i + 8);
        const size = docx.readUInt32LE(i + 18);
        const nameLen = docx.readUInt16LE(i + 26);
        const extraLen = docx.readUInt16LE(i + 28);
        const name = docx.toString('utf8', i + 30, i + 30 + nameLen);
        const start = i + 30 + nameLen + extraLen;
        if (name === 'word/document.xml') {
            const raw = docx.subarray(start, start + size);
            const xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
            return [...new Set([...xml.matchAll(/MERGEFIELD\s+"?([^\s"\\<]+)/g)].map((m) => m[1]))].sort();
        }
        i = start + size;
    }
    throw new Error('word/document.xml not found');
}
