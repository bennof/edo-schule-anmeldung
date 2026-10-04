# Sprint 6 – Dokumente und Abschluss

**Status:** Abgeschlossen. Damit ist der MVP laut Backlog vollständig, ohne konkrete SVWS-Übertragung.

## Ergebnis

| Task | Stand |
|---|---|
| H1 Terminbestätigung | ✅ Der Server sendet nach jeder Buchung eine Text-Mail über Microsoft Graph als `anmeldung@schule.de` (Exchange RBAC for Applications). Inhalt: Verfahren, Datum, Uhrzeit und ein Link zum Fortsetzen des Formulars. Absender, Betreff, Text-Vorlage (`{name}`, `{verfahren}`, `{datum}`, `{uhrzeit}`, `{link}`) und `publicUrl` stehen in der Config-Liste. Die DoD ist erfüllt: Der Mailtest erzeugt genau eine Mail, und die 4 Testmails sind angekommen. |
| I1 pdf-lib Integration | ✅ `packages/pdf`: Vorlage laden, Felder aus Application-Daten setzen, gültiges PDF erzeugen. Läuft im Browser und in Node. |
| I2 Festes Anmelde-PDF | ✅ Generierte Vorlage (`pnpm pdf:template`): 2 Seiten, 97 AcroForm-Felder, dicht gesetzt, mit Kästchen zum handschriftlichen Ausfüllen und Ankreuzen, druckbar. Beschriftungen und Optionen kommen aus dem Schulformular. Werkzeug: pdf-lib selbst. Die Schule kann die Vorlage (Asset `anmeldebogen.pdf`) durch eine eigene mit denselben Feldnamen ersetzen. |
| I3 Application → PDF Mapping | ✅ Generisch: Feldname = Datenpfad. Ankreuzfelder heißen `pfad=wert`. Angezeigt werden Klartexte (Katalognamen, Optionen, deutsches Datum). Unicode-Namen funktionieren dank eingebetteter DejaVu Sans. |
| I4 Public PDF Download | ✅ Nach dem Absenden „Anmeldebogen als PDF herunterladen“, komplett im Browser erzeugt. pdf-lib wird erst bei Bedarf geladen. |
| I5 Secretariat PDF | ✅ Knopf „Anmeldebogen (PDF)“ im Anmeldungs-Editor, zusätzlich mit Kontakt und Termin aus der Buchung |
| M1 SVWS Adapter Boundary | ✅ `packages/svws`: `SvwsAdapter`-Schnittstelle (`transfer` → Ergebnis je Anmeldung), Platzhalter „nicht konfiguriert“ bzw. „in Vorbereitung“, keine Aufrufe konkreter SVWS-Endpunkte |
| M2 Transferauswahl | ✅ „Anmeldungen“: freigegebene Anmeldungen auswählbar, Bereich „SVWS-Übertragung“ mit Adapterstatus. Erst eine bestätigte Übertragung setzt den Status `imported`; der Platzhalter überträgt nichts. |
| N1 Client Configuration | ✅ Installationskonfiguration pro Browser in localStorage mit `schemaVersion`, JSON-Import/-Export und Einrichtungsbildschirm bei fehlender oder ungültiger Konfiguration. Secrets werden abgelehnt. Die Vorgabe aus `.env` gilt nur in der Entwicklung. |
| N2 SVWS Endpoint | ✅ `svws` in der Konfiguration: Adresse und Weg Browser→SVWS, Browser→CORS-Proxy→SVWS oder Tauri→SVWS, jeweils als Transport-Abstraktion mit Tests |

## Tests

- Unit: 86 TS, 17 Rust
- Integration: Adapter, Public API, Mail (`pnpm test:mail`, sendet an `MAIL_TEST_TO`)
- Browser: 8 Tests, alle grün; neu bzw. erweitert:
  - PDF-Download für Familie und Sekretariat, Feldwerte im erzeugten PDF geprüft
  - Fortsetzen über den Mail-Link
  - Konfiguration: Export, Einrichtung, Ablehnung von Secrets, Import mit SVWS-Endpunkt, Transferauswahl, Zurücksetzen
- Sichtprüfung des PDFs als Bild (`scripts/render-pdf.ts`)

Gefunden und behoben:
- Ein zweiter Fortsetzen-Link im schon offenen Tab wurde ignoriert.
- Die Importmeldung erschien vor dem Ende des Vorlagen-Uploads.

## Hinweise

1. **PDF-Texte:** Die Belehrungen sind wie im Formular zusammengefasst; die vollständigen Schreiben liegen bei. Für eine eigene Gestaltung kann die Schule eine AcroForm-Vorlage mit denselben Feldnamen hochladen (Feldliste: `templateFieldNames`).
2. **Mail-Link:** Er enthält den Zugangsschlüssel der Familie. Wer die Mail hat, kann das Formular bis zum Absenden bearbeiten; danach nicht mehr.
3. **`publicUrl`** steht auf der Test-Site auf `http://localhost:5174`. Für den Betrieb auf die echte Adresse setzen.
