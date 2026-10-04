// Application data (school registration form) -> SVWS records (backlog
// Future: SVWS adapter, mapping). Pure function; everything that cannot be
// assigned becomes a warning instead of an error, so the secretariat can
// complete it in SVWS/SchILD-NRW.
//
// Field ids follow packages/forms/examples/anmeldung-klasse5.json.
import type { SvwsCatalogs } from './catalogs.ts';

type Data = Record<string, any>;

export interface SvwsRecords {
    /** POST /schueler/create */
    neu: Record<string, unknown>;
    /** PATCH /schueler/{id}/stammdaten (without the photo) */
    stammdaten: Record<string, unknown>;
    /** POST /schueler/erzieher/new/{id}/{1|2} */
    erzieher: Record<string, unknown>[];
    warnings: string[];
}

/** SVWS Geschlecht ids (svws-asd de.svws_nrw.asd.types.Geschlecht). */
const GESCHLECHT: Record<string, number> = { m: 3, w: 4, d: 5, x: 6 };

/** Form keys -> SVWS religion short codes (svws-asd Religion.json). */
const RELIGION: Record<string, string> = { rk: 'KR', ev: 'ER', isl: 'IR', alevit: 'AR', jued: 'HR', orth: 'XO', sonst: 'XR', keine: 'OH' };

/** Form roles -> SVWS Erzieherart labels. */
const ERZIEHERART: Record<string, string> = {
    mutter: 'Mutter',
    vater: 'Vater',
    pflegemutter: 'Pflegeeltern (Vollzeitpflege)',
    pflegevater: 'Pflegeeltern (Vollzeitpflege)',
    vormund: 'Sonstige',
    sonstige: 'Sonstige',
};
const ANREDE: Record<string, string> = { mutter: 'Frau', pflegemutter: 'Frau', vater: 'Herr', pflegevater: 'Herr' };

/** Our catalogs use ISO alpha-2 plus XX (stateless) and XU (unclear). */
const NATIONALITY_SPECIAL: Record<string, string> = { XX: 'XXA', XU: 'XXB' };

/** "Am Weg 12a" -> street, number, suffix */
export function splitStreet(value: string): { strassenname: string; hausnummer: string | null; hausnummerZusatz: string | null } {
    const m = /^(.*?)\s+(\d+)\s*([a-zA-Z]?(?:\s*[-\/].*)?)$/.exec(value.trim());
    if (!m) return { strassenname: value.trim(), hausnummer: null, hausnummerZusatz: null };
    return { strassenname: m[1], hausnummer: m[2], hausnummerZusatz: m[3].trim() || null };
}

