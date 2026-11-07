# TODO – Anmeldesystem

Offene und angedachte Punkte (Stand 07.11.2026). Herkunft in Klammern: Sprint
(S1–S8), Backlog (BL) oder Gespräch. Backlog und Sprint-Reviews sind abgearbeitet
und entfernt (in der Git-Historie); Kennungen wie C5 oder J2 im Code stammen
daraus. Erledigtes wird gelöscht.

## 1. Vor den Testrunden / vor dem Betrieb (Schule, Konfiguration)

- [ ] `publicUrl` in der Config-Liste auf die echte Adresse der öffentlichen Seite setzen (S6)
- [ ] Texte prüfen lassen: Einverständnisse, Kenntnisnahmen, `consentText`, Mail-Vorlage (S4, S6). Im Schulformular (`private/anmeldebogen-2026-27.json`): Termine Klassenfahrt und Bildung und Teilhabe stehen noch auf 2025; der Vortext nennt „Microsoft Forms“ (Gespräch)
- [ ] Auswahllisten prüfen: Religion, Religionsunterricht, Rollen der Erziehungsberechtigten, Förderschwerpunkte (S4); Länder, Sprachen, Staatsangehörigkeiten unter „Aus SVWS“ erzeugen
- [ ] PDF: vollständige Belehrungstexte (DS-GVO, § 34 IfSG) beilegen oder eigene Vorlage mit denselben Feldnamen hochladen (S6)
- [ ] SharePoint, Liste Applications: Berechtigungen auf Elementebene auf „Nur eigene Elemente lesen“ setzen (S3, S4)
- [ ] Server der Schule einrichten: Debian-Paket, `config.env` aus `schulanmeldung.env`, nginx-Snippet, `TRUST_PROXY=1` (siehe `server/README.md`) (S3)
- [ ] Client-Secret von „Schulanmeldung Server“ erneuern (`setup-tenant.ps1 refresh`), es stand im Chat (Gespräch)
- [ ] SVWS produktiv: Schuljahr der Neuaufnahmen in den Einstellungen setzen (S8)

## 2. Testrunden und UI/UX

- [ ] Testrunden mit dem Sekretariat (laufen seit November 2026); Rückmeldungen als Backlog-Tasks erfassen
- [ ] UI/UX-Überarbeitung beider SPAs nach den Testrunden
- [ ] Stabile `data-testid` statt sichtbarer Texte in den Browser-Tests (überstehen Textänderungen)
- [ ] Suchauswahl mit Pfeiltasten bedienbar machen (S2)
- [ ] Bundle-Größe Sekretariat prüfen (MSAL, Schema-Validator) (S2)

## 3. Tests und Entwicklungsumgebung

- [ ] **Vor dem Entfernen von `APP_CLIENT_SECRET`:** eigene Test-App-Registrierung nur für die Test-Site (`Sites.Selected`), Zugangsdaten in `.env.test`; `tests/support/env.ts` liest zuerst `.env.test`, dann `.env` (Gespräch)
- [ ] Danach `APP_CLIENT_SECRET` aus der App „Anmeldesystem“ entfernen
- [ ] CI: Integrations- und Browser-Tests gegen die Test-Site mit Secrets der Test-App (`make check test` läuft schon bei jedem Push)
- [ ] `setup-tenant.ps1 refresh` im Test-Tenant ausprobieren (Gespräch)
- [ ] Login-Wartezeiten in den Browser-Tests beobachten (gelegentlich langsame Microsoft-Anmeldung) (S8)

## 4. Funktionen und Technik

