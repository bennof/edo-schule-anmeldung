# Sprint 1 – Fundament

**Status:** Abgeschlossen.

## Ergebnis

| Task | Stand |
|---|---|
| A1 Repository/Workspace | ✅ pnpm-Workspace, beide SPAs und Rust-Server bauen und starten |
| A2 Domain-Modell | ✅ `packages/domain`: Modelle und State-Machines inkl. Übergangsprüfung |
| B1 SharePoint-Adapter | ✅ Unit-Tests und live gegen die Test-Site getestet |
| B2 Schema-Provisionierung | ✅ live: leere Site initialisiert, zweiter Lauf ändert nichts, Spalten und Indizes korrekt |
| B3 Config-System | ✅ Unit-Tests und live getestet |
| C1 Form-JSON-Schema | ✅ JSON-Schema, 2 gültige und 16 ungültige Testdefinitionen |
| J1 Microsoft-365-Login | ✅ E2E-Test mit Testbenutzer: Login über Microsoft, Zugriff auf Site, Config sichtbar. Negativfall (Benutzer ohne Site-Zugriff) mangels zweitem Konto nicht getestet |

Tests: 33 Unit-Tests (TS), 2 Rust-Tests, 7 Integrationsschritte gegen SharePoint und der Login-E2E-Test grün; Typprüfung ohne Fehler; Secrets nachweislich nicht im Browser-Bundle.

## Probleme

1. ~~`APP_CLIENT_SECRET` ungültig~~: behoben, neues Secret funktioniert. `pnpm test:integration` läuft vollständig durch (Provisionierung 2×, Config, Appointment-CRUD mit Filter und If-Match, JSON-Round-Trip, Assets). Das Skript räumt seine Testdaten selbst auf.
2. ~~Kein Testbenutzer~~: behoben. `pnpm test:e2e` meldet sich im Headless-Browser (Playwright, nur Testwerkzeug) über die echte Microsoft-Seite an. Der Test hat einen Fehler gefunden, der nur im Browser auftritt (`fetch` „Illegal invocation“ im Graph-Client); ist behoben.

Die App-Registrierung darf Listen anlegen. Der Daemon bekommt einen Token mit `Sites.Selected` und kann die Site lesen.
`scripts/inspect-schema.ts` zeigt die angelegten Spalten und Indizes.

## Entscheidungen (bitte prüfen)

- SharePoint-Item-ID = Domain-ID. Config-Schlüssel in der Title-Spalte. JSON-Felder als mehrzeiliger Text.
- Spalte `datetime` heißt in SharePoint `SlotDatetime`. Termin-Zeitpunkte als lokaler Text `YYYY-MM-DDTHH:mm`, ohne Zeitzone.
- Config-Einträge haben ein Flag `isPublic` (Vorbereitung für F2).
- Application-Übergänge: `created → interview` und `form_in_progress → interview` sind erlaubt (Familie erscheint ohne abgeschickten Online-Antrag). Das ist eine Interpretation des Backlogs.
- Form-Daten sind nach Item-IDs geschachtelt, Sections gehören nicht zum Datenpfad. Bedingungen referenzieren Geschwisterfelder oder absolute Pfade (`/gruppe/feld`).
- Abhängigkeiten: Laufzeit nur `svelte`, `@azure/msal-browser`, `tiny_http`. `ajv` und `playwright-core` nur für Tests. Kein SvelteKit, kein Web-Framework in Rust.

## Nächster Schritt

Entscheidungen oben prüfen, dann Sprint 2.
