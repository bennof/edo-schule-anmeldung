# Sprint 1 – Fundament

**Status:** Code fertig, Integration mit SharePoint **blockiert** (siehe Probleme).

## Ergebnis

| Task | Stand |
|---|---|
| A1 Repository/Workspace | ✅ pnpm-Workspace, beide SPAs und Rust-Server bauen und starten |
| A2 Domain-Modell | ✅ `packages/domain`: Modelle und State-Machines inkl. Übergangsprüfung |
| B1 SharePoint-Adapter | ✅ Code + Unit-Tests (Fake-Graph), ⛔ nicht gegen echte Site getestet |
| B2 Schema-Provisionierung | ✅ Code + Unit-Tests (idempotent, nicht destruktiv, Schema-Version), ⛔ nicht live getestet |
| B3 Config-System | ✅ Code + Unit-Tests, ⛔ nicht live getestet |
| C1 Form-JSON-Schema | ✅ JSON-Schema, 2 gültige und 16 ungültige Testdefinitionen |
| J1 Microsoft-365-Login | ✅ Code (MSAL), ⛔ nicht getestet (kein Testbenutzer, App-Secret ungültig) |

Tests: 33 Unit-Tests (TS) und 2 Rust-Tests grün; Typprüfung ohne Fehler; Secrets nachweislich nicht im Browser-Bundle.

## Probleme

1. **`APP_CLIENT_SECRET` wird abgelehnt** (`AADSTS7000215 invalid_client`). Der Wert hat 41 Zeichen, üblich sind 40; vermutlich falsch kopiert oder abgelaufen. Ohne ihn läuft `pnpm test:integration` nicht. Das Skript ist fertig und testet Provisionierung (2×), Config, Appointment-CRUD mit Filter und If-Match, JSON-Round-Trip und Assets.
2. **Kein Testbenutzer in `.env`.** `info.md` erwähnt ihn, die Datei enthält aber keine Benutzer-Zugangsdaten. J1 ist daher nur gebaut, nicht geprüft.
3. Offen bis zum Live-Test: ob die App-Registrierung Listen anlegen darf (z. B. `Sites.Manage.All` oder `Sites.Selected` mit Rolle `manage`).

Der Daemon funktioniert (Token mit `Sites.Selected`, Lesen der Site OK).

## Entscheidungen (bitte prüfen)

- SharePoint-Item-ID = Domain-ID. Config-Schlüssel in der Title-Spalte. JSON-Felder als mehrzeiliger Text.
- Spalte `datetime` heißt in SharePoint `SlotDatetime`. Termin-Zeitpunkte als lokaler Text `YYYY-MM-DDTHH:mm`, ohne Zeitzone.
- Config-Einträge haben ein Flag `isPublic` (Vorbereitung für F2).
- Application-Übergänge: `created → interview` und `form_in_progress → interview` sind erlaubt (Familie erscheint ohne abgeschickten Online-Antrag). Das ist eine Interpretation des Backlogs.
- Form-Daten sind nach Item-IDs geschachtelt, Sections gehören nicht zum Datenpfad. Bedingungen referenzieren Geschwisterfelder oder absolute Pfade (`/gruppe/feld`).
- Abhängigkeiten: Laufzeit nur `svelte`, `@azure/msal-browser`, `tiny_http`. `ajv` nur für Tests. Kein SvelteKit, kein Web-Framework in Rust.

## Nächster Schritt

Secret korrigieren → `pnpm test:integration` → Sekretariats-Login mit echtem Benutzer prüfen. Danach Sprint 2.
