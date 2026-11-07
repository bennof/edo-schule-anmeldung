// Option lists for forms (e.g. laender.json) generated from SVWS catalogs
// and school tables: rows of an SVWS endpoint -> [{ key, value }].

export type SvwsRow = Record<string, unknown>;

export interface OptionListSource {
    id: string;
    label: string;
    /** path below /db/{schema} */
    path: string;
    /** suggested columns and file name */
    key: string;
    value: string;
    file?: string;
}

/** Fixed SVWS catalogs (same for every school). */
export const SVWS_CATALOGS: OptionListSource[] = [
    { id: 'nationalitaeten', label: 'Nationalitäten', path: '/schule/allgemein/nationalitaeten', key: 'iso2', value: 'bezeichnungSuche', file: 'laender.json' },
    { id: 'verkehrssprachen', label: 'Familiensprachen (Verkehrssprachen)', path: '/schule/allgemein/verkehrssprachen', key: 'iso2', value: 'bezeichnung', file: 'sprachen.json' },
];

/** School tables (maintained by the school in SVWS / SchILD-NRW). */
export const SVWS_TABLES: OptionListSource[] = [
    { id: 'religionen', label: 'Religionen', path: '/schule/religionen', key: 'kuerzel', value: 'bezeichnung' },
    { id: 'erzieherarten', label: 'Erzieherarten', path: '/schule/erzieherarten', key: 'id', value: 'bezeichnung' },
    { id: 'schulen', label: 'Schulen (z. B. Grundschulen)', path: '/schule/schulen', key: 'schulnummerStatistik', value: 'name' },
    { id: 'orte', label: 'Orte', path: '/orte', key: 'id', value: 'ortsname' },
    { id: 'ortsteile', label: 'Ortsteile', path: '/ortsteile', key: 'id', value: 'ortsteil' },
    { id: 'einwilligungsarten', label: 'Einwilligungsarten', path: '/schule/einwilligungsarten', key: 'schluessel', value: 'bezeichnung' },
    { id: 'vermerkarten', label: 'Vermerkarten', path: '/schule/vermerkarten', key: 'id', value: 'bezeichnung' },
];

/** Column names of the rows, in the order of the first row. */
export function columnsOf(rows: SvwsRow[]): string[] {
    const columns: string[] = [];
    for (const row of rows) for (const c of Object.keys(row)) if (!columns.includes(c)) columns.push(c);
    return columns;
}

const text = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

/**
 * Builds an option list: rows hidden in SVWS (istSichtbar false) or no longer
 * valid (gueltigBis before `year`) are left out, as are rows without key or
 * value; the first row wins for a duplicate key. Sorted by value.
 */
export function toOptionList(rows: SvwsRow[], key: string, value: string, year = new Date().getFullYear()): { key: string; value: string }[] {
    const seen = new Set<string>();
    const list: { key: string; value: string }[] = [];
    for (const row of rows) {
        if (row.istSichtbar === false) continue;
        if (typeof row.gueltigBis === 'number' && row.gueltigBis < year) continue;
        const k = text(row[key]);
        const v = text(row[value]);
        if (!k || !v || seen.has(k)) continue;
        seen.add(k);
        list.push({ key: k, value: v });
    }
    const collator = new Intl.Collator('de');
    return list.sort((a, b) => collator.compare(a.value, b.value));
}
