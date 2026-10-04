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
- [ ] Hosting: Reverse-Proxy mit TLS, `TRUST_PROXY=1`, `TZ=Europe/Berlin` (S3)
- [ ] SVWS produktiv: CORS im SVWS-Server mit vertrauenswürdigem Zertifikat **oder** CORS-Proxy; Schuljahr der Neuaufnahmen in den Einstellungen setzen (S8)
- [ ] Git-Remote einrichten und das Repository sichern (Gespräch)

## 2. Testrunden und UI/UX

- [ ] Testrunden mit dem Sekretariat (Woche ab 05.10.2026); Rückmeldungen als Backlog-Tasks erfassen
- [ ] UI/UX-Überarbeitung beider SPAs nach den Testrunden
- [ ] Stabile `data-testid` statt sichtbarer Texte in den Browser-Tests (überstehen Textänderungen)
- [ ] Suchauswahl mit Pfeiltasten bedienbar machen (S2)
- [ ] Bundle-Größe Sekretariat prüfen (MSAL, Schema-Validator) (S2)

## 3. Tests und Entwicklungsumgebung

- [ ] **Vor dem Entfernen von `APP_CLIENT_SECRET`:** eigene Test-App-Registrierung nur für die Test-Site (`Sites.Selected`), Zugangsdaten in `.env.test`; `scripts/env.ts` liest zuerst `.env.test`, dann `.env` (Gespräch)
- [ ] Danach `APP_CLIENT_SECRET` aus der App „Anmeldesystem“ entfernen (info.md)
- [ ] Ordner aufteilen: `tests/integration`, `tests/e2e`; Werkzeuge bleiben in `scripts/` (Gespräch)
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

## 5. Betriebsvarianten (neu)

### 5.1 Public SPA aus dem Rust-Server ausliefern

Ein Programm für alles Öffentliche: Der Server liefert die gebaute Public SPA als
statische Dateien aus dem Dateisystem (`PUBLIC_DIR`, z. B. `dist/public`) und die API unter `/api`.

- [ ] Statische Auslieferung mit SPA-Fallback auf `index.html`, korrekten Content-Types, Cache-Headern (Hash-Dateien lange, `index.html` kurz)
- [ ] Sicherheits-Header (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` für eingebettete Nutzung konfigurierbar)
- [ ] Schutz vor Pfad-Traversal; nur Dateien unterhalb von `PUBLIC_DIR`
- [ ] `make dist` → ein Ordner mit Binary und `public/`; optional ein Docker-Image für den Public Server
- [ ] Optional später: Dateien ins Binary einbetten (eine einzige Datei)

### 5.2 Sekretariat als Desktop-App (Tauri)

- [ ] Tauri-Hülle um `apps/secretariat`; Build über `make` (Windows-Installer, ggf. macOS/Linux)
- [ ] SVWS-Transport `tauri` umsetzen (im Adapter vorbereitet): Rust-Command `svws_request`, Zugriff direkt aus der App ohne CORS-Proxy, selbstsignierte Schulzertifikate gezielt vertrauen
- [ ] Microsoft-365-Login in Tauri klären (MSAL im WebView, Redirect über Loopback oder eigenes Schema; ggf. System-Browser)
- [ ] Browser-Konfiguration (N1) im App-Datenverzeichnis statt localStorage; Import/Export bleibt
- [ ] Automatische Updates und Code-Signierung festlegen
- [ ] Die Web-Variante des Sekretariats bleibt parallel nutzbar

### 5.3 Public Server als WordPress-Plugin

Alternative zum Rust-Server für Schulen mit WordPress-Homepage.

- [ ] **Voraussetzung:** öffentliche API als Vertrag festschreiben (OpenAPI für `/api/...`: config, procedures, appointments, booking, applications, uploads)
- [ ] **Voraussetzung:** `integration-public-api` gegen eine beliebige Basis-URL lauffähig machen; derselbe Test prüft dann Rust-Server und Plugin (Konformitätstest)
- [ ] PHP-Implementierung der API als WP-REST-Routen: Graph mit Client Credentials, eTag gegen Doppelbuchung, Token-Hash, Upload-Prüfungen, IP-Filter, Bestätigungsmail
- [ ] Secrets nur serverseitig (wp-config.php oder geschützte Optionen), nie im Frontend
- [ ] Shortcode/Block `[schulanmeldung]` bettet die Public SPA ein; API-Basis-URL in der SPA konfigurierbar machen
- [ ] Einstellungsseite im WP-Admin (Tenant, Daemon-App, Site, Status-Check)
- [ ] Hosting-Grenzen prüfen: PHP-Version, ausgehende HTTPS-Verbindungen, Upload-Limits, Laufzeitlimits

### 5.4 Weitere CMS im Schuleinsatz

- [ ] **Einbettung ohne eigenes Backend** als Standardweg für alle CMS: Script-Snippet oder iframe, das die vom Rust-Server ausgelieferte Public SPA einbindet (setzt 5.1 voraus; `frame-ancestors` konfigurierbar)
- [ ] Bedarf erheben, welche Systeme die Schulen nutzen; Kandidaten für eigene Plugins nach WordPress:
  - Joomla (Komponente/Modul)
  - TYPO3 (Extension)
  - Drupal (Modul)
  - IServ (Modul), Moodle (Plugin)
- [ ] Eigene Plugins nur bei Bedarf und nur gegen denselben API-Vertrag und Konformitätstest (5.3)

## 6. Future Releases aus dem Backlog (noch offen)

- [ ] Terminverschiebung: Termin freigeben, neuen buchen, Anmeldung sicher übertragen (BL)
- [ ] Ansicht für die Gesprächsführung: eigene Termine, Anmeldungen lesen und korrigieren, `interviewerComment` (BL)
- [ ] PDF-Design-Engine: Formular-JSON → Layout → pdf-lib → AcroForm (BL)
- [ ] Flexible PDF-Vorlagen: mehrere Dokumenttypen, Layouts, Versionierung (BL)

Erledigt aus den Future Releases: Uploads (Sprint 7), SVWS-Adapter (Sprint 8).
