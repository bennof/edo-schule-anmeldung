# Sprint 2 – Formulare

**Status:** Abgeschlossen.

## Ergebnis

| Task | Stand |
|---|---|
| C2 Form Runtime | ✅ `packages/forms/src/runtime.ts`, ohne Framework: Initialdaten, Bedingungen, Sichtbarkeit, Validierung (required-if-visible), Repeat-Groups, Kopieren, Entfernen ausgeblendeter Werte |
| C3 Svelte Form Renderer | ✅ neues Paket `packages/form-ui`, alle 10 Feldtypen, Gruppen, Repeat-Groups, Kopier-Knopf, Fehleranzeige nach Verlassen des Feldes bzw. nach Absendeversuch |
| C4 Secretariat-Modus | ✅ zeigt alle Felder inkl. ausgeblendeter (markiert „Im Online-Formular ausgeblendet“); bestehende Anmeldung laden, bearbeiten, speichern |
| D1 Procedure-Verwaltung | ✅ Verfahren anlegen, anzeigen, bearbeiten (Titel, Beschreibung, Zeitraum, Formular) mit Eingabeprüfung |
| Test-FormDefinition | ✅ `packages/forms/examples/test-form.json`; im Sekretariat per Knopf anlegbar, beliebige JSON-Formulare importierbar (mit Schema-Prüfung) |

Sekretariat hat jetzt eine Navigation: Start · Verfahren · Formulare · Anmeldungen.
Public SPA: Vorschau des Testformulars unter `#vorschau` (wird in Sprint 4 durch den echten Ablauf ersetzt).

## Tests

- 48 Unit-Tests (u. a. 14 neue für die Runtime: Bedingungen, required-if-visible, Repeat-Groups, Copy), 2 Rust-Tests
- Integrationstest SharePoint: grün
- Browser-Tests (`pnpm test:e2e`), alle grün und ohne Konsolenfehler:
  - `e2e-forms`: Formular in der Public SPA ausfüllen – Pflichtfelder, Muster, Bedingungen in Gruppen, Kopieren, Repeat (Grenzen), Suchauswahl, requiredIf, bereinigte Daten
  - `e2e-secretariat`: Login, Formular-Import (gültig/ungültig), Vorschau im Sekretariatsmodus, Verfahren anlegen/bearbeiten, Anmeldung öffnen/bearbeiten/speichern, Daten nach Neuladen vorhanden, leere Anmeldung anlegen
  - Die Tests legen Daten auf der Test-Site an und löschen sie danach (geprüft: keine Reste)

Gefunden und behoben: Startseite zeigte während des Ladens „Schema: nicht initialisiert“.

## Entscheidungen (bitte prüfen)

- **Ja/Nein-Felder** als zwei Radio-Buttons statt Checkbox, damit „nicht beantwortet“ von „Nein“ unterscheidbar ist.
- **Ausgeblendete Werte** bleiben während der Bearbeitung erhalten (z. B. wenn man eine Bedingung kurz umschaltet). `withoutHidden()` entfernt sie beim Absenden (für G5).
- **Kopieren** überschreibt die Zielgruppe mit einer Kopie; danach sind beide unabhängig. Der Knopf bleibt verfügbar.
- **Formular-Import** legt immer einen neuen Eintrag an und überschreibt nie, passt zur Versionierung in D3.
- **„Leere Anmeldung anlegen“** im Sekretariat (Status `created`), gedacht für Anmeldungen ohne Online-Formular, z. B. auf Papier. Geht etwas über den Sprint hinaus; lässt sich leicht entfernen.
- `Procedure.info` ist typisiert als `{ title, description? }`.

## Offene Punkte / Hinweise

- **B4 (Asset-System) ist keinem Sprint zugeordnet.** Der Adapter kann Assets bereits speichern, laden und löschen; es fehlt die Oberfläche. Wird für Logo (G1) und PDF-Vorlagen (I2) gebraucht. Vorschlag: in Sprint 3 mit G1 erledigen.
- `optionsSource` (Optionslisten als Asset, z. B. Schulkatalog) ist im Renderer vorbereitet, aber noch ohne Lader, hängt an B4.
- Suchauswahl ohne Pfeiltasten-Navigation (nur Tippen und Klicken).
- Sekretariats-Bundle 509 kB (MSAL und Schema-Validator); Vite warnt ab 500 kB. Für eine interne Anwendung unkritisch.

## Nächster Schritt

Sprint 3 – Termine und erster Testbetrieb (E1–E5, F1–F4, G1–G3).
