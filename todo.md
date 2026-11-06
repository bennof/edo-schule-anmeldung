# TODO – Anmeldesystem

Offene und angedachte Punkte nach Sprint 8 (Stand 04.10.2026). Herkunft in
Klammern: Sprint-Review (S1–S8), Backlog (BL) oder Gespräch.

## 1. Vor den Testrunden / vor dem Betrieb (Schule, Konfiguration)

- [ ] `publicUrl` in der Config-Liste auf die echte Adresse der öffentlichen Seite setzen (S6)
- [ ] Texte prüfen lassen: Einverständnisse, Kenntnisnahmen, Platzhalter Klassenfahrt (ca. 180 €), `consentText`, Mail-Vorlage (S4, S6)
- [ ] Auswahllisten prüfen: Religion, Religionsunterricht, Rollen der Erziehungsberechtigten, Förderschwerpunkte (S4)
- [ ] PDF: vollständige Belehrungstexte (DS-GVO, § 34 IfSG) beilegen oder eigene Vorlage mit denselben Feldnamen hochladen (S6)
- [ ] SharePoint, Liste Applications: Berechtigungen auf Elementebene auf „Nur eigene Elemente lesen“ setzen (S3, S4)
- [ ] Entra: `Sites.Selected` beim Daemon entfernen; er braucht nur `Lists.SelectedOperations.Selected` (S3)
- [ ] Hosting des Rust-Servers (Bare Metal, siehe 5.1): Reverse-Proxy mit TLS, `TRUST_PROXY=1`, `TZ=Europe/Berlin` (S3)
- [ ] SVWS produktiv: CORS im SVWS-Server mit vertrauenswürdigem Zertifikat **oder** CORS-Proxy; Schuljahr der Neuaufnahmen in den Einstellungen setzen (S8)
- [ ] Git-Remote einrichten und das Repository sichern (Gespräch)

## 2. Testrunden und UI/UX

- [ ] Testrunden mit dem Sekretariat (Woche ab 05.10.2026); Rückmeldungen als Backlog-Tasks erfassen
- [ ] UI/UX-Überarbeitung beider SPAs nach den Testrunden
- [ ] Stabile `data-testid` statt sichtbarer Texte in den Browser-Tests (überstehen Textänderungen)
- [ ] Suchauswahl mit Pfeiltasten bedienbar machen (S2)
- [ ] Bundle-Größe Sekretariat prüfen (MSAL, Schema-Validator) (S2)

## 3. Tests und Entwicklungsumgebung

- [ ] **Vor dem Entfernen von `APP_CLIENT_SECRET`:** eigene Test-App-Registrierung nur für die Test-Site (`Sites.Selected`), Zugangsdaten in `.env.test`; `tests/support/env.ts` liest zuerst `.env.test`, dann `.env` (Gespräch)
- [ ] Danach `APP_CLIENT_SECRET` aus der App „Anmeldesystem“ entfernen (info.md)
- [ ] CI-Pipeline (z. B. GitHub Actions): `make check test` bei jedem Push; Integrations- und Browser-Tests gegen die Test-Site mit Secrets der Test-App
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

### SVWS-Adapter, nächste Schritte (S8)

- [ ] Telefonnummern als SVWS-Telefoneinträge statt als Bemerkung
- [ ] Mit dem Sekretariat klären und ggf. übertragen: Förderschwerpunkte, LRS/Autismus, bisherige Schulen, Notfallkontakte, Einverständnisse (Vermerke), Klassenwunsch, Religionsunterricht
- [ ] Fehlende Orte/Ortsteile optional im SVWS-Katalog anlegen statt nur zu warnen
- [ ] Prüfung auf vorhandene Schüler (Name + Geburtsdatum) vor dem Anlegen

### Offen gehalten

- [ ] **SVWS-/SchILD-Kataloge:** Ablage in SharePoint entscheiden; danach die erzeugten ISO-Kataloge durch SVWS-Schlüssel ersetzen oder abbilden (BL Future, Gespräch)

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

- [x] Rust-Server liefert die Public SPA mit aus (beim Bau eingebettet) und die API unter `/api` – ein Dienst für alles Öffentliche; SPA-Fallback, Cache- und Sicherheits-Header (CSP, `FRAME_ANCESTORS`), kein Dateisystemzugriff
- [ ] **API-Vertrag** (OpenAPI für alle `/api/...`-Routen) als verbindliche Beschreibung der Serverfunktion
- [ ] **Konformitätstest:** `integration-public-api` gegen eine beliebige Basis-URL lauffähig machen; jede Umsetzung (Rust, PHP) muss ihn bestehen

### 5.1 Bare Metal: Rust-Server als Dienst

- [x] `make dist` liefert ein Binary mit eingebetteter Anmeldeseite
- [ ] Installationsanleitung
- [ ] systemd-Unit (eigener Benutzer, Härtung: `ProtectSystem`, `NoNewPrivileges`, …), Konfiguration über Env-Datei
- [ ] Hinter vorhandenem Reverse-Proxy (nginx/Apache/Caddy) mit TLS; `TRUST_PROXY=1`, `TZ=Europe/Berlin`; Beispielkonfigurationen

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

- [x] Tauri-App `desktop/` mit eingebettetem Sekretariat auf http://localhost:8964; Build über `make` (einzelne Datei)
- [x] SVWS über den eingebauten Proxy `/svws-proxy` (selbstsignierte Zertifikate), Einstellungen bleiben in der App
- [ ] Microsoft-365-Login in der Desktop-App ausprobieren (Redirect-URI `http://localhost:8964`)
- [ ] Desktop-App unter Windows bauen und testen
- [ ] Automatische Updates und Code-Signierung festlegen
- [ ] Die Web-Variante des Sekretariats bleibt parallel nutzbar

## 7. Future Releases aus dem Backlog (noch offen)

- [ ] Terminverschiebung: Termin freigeben, neuen buchen, Anmeldung sicher übertragen (BL)
- [ ] Ansicht für die Gesprächsführung: eigene Termine, Anmeldungen lesen und korrigieren, `interviewerComment` (BL)
- [ ] PDF-Design-Engine: Formular-JSON → Layout → pdf-lib → AcroForm (BL)
- [ ] Flexible PDF-Vorlagen: mehrere Dokumenttypen, Layouts, Versionierung (BL)

Erledigt aus den Future Releases: Uploads (Sprint 7), SVWS-Adapter (Sprint 8).