- [ ] **Löschkonzept (DS-GVO):** Aufbewahrungsfristen; Anmeldungen, Uploads (`deleteUploads`), Termine und Buchungsdaten nach Verfahrensende löschen oder anonymisieren
- [ ] „Systemprüfung“ unter Einstellungen: Schema, Spalten, Indizes, Kataloge, PDF-Vorlage, Daemon-Rechte (Gespräch)
- [ ] Statusübergänge zurück (z. B. „geprüft“ → „in Prüfung“), falls im Testbetrieb gebraucht (S5)
- [ ] Missbrauchsschutz erweitern: Begrenzung von Buchungsversuchen je IP/Zeit, ggf. E-Mail-Bestätigung vor der Buchung (S3)
- [ ] IP-Limit gegen gleichzeitige Anfragen absichern (derzeit knapp überschreitbar) (S3)
- [ ] Fortsetzen-Link aus der Mail: Ablaufzeit des Zugangsschlüssels (S6)
- [ ] Telefonnummern der Erziehungsberechtigten im Sekretariat als eigene Felder pflegen (S5/S8)
- [ ] Nach einer Absage: Umgang mit Uploads der weiterhin bestehenden Anmeldung festlegen (S7)

### Tenant-Skript (`scripts/tenant/setup-tenant.ps1`)

- [ ] Zertifikat statt Client-Secret für den Server (der Server kann bisher nur Secrets)
- [ ] Testen, ob das Recht `fullcontrol` der Sekretariats-App auf der Site auf `write` reduziert werden kann (Schema-Änderungen brauchen evtl. wieder `fullcontrol`)

### SVWS-Adapter, nächste Schritte (S8)

- [ ] **Mapping editierbar machen:** Zuordnung Formularfeld (Datenname) → SVWS-Feld und die Übersetzungstabellen (Geschlecht, Religion, Erzieherart, Anrede) im Sekretariat pflegen statt fest in `packages/svws/src/mapping.ts`. Auch der Kindname in den Listen kommt fest aus `nachname`/`vorname` (Gespräch 07.11.2026, S5)
- [ ] Listen aus „Aus SVWS“ beim Übertragen direkt verstehen: Religionen mit SVWS-Kürzel (`KR`) und Erzieherarten mit SVWS-ID als Schlüssel; heute erwartet die Übertragung die Formular-Schlüssel (`rk`, `mutter`) (Gespräch 07.11.2026)
- [ ] Telefonnummern als SVWS-Telefoneinträge statt als Bemerkung
- [ ] Mit dem Sekretariat klären und ggf. übertragen: Förderschwerpunkte, LRS/Autismus, bisherige Schulen, Notfallkontakte, Einverständnisse (Vermerke), Klassenwunsch, Religionsunterricht
- [ ] Fehlende Orte/Ortsteile optional im SVWS-Katalog anlegen statt nur zu warnen
- [ ] Prüfung auf vorhandene Schüler (Name + Geburtsdatum) vor dem Anlegen

## 5. Betriebsvarianten je nach Umgebung der Schule

Die Daten liegen immer im SharePoint der Schule; es geht nur darum, wo die
Funktion des Public Servers läuft. Die Umgebungen der Schulen sind verschieden:

| Umgebung der Schule | Public Server | Abschnitt |
|---|---|---|
| Bare Metal / eigener Server | Rust-Server als Dienst – beste Wahl | 5.1 |
| Containersystem | derselbe Rust-Server als Container | 5.2 |
| CMS auf Webhosting ohne Serverzugriff | PHP-Plugin übernimmt die Serverfunktion | 5.3 |
| CMS so eingeschränkt, dass auch kein Plugin geht | kein Angebot möglich | 5.4 |

Gemeinsame Grundlage für alle Varianten:

- [ ] **API-Vertrag** (OpenAPI für alle `/api/...`-Routen) als verbindliche Beschreibung der Serverfunktion
- [ ] **Konformitätstest:** `integration-public-api` gegen eine beliebige Basis-URL lauffähig machen; jede Umsetzung (Rust, PHP) muss ihn bestehen

### 5.1 Bare Metal: Rust-Server als Dienst

- [ ] Beispiele für Apache und Caddy (nginx gibt es)

### 5.2 Containersysteme: Rust-Server als Image

- [ ] Multi-Stage-Dockerfile (SPA + Rust bauen, schlankes Laufzeit-Image nur mit Binary + `public/`)
- [ ] Nicht-root, schreibgeschütztes Dateisystem, Healthcheck `/api/health`
- [ ] Konfiguration und Secrets über Env-Datei bzw. Docker Secrets, nichts im Image
- [ ] Compose-Beispiel (optional mit Reverse-Proxy und TLS); `make docker-build`
- [ ] Versionierte Image-Tags

