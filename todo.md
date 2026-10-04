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
- [ ] Hosting: Mietserver mit Docker-Stack (siehe 5.1) – Reverse-Proxy mit TLS, `TRUST_PROXY=1`, `TZ=Europe/Berlin` (S3)
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

### 5.1 Docker-Bereitstellung auf eigenem Mietserver (empfohlen, Angebot für Schulen)

Standardweg für das Angebot an Schulen: ein gemieteter Server (VM), auf dem alles
Öffentliche als Docker-Container läuft. Das Sekretariat bleibt Web-App bzw. Tauri
(5.2), die Daten bleiben im SharePoint der jeweiligen Schule.

**Public Server liefert die SPA mit aus**

- [ ] Rust-Server liefert die gebaute Public SPA als statische Dateien (`PUBLIC_DIR`) und die API unter `/api` – ein Dienst für alles Öffentliche
- [ ] SPA-Fallback auf `index.html`, korrekte Content-Types, Cache-Header (Hash-Dateien lange, `index.html` kurz)
- [ ] Sicherheits-Header (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` konfigurierbar)
- [ ] Schutz vor Pfad-Traversal; nur Dateien unterhalb von `PUBLIC_DIR`

**Container**

- [ ] Multi-Stage-Dockerfile: SPA und Rust bauen, schlankes Laufzeit-Image (z. B. distroless), nur Binary + `public/`
- [ ] Sicher betreiben: Nicht-root-Benutzer, schreibgeschütztes Dateisystem, keine Shell im Image, Healthcheck (`/api/health`), Ressourcenlimits
- [ ] Compose-Stack mit Reverse-Proxy und automatischem TLS (z. B. Caddy mit Let's Encrypt, alternativ nginx); `TRUST_PROXY=1`, `TZ=Europe/Berlin`
- [ ] Konfiguration und Secrets pro Schule über Env-Datei bzw. Docker Secrets (Tenant, Daemon-App, Site); nichts im Image
- [ ] Logs ohne personenbezogene Daten (ist im Server bereits so), Rotation über Docker
- [ ] Image-Versionen mit Tags; Update = neues Image ziehen und neu starten
- [ ] `make docker-build`, `make docker-up` analog zu `svws-*`

**Mehrere Schulen auf einem Server**

- [ ] Eine Instanz (Container) pro Schule mit eigener Konfiguration und eigener (Sub-)Domain; der Reverse-Proxy verteilt nach Domain
- [ ] Vorlage/Skript zum Anlegen einer neuen Schul-Instanz (Env-Datei, Domain, Start)
- [ ] Einrichtung beim Kunden dokumentieren: SharePoint-Site, App-Registrierungen, Listenrechte, Mail-Postfach (Checkliste je Schule)
- [ ] Überwachung (Healthchecks, Zertifikatslaufzeit) und Updates für alle Instanzen

**Optional:** PHP-Kern (5.3) zusätzlich als Container (php-fpm + nginx) für Schulen, die die PHP-Variante bevorzugen

### 5.2 Sekretariat als Desktop-App (Tauri)

- [ ] Tauri-Hülle um `apps/secretariat`; Build über `make` (Windows-Installer, ggf. macOS/Linux)
- [ ] SVWS-Transport `tauri` umsetzen (im Adapter vorbereitet): Rust-Command `svws_request`, Zugriff direkt aus der App ohne CORS-Proxy, selbstsignierte Schulzertifikate gezielt vertrauen
- [ ] Microsoft-365-Login in Tauri klären (MSAL im WebView, Redirect über Loopback oder eigenes Schema; ggf. System-Browser)
- [ ] Browser-Konfiguration (N1) im App-Datenverzeichnis statt localStorage; Import/Export bleibt
- [ ] Automatische Updates und Code-Signierung festlegen
- [ ] Die Web-Variante des Sekretariats bleibt parallel nutzbar

### 5.3 Public Server als CMS-Plugin (nur für Schulen ohne eigenen Server)

Viele Schulen haben nur ein Webhosting-Paket mit CMS und können dort kein eigenes
Programm wie den Rust-Server starten. Das Plugin **übernimmt die komplette
Funktion des Public Servers** auf dem Webhost: öffentliche API, Graph-Zugriff mit
der Daemon-Identität, Buchung, Anmeldung, Uploads, Bestätigungsmail – und liefert
die Public SPA aus. Typisches Schul-Webhosting bietet PHP, unabhängig vom CMS.

**Aufbau: ein PHP-Kern, dünne CMS-Adapter**

- [ ] **API-Vertrag** festschreiben (OpenAPI für alle `/api/...`-Routen) – gilt für Rust-Server und PHP-Kern gleichermaßen
- [ ] **Konformitätstest:** `integration-public-api` gegen eine beliebige Basis-URL lauffähig machen; jede Umsetzung (Rust, PHP-Kern pur, jedes Plugin) muss ihn bestehen
- [ ] **PHP-Kern** (framework-unabhängige Bibliothek, keine CMS-Abhängigkeit):
  - Graph-Client mit Client Credentials, Token-Cache, Throttling-Retry
  - Listenzugriff mit eTag (Schutz vor Doppelbuchung), Token-Hash der Familie
  - Endpunkte wie der Rust-Server: config, procedures/form, appointments, booking, applications (start, submit, form), uploads, assets
  - Strukturprüfung der Formulardaten und Upload-Prüfungen (Typ, Signatur, Größe, Anzahl)
  - IP-Filter, Bestätigungsmail über Graph, keine personenbezogenen Daten in Logs
- [ ] **Reine PHP-Variante** ohne CMS (`index.php` + Kern) für Webspace ohne CMS
- [ ] **CMS-Adapter** übernehmen nur: Routing der API, Einstellungsseite, sichere Ablage der Secrets, Auslieferung/Einbindung der Public SPA (Seite, Shortcode/Block/Modul)
  - [ ] WordPress (Plugin, REST-Routen, Shortcode/Block) – zuerst
  - [ ] Joomla (Komponente)
  - [ ] TYPO3 (Extension)
  - [ ] Drupal (Modul)
  - [ ] Contao (Bundle) – in Schulen verbreitet
  - [ ] Reihenfolge nach Bedarf der Schulen festlegen (Umfrage)
- [ ] Public SPA mit konfigurierbarer API-Basis-URL bauen (Plugin-Pfade statt `/api`)

**Webhosting-Grenzen klären und testen** (nur für den Plugin-Weg; beim Mietserver mit Docker entfällt das)

- [ ] Mindest-PHP-Version, benötigte Erweiterungen (curl/openssl, json, mbstring)
- [ ] Ausgehende HTTPS-Verbindungen zu `login.microsoftonline.com` und `graph.microsoft.com` erlaubt?
- [ ] Upload- und Request-Limits (`upload_max_filesize`, `post_max_size`, `max_execution_time`)
- [ ] Token-Cache ohne Hintergrundprozesse (Datei oder CMS-Cache), keine Cronjobs voraussetzen
- [ ] Secrets außerhalb des Webroots bzw. verschlüsselt in der CMS-Konfiguration; nie im Frontend
- [ ] Zeitzone und Reverse-Proxy-Verhalten des Hosters (Client-IP für den IP-Filter)

**Wartung**

- [ ] Versionen von Rust-Server und PHP-Kern synchron halten (gleicher API-Vertrag, gleiche Testsuite)
- [ ] Update-Weg pro CMS (Plugin-Verzeichnis, Paket-Download)

## 6. Future Releases aus dem Backlog (noch offen)

- [ ] Terminverschiebung: Termin freigeben, neuen buchen, Anmeldung sicher übertragen (BL)
- [ ] Ansicht für die Gesprächsführung: eigene Termine, Anmeldungen lesen und korrigieren, `interviewerComment` (BL)
- [ ] PDF-Design-Engine: Formular-JSON → Layout → pdf-lib → AcroForm (BL)
- [ ] Flexible PDF-Vorlagen: mehrere Dokumenttypen, Layouts, Versionierung (BL)

Erledigt aus den Future Releases: Uploads (Sprint 7), SVWS-Adapter (Sprint 8).
