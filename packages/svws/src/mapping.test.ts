import { describe, expect, it } from 'vitest';
import type { SvwsCatalogs } from './catalogs.ts';
import { mapApplication, splitStreet } from './mapping.ts';

const catalogs: SvwsCatalogs = {
    statusAufnahme: 0,
    idSchuljahresabschnitt: 19,
    idJahrgang5: 1,
    religionen: [
        { id: 11, kuerzel: 'ER' },
        { id: 12, kuerzel: 'KR' },
        { id: 13, kuerzel: 'IR' },
    ],
    erzieherarten: [
        { id: 1, bezeichnung: 'Vater' },
        { id: 2, bezeichnung: 'Mutter' },
        { id: 6, bezeichnung: 'Sonstige' },
    ],
    nationalitaeten: [
        { id: 68069085, iso2: 'DE', iso3: 'DEU', gueltigBis: null },
        { id: 80079076, iso2: 'PL', iso3: 'POL', gueltigBis: null },
        { id: 83082066, iso2: 'RS', iso3: 'SRB', gueltigBis: 2008 },
        { id: 1083082066, iso2: 'RS', iso3: 'SRB', gueltigBis: null },
        { id: 88088065, iso2: null, iso3: 'XXA', gueltigBis: null },
    ],
    sprachen: [
        { id: 1000, iso2: 'de' },
        { id: 5000, iso2: 'pl' },
    ],
    orte: [
        { id: 661, plz: '52222', ortsname: 'Stolberg' },
        { id: 648, plz: '52066', ortsname: 'Aachen' },
    ],
    ortsteile: [{ id: 5, ortsteil: 'Büsbach', idOrt: 661 }],
};

const data = {
    nachname: 'Şahin',
    vorname: 'Mia Sophie',
    geschlecht: 'w',
    geburtsdatum: '2015-05-04',
    geburtsort: 'Kraków',
    geburtsland: 'PL',
    staatsangehoerigkeit: 'RS',
    herkunftssprache: 'PL',
    zuzugsdatum: '2019-08-01',
    religion: 'rk',
    adresse: { strasse: 'Am Weg 12a', plz: '52222', ort: 'Stolberg', ortsteil: 'Büsbach' },
    erziehungsberechtigter1: { rolle: 'mutter', nachname: 'Şahin', vorname: 'Ewa', abweichendeAdresse: false, telefonMobil: '0170 1', email: 'ewa@example.org' },
    zweiterErziehungsberechtigter: true,
    erziehungsberechtigter2: { rolle: 'vater', nachname: 'Şahin', vorname: 'Mehmet', abweichendeAdresse: true, adresse: { strasse: 'Hauptstr. 5', plz: '52066', ort: 'Aachen' } },
};

describe('svws mapping', () => {
    it('splits street and house number', () => {
        expect(splitStreet('Am Weg 12a')).toEqual({ strassenname: 'Am Weg', hausnummer: '12', hausnummerZusatz: 'a' });
        expect(splitStreet('Hauptstr. 5')).toEqual({ strassenname: 'Hauptstr.', hausnummer: '5', hausnummerZusatz: null });
        expect(splitStreet('Gut Hohenstein')).toEqual({ strassenname: 'Gut Hohenstein', hausnummer: null, hausnummerZusatz: null });
    });

    it('maps the student with SVWS ids', () => {
        const r = mapApplication(data, catalogs, { anmeldedatum: '2026-10-04' });
        expect(r.neu).toEqual({
            nachname: 'Şahin',
            vorname: 'Mia',
            alleVornamen: 'Mia Sophie',
            geschlecht: 4,
            geburtsdatum: '2015-05-04',
            status: 0,
            anmeldedatum: '2026-10-04',
            idReligion: 12,
            idSchuljahresabschnitt: 19,
            idJahrgang: 1,
        });
        expect(r.stammdaten).toMatchObject({
            geburtsort: 'Kraków',
            strassenname: 'Am Weg',
            hausnummer: '12',
            hausnummerZusatz: 'a',
            wohnortID: 661,
            ortsteilID: 5,
            idStaatsangehoerigkeit: 1083082066, // the currently valid Serbia entry
            idGeburtsland: 80079076,
            idVerkehrspracheFamilie: 5000,
            zuzugsjahr: 2019,
            telefonMobil: '0170 1',
            emailPrivat: 'ewa@example.org',
        });
        expect(r.warnings).toEqual([]);
    });

    it('maps guardians with their own or the child address', () => {
        const [mutter, vater] = mapApplication(data, catalogs).erzieher;
        expect(mutter).toMatchObject({ idErzieherArt: 2, anrede: 'Frau', nachname: 'Şahin', vorname: 'Ewa', wohnortID: 661, strassenname: 'Am Weg', eMail: 'ewa@example.org' });
        expect(mutter.bemerkungen).toBe('Telefon: mobil 0170 1 (aus Online-Anmeldung)');
        expect(vater).toMatchObject({ idErzieherArt: 1, anrede: 'Herr', wohnortID: 648, strassenname: 'Hauptstr.' });
        // SVWS changes place and district only together
        expect(vater).toHaveProperty('ortsteilID', null);
    });

    it('warns about values without a catalog entry', () => {
        const r = mapApplication(
            { ...data, religion: 'alevit', staatsangehoerigkeit: 'XX', adresse: { strasse: 'X 1', plz: '99999', ort: 'Nirgendwo' }, zweiterErziehungsberechtigter: false },
            catalogs,
        );
        expect(r.neu.idReligion).toBeNull();
        expect(r.stammdaten.idStaatsangehoerigkeit).toBe(88088065);
        expect(r.erzieher).toHaveLength(1);
        expect(r.warnings).toEqual([
            'Religion „alevit“ (AR) nicht im Religionskatalog der Schule',
            'Wohnadresse: Ort 99999 Nirgendwo nicht im SVWS-Ortskatalog – bitte in SVWS anlegen und zuordnen',
            '1. Erziehungsberechtigte/r: Ort 99999 Nirgendwo nicht im SVWS-Ortskatalog – bitte in SVWS anlegen und zuordnen',
        ]);
    });
});
