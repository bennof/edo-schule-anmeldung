// Generates option catalogs (key = ISO code, value = German name) from the
// ICU data built into Node, instead of maintaining long lists by hand.
// Usage: node packages/forms/scripts/generate-catalogs.ts
// Official SVWS/SchILD catalogs replace these in a later release.
import fs from 'node:fs';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pairs = [...LETTERS].flatMap((a) => [...LETTERS].map((b) => a + b));

// region codes ICU knows that are not countries/territories for our purpose
const NOT_COUNTRIES = new Set(['AC', 'CP', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'XA', 'XB', 'ZZ']);

const collator = new Intl.Collator('de');
type Option = { key: string; value: string };
const sorted = (list: Option[]) => list.sort((a, b) => collator.compare(a.value, b.value));

function catalog(type: 'region' | 'language', codes: string[]): Option[] {
    const seen = new Set<string>();
    const names = new Intl.DisplayNames('de', { type, fallback: 'none' });
    return sorted(
        codes.flatMap((code) => {
            const value = names.of(code);
            if (!value || value === code || seen.has(value)) return [];
            seen.add(value);
            return [{ key: code.toUpperCase(), value }];
        }),
    );
}

/** Deprecated codes (e.g. DD, YU) canonicalize to another code: skip them. */
const isCanonicalRegion = (code: string) => Intl.getCanonicalLocales(`und-${code}`)[0] === `und-${code}`;
const isCanonicalLanguage = (code: string) => Intl.getCanonicalLocales(code)[0] === code;

const countries = catalog('region', pairs.filter((c) => !NOT_COUNTRIES.has(c) && isCanonicalRegion(c)));
const nationalities = [...countries, { key: 'XX', value: 'staatenlos' }, { key: 'XU', value: 'ungeklärt' }];
const languages = catalog('language', pairs.map((c) => c.toLowerCase()).filter(isCanonicalLanguage));

const out = new URL('../catalogs/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
for (const [file, list] of [
    ['laender.json', countries],
    ['staatsangehoerigkeiten.json', nationalities],
    ['sprachen.json', languages],
] as const) {
    fs.writeFileSync(new URL(file, out), JSON.stringify(list, null, 1) + '\n');
    console.log(`${file}: ${list.length} entries`);
}
