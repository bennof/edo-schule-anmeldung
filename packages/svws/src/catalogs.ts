// SVWS catalogs needed to map an application: loaded live from the school's
// SVWS server at transfer time (no copy in SharePoint).
import type { SvwsClient } from './client.ts';

export interface SvwsCatalogs {
    /** status id of new admissions ("Aufnahme") */
    statusAufnahme: number;
    /** school year section the student is created in */
    idSchuljahresabschnitt: number;
    /** year group 5 */
    idJahrgang5?: number;
    religionen: { id: number; kuerzel: string }[];
    erzieherarten: { id: number; bezeichnung: string }[];
    nationalitaeten: { id: number; iso2: string | null; iso3: string | null; gueltigBis: number | null }[];
    sprachen: { id: number; iso2: string | null }[];
    orte: { id: number; plz: string; ortsname: string }[];
    ortsteile: { id: number; ortsteil: string; idOrt: number | null }[];
}

interface Stammdaten {
    idSchuljahresabschnitt: number;
    abschnitte: { id: number; schuljahr: number; abschnitt: number }[];
}

/**
 * Loads all catalogs. `schuljahr` (e.g. 2026 for 2026/27) selects the first
 * section of that year; otherwise the current section of the school is used.
 */
export async function loadCatalogs(client: SvwsClient, schuljahr?: number): Promise<SvwsCatalogs> {
    const [stammdaten, status, jahrgaenge, religionen, erzieherarten, nationalitaeten, sprachen, orte, ortsteile] = await Promise.all([
        client.get<Stammdaten>('/schule/stammdaten'),
        client.get<{ id: number; text: string }[]>('/schule/schueler/status'),
        client.get<{ id: number; kuerzel: string }[]>('/jahrgaenge'),
        client.get<{ id: number; kuerzel: string }[]>('/schule/religionen'),
        client.get<{ id: number; bezeichnung: string }[]>('/schule/erzieherarten'),
        client.get<SvwsCatalogs['nationalitaeten']>('/schule/allgemein/nationalitaeten'),
        client.get<SvwsCatalogs['sprachen']>('/schule/allgemein/verkehrssprachen'),
        client.get<SvwsCatalogs['orte']>('/orte'),
        client.get<SvwsCatalogs['ortsteile']>('/ortsteile'),
    ]);
    const target = schuljahr ? stammdaten.abschnitte.find((a) => a.schuljahr === schuljahr && a.abschnitt === 1) : undefined;
    return {
        statusAufnahme: status.find((s) => s.text === 'Aufnahme')?.id ?? 0,
        idSchuljahresabschnitt: target?.id ?? stammdaten.idSchuljahresabschnitt,
        idJahrgang5: jahrgaenge.find((j) => j.kuerzel === '05')?.id,
        religionen,
        erzieherarten,
        nationalitaeten,
        sprachen,
        orte,
        ortsteile,
    };
}