export function mapApplication(data: Data, catalogs: SvwsCatalogs, options: { anmeldedatum?: string } = {}): SvwsRecords {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const nationality = (key: unknown, label: string): number | null => {
        if (typeof key !== 'string' || !key) return null;
        const iso3 = NATIONALITY_SPECIAL[key];
        const year = new Date().getFullYear();
        const valid = catalogs.nationalitaeten.filter((n) => n.gueltigBis === null || n.gueltigBis >= year);
        const hit = iso3 ? valid.find((n) => n.iso3 === iso3) : valid.find((n) => n.iso2?.toUpperCase() === key.toUpperCase());
        if (!hit) warn(`${label} „${key}“ nicht im SVWS-Katalog gefunden`);
        return hit?.id ?? null;
    };

    const ort = (adresse: Data | undefined, label: string): { wohnortID: number | null; ortsteilID: number | null } => {
        if (!adresse?.plz || !adresse?.ort) return { wohnortID: null, ortsteilID: null };
        const name = String(adresse.ort).trim().toLowerCase();
        const candidates = catalogs.orte.filter((o) => o.plz === adresse.plz);
        const hit = candidates.find((o) => o.ortsname.toLowerCase() === name) ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (!hit) warn(`${label}: Ort ${adresse.plz} ${adresse.ort} nicht im SVWS-Ortskatalog – bitte in SVWS anlegen und zuordnen`);
        let ortsteilID: number | null = null;
        if (hit && text(adresse.ortsteil)) {
            const teil = catalogs.ortsteile.find((t) => t.idOrt === hit.id && t.ortsteil.toLowerCase() === String(adresse.ortsteil).trim().toLowerCase());
            if (teil) ortsteilID = teil.id;
            else warn(`${label}: Ortsteil „${adresse.ortsteil}“ nicht im SVWS-Katalog`);
        }
        return { wohnortID: hit?.id ?? null, ortsteilID };
    };

    const geschlecht = GESCHLECHT[data.geschlecht];
    if (!geschlecht) warn('Geschlecht fehlt');

    let idReligion: number | null = null;
    if (data.religion) {
        const kuerzel = RELIGION[data.religion];
        idReligion = catalogs.religionen.find((r) => r.kuerzel === kuerzel)?.id ?? null;
        if (!idReligion) warn(`Religion „${data.religion}“ (${kuerzel ?? '?'}) nicht im Religionskatalog der Schule`);
    }
    if (!catalogs.idJahrgang5) warn('Jahrgang 05 nicht im SVWS-Katalog der Schule – Jahrgang bitte zuordnen');

    const vornamen = text(data.vorname) ?? '';
    const neu = {
        nachname: text(data.nachname),
        vorname: vornamen.split(/\s+/)[0] || vornamen,
        alleVornamen: vornamen,
        geschlecht: geschlecht ?? GESCHLECHT.x,
        geburtsdatum: text(data.geburtsdatum),
        status: catalogs.statusAufnahme,
        anmeldedatum: options.anmeldedatum ?? null,
        idReligion,
        idSchuljahresabschnitt: catalogs.idSchuljahresabschnitt,
        idJahrgang: catalogs.idJahrgang5 ?? null,
    };

    const adresse = data.adresse as Data | undefined;
    const sprache = typeof data.herkunftssprache === 'string' ? data.herkunftssprache.toLowerCase() : null;
    const idVerkehrspracheFamilie = sprache ? (catalogs.sprachen.find((s) => s.iso2 === sprache)?.id ?? null) : null;
    if (sprache && !idVerkehrspracheFamilie) warn(`Herkunftssprache „${data.herkunftssprache}“ nicht im SVWS-Katalog`);
    const erz1 = (data.erziehungsberechtigter1 ?? {}) as Data;
    const stammdaten: Record<string, unknown> = {
        geburtsort: text(data.geburtsort),
        ...(adresse?.strasse ? splitStreet(adresse.strasse) : {}),
        ...ort(adresse, 'Wohnadresse'),
        idStaatsangehoerigkeit: nationality(data.staatsangehoerigkeit, 'Staatsangehörigkeit'),
        idGeburtsland: nationality(data.geburtsland, 'Geburtsland'),
        idVerkehrspracheFamilie,
        zuzugsjahr: typeof data.zuzugsdatum === 'string' ? Number(data.zuzugsdatum.slice(0, 4)) : null,
        telefon: text(erz1.telefonFestnetz),
        telefonMobil: text(erz1.telefonMobil),
        emailPrivat: text(erz1.email),
    };
    dropEmpty(stammdaten);

    const erzieher: Record<string, unknown>[] = [];
    const guardians = [data.erziehungsberechtigter1, data.zweiterErziehungsberechtigter === false ? undefined : data.erziehungsberechtigter2];
    guardians.forEach((g: Data | undefined, i) => {
        if (!g?.nachname) return;
        const art = catalogs.erzieherarten.find((a) => a.bezeichnung === ERZIEHERART[g.rolle]);
        if (!art) warn(`${i + 1}. Erziehungsberechtigte/r: Rolle „${g.rolle}“ ohne passende SVWS-Erzieherart`);
        const own = g.abweichendeAdresse === true ? (g.adresse as Data | undefined) : adresse;
        const phones = [text(g.telefonFestnetz) && `Festnetz ${g.telefonFestnetz}`, text(g.telefonMobil) && `mobil ${g.telefonMobil}`].filter(Boolean);
        const record: Record<string, unknown> = {
            idErzieherArt: art?.id ?? null,
            anrede: ANREDE[g.rolle] ?? null,
            nachname: text(g.nachname),
            vorname: text(g.vorname),
            ...(own?.strasse ? splitStreet(own.strasse) : {}),
            ...ort(own, `${i + 1}. Erziehungsberechtigte/r`),
            eMail: text(g.email),
            erhaeltAnschreiben: true,
            // SVWS keeps guardian phone numbers elsewhere; kept as a note for now
            bemerkungen: phones.length ? `Telefon: ${phones.join(', ')} (aus Online-Anmeldung)` : null,
        };
        dropEmpty(record);
        erzieher.push(record);
    });
    if (!erzieher.length) warn('Keine Erziehungsberechtigten angegeben');

    return { neu, stammdaten, erzieher, warnings };
}

/**
 * Removes empty values. SVWS only accepts place and district together, so
 * ortsteilID stays (possibly null) whenever wohnortID is set.
 */
function dropEmpty(record: Record<string, unknown>): void {
    for (const k of Object.keys(record)) {
        if (k === 'ortsteilID' && record.wohnortID != null) continue;
        if (record[k] === null || record[k] === undefined) delete record[k];
    }
}