### 5.3 CMS ohne Serverzugriff: PHP-Plugin übernimmt die Serverfunktion

Für Schulen, die nur ein CMS auf einem Webhosting haben und dort keinen eigenen
Dienst starten können. **Erst wenn die Serverfunktion nach den Testrunden stabil
ist**, wird sie in PHP umgesetzt – gegen denselben API-Vertrag und Konformitätstest.

- [ ] **PHP-Kern** ohne CMS-Abhängigkeit, Funktion wie der Rust-Server:
  - Graph-Client mit Client Credentials, Token-Cache, Throttling-Retry
  - config, procedures/form, appointments, booking (eTag gegen Doppelbuchung), applications (Token-Hash, start, submit, form), uploads (Typ, Signatur, Größe, Anzahl), assets
  - Strukturprüfung der Formulardaten, IP-Filter, Bestätigungsmail über Graph, keine personenbezogenen Daten in Logs
- [ ] **CMS-Adapter** übernehmen nur Routing, Einstellungsseite, sichere Ablage der Secrets und Auslieferung/Einbindung der Public SPA:
  - [ ] WordPress (zuerst)
  - [ ] weitere je nach Bedarf der Schulen: Joomla, TYPO3, Drupal, Contao
- [ ] Public SPA mit konfigurierbarer API-Basis-URL (Plugin-Pfade statt `/api`)
- [ ] Mindestanforderungen an das Webhosting festlegen und prüfen:
  - PHP-Version und Erweiterungen (curl/openssl, json, mbstring)
  - ausgehende HTTPS-Verbindungen zu `login.microsoftonline.com` und `graph.microsoft.com`
  - Upload- und Laufzeitlimits
  - Token-Cache ohne Hintergrundprozesse oder Cronjobs
  - Secrets außerhalb des Webroots bzw. geschützt in der CMS-Konfiguration
  - echte Client-IP für den IP-Filter
- [ ] Rust-Server und PHP-Kern synchron halten (gleicher API-Vertrag, gleiche Testsuite, gemeinsame Versionsnummer)

### 5.4 Nicht unterstützt

- [ ] Mindestanforderungen aus 5.3 dokumentieren: Erfüllt das Webhosting sie nicht (kein PHP-Plugin möglich, keine ausgehenden Verbindungen), kann das System dort nicht betrieben werden.

## 6. Sekretariat als Desktop-App (Tauri)

- [ ] Desktop-App unter Windows und macOS testen (gebaut wird sie im Release)
- [ ] Automatische Updates und Code-Signierung festlegen (Windows warnt, macOS ist unsigniert)
- [ ] Debian-Paket der Desktop-App (Gespräch)
- [ ] Erinnerung an das Ablaufdatum des Server-Secrets (`daemonSecretExpires`) (Gespräch)
- [ ] `setup-tenant.ps1` aus der Desktop-App herunterladen können (Gespräch)

## 7. Spätere Ausbaustufen (aus dem Backlog)

- [ ] Terminverschiebung: Termin freigeben, neuen buchen und die vorhandene Anmeldung sicher übertragen (BL)
- [ ] Ansicht für die Gesprächsführung: eigene Termine mit Uhrzeit, verbleibende Gespräche, zugehörige Anmeldungen lesen und korrigieren, `secretariatComment` anzeigen, `interviewerComment` bearbeiten (BL)
- [ ] PDF-Design-Engine: Formular-JSON → Layout → pdf-lib → AcroForm; einheitliche Bausteine für Abschnitte, Textfelder, Auswahlen, Checkboxen, Gruppen, Tabellen, Unterschriftsbereiche, Infotexte; Web und PDF nutzen dieselbe Formulardefinition, aber eigene Layouts (BL)
- [ ] Flexible PDF-Vorlagen: mehrere Dokumenttypen, Layouts, Versionierung (BL)
- [ ] Weitere SVWS-/SchILD-Schlüssel (statistische Kataloge) bei Bedarf über „Aus SVWS“ bereitstellen (BL)
