# Anmeldesystem

Online-Anmeldung für weiterführende Schulen in NRW: Familien buchen einen
Termin für das Anmeldegespräch und füllen den Anmeldebogen online aus; das
Sekretariat plant Termine, führt den Anmeldetag durch, prüft die Anmeldungen
und gibt sie für die Übernahme nach SVWS/SchILD-NRW frei.

Datenhaltung ist **SharePoint (Microsoft 365)** der Schule. Der öffentliche
Server speichert keine personenbezogenen Daten.

Fachlicher Umfang und Architekturentscheidungen: [`backlog.md`](backlog.md).
Offene Punkte und Betriebsvarianten: [`todo.md`](todo.md).
Zugänge und Testumgebung: [`info.md`](info.md). Verlauf und Entscheidungen je
Sprint: [`docs/sprint-reviews/`](docs/sprint-reviews/).

## Funktionen

**Öffentliche Anmeldung** (`apps/public`)
- Branding (Schulname, Logo), Auswahl des aktiven Anmeldeverfahrens
- freie Termine nach Tag und Uhrzeit, verbindliche Buchung (Name, E-Mail, Einwilligung)
- Bestätigungsmail mit Link zum Fortsetzen auf einem anderen Gerät
- Anmeldeformular aus einer JSON-Formulardefinition (Bedingungen, Wiederholgruppen,
  Übernahme zwischen Gruppen, Pflicht-Kenntnisnahmen, durchsuchbare Kataloge)
- Entwurf optional auf dem Gerät speichern, Absenden, Anmeldebogen als PDF

**Sekretariat** (`apps/secretariat`, Anmeldung mit Microsoft 365)
- Tagesansicht mit parallelen Räumen, „Erschienen“, telefonische Absage
- Anmeldungs-Editor mit allen Feldern, Kommentaren, automatischem Speichern und
  Konflikterkennung, Prüfschritte bis „Für SVWS freigeben“, Anmeldebogen als PDF
- Anmeldungen: Namenssuche (auch nach Absage), Statusfilter, Auswahl für die SVWS-Übertragung
- Terminplanung (Generator mit Pausen und parallelen Gesprächen, Entwürfe, Veröffentlichen)
- Verfahren, Formulare (Import mit Schema-Prüfung), Dateien (Logo, Kataloge, PDF-Vorlage)
- Einstellungen: SharePoint-Provisionierung, Konfigurationsliste, Browser-Konfiguration (Import/Export)

**Öffentlicher Server** (`server`, Rust)
- schmale API für die öffentliche SPA, Zugriff auf SharePoint nur mit Listenrechten
- Schutz vor Doppelbuchung (eTag), IP-Filter, Bestätigungsmail über Microsoft Graph

## Architektur

```text
Public SPA (Svelte) ──► Rust Public Server ──► SharePoint (Listen, Assets)
                         (Daemon-App, Listenrechte)        ▲
Sekretariat SPA (Svelte) ────── Microsoft Graph ───────────┘
          │                    (angemeldeter Benutzer)
          └─► SVWS-Adapter ──► (CORS-Proxy) ──► SVWS-Server / SchILD-NRW 3
```

SharePoint-Listen: `Config`, `Assets` (Dokumentbibliothek), `Appointments`,
`Applications`, `Forms`, `Procedures`. Die Sekretariats-SPA legt sie bei der
Einrichtung selbst an („Einstellungen → Site initialisieren“); die
Provisionierung ist wiederholbar und verändert vorhandene Daten nicht.

## Repository

```text
apps/public           öffentliche SPA (Svelte 5, Vite)
apps/secretariat      Sekretariats-SPA (Svelte 5, Vite, MSAL)
packages/domain       Domain-Modelle, Statusmaschinen, Terminplan-Generator
packages/sharepoint   Graph/SharePoint-Adapter, Provisionierung, Services
packages/forms        Formularformat (JSON-Schema), Laufzeit, Schulformular, Kataloge
packages/form-ui      Svelte-Formular-Renderer (öffentlich / Sekretariat)
packages/pdf          Anmeldebogen: Vorlagen-Generator und Befüllung (pdf-lib)
packages/svws         SVWS-Adapter: Transportwege, Kataloge, Mapping, Übertragung
server                öffentlicher Server (Rust: tiny_http, ureq)
docker/svws           SVWS-Server + MariaDB als Testumgebung
scripts               Integrations- und Browser-Tests, Hilfswerkzeuge
docs                  Sprint-Reviews, bisheriges Anmeldeformular (Word)
```

## Voraussetzungen

- Node.js 24, pnpm, Rust (rustup), GNU Make
- Docker (rootless genügt) für den SVWS-Testserver
- Microsoft-365-Tenant mit einer SharePoint-Site und zwei App-Registrierungen (siehe unten)

`make doctor` prüft die Werkzeuge.

## Schnellstart

```sh
cp .env.example .env        # Werte eintragen (siehe info.md)
make install
make dev                    # Server :8080, Public :5174, Sekretariat :5173
```

Im Sekretariat (http://localhost:5173) anmelden, unter „Einstellungen“ die Site
initialisieren, unter „Formulare“ das Schulformular anlegen, unter „Verfahren“
ein Verfahren anlegen, unter „Termine“ Termine erzeugen und veröffentlichen.

## Make-Targets

`make help` listet alle Targets. Die wichtigsten:

| Target | Zweck |
|---|---|
| `make build` / `make dist` | SPAs und Server bauen / Artefakte in `dist/` sammeln |
| `make check` | Typprüfung, Rust-Lints, Formatierung |
| `make test` | Unit-Tests (TypeScript, Rust) |
| `make test-integration` | gegen die SharePoint-Test-Site |
| `make test-e2e` | Browser-Tests (headless Chromium, M365-Testbenutzer) |
| `make test-mail` | eine Testbuchung → genau eine Mail an `MAIL_TEST_TO` |
| `make test-svws` | SVWS-Adapter gegen den laufenden SVWS-Testserver |
| `make generate` | Kataloge und PDF-Vorlage neu erzeugen |
| `make svws-init` / `svws-up` / `svws-down` | SVWS-Testserver (siehe unten) |

## Konfiguration

**`.env`** (nur Entwicklung und Tests, nie einchecken): Tenant, SharePoint-Site,
App-Registrierungen, Testbenutzer. Nur die in
`apps/secretariat/vite.config.ts` freigegebenen, nicht geheimen Werte
gelangen als Entwicklungs-Vorgabe in den Browser.

**Konfigurationsliste in SharePoint** (`Config`, im Sekretariat unter „Einstellungen“):

| Schlüssel | öffentlich | Bedeutung |
|---|---|---|
| `schoolName` | ja | Schulname in der öffentlichen SPA |
| `consentText` | ja | Einwilligungstext bei der Buchung |
| `maxBookingsPerIp` | nein | Buchungen je IP und Verfahren (0 = aus) |
| `mailSender` | nein | Absenderpostfach der Bestätigungsmail (leer = keine Mail) |
| `confirmationMailSubject`, `confirmationMailText` | nein | Betreff und Vorlage (`{name}`, `{verfahren}`, `{datum}`, `{uhrzeit}`, `{link}`) |
| `publicUrl` | nein | Adresse der öffentlichen SPA für Links in Mails |

**Browser-Konfiguration des Sekretariats**: Tenant, Client-ID, Site und
optional der SVWS-Endpunkt werden pro Browser gespeichert und als JSON
importiert/exportiert (keine Geheimnisse).

**Öffentlicher Server** (Umgebungsvariablen, sonst `.env`): `TENANT_ID`,
`DAEMON_CLIENT_ID`, `DAEMON_CLIENT_SECRET`, `SHAREPOINT_ID`, `BIND_ADDR`
(Standard `127.0.0.1:8080`), `WORKERS`, `TRUST_PROXY=1` hinter einem
Reverse-Proxy, `MAIL_DISABLED`, `MAIL_REDIRECT` (Tests). Der Server muss in der
Zeitzone der Schule laufen (z. B. `TZ=Europe/Berlin`).

## Microsoft 365

- **App „Anmeldesystem“** (Sekretariats-SPA): SPA-Plattform mit Redirect-URI,
  delegierte Graph-Berechtigungen für SharePoint. Benutzer brauchen Zugriff auf die Site.
- **App „Anmeldesystem Public Daemon“** (Rust-Server): Client Credentials,
  `Lists.SelectedOperations.Selected` mit Rechten nur auf die benötigten Listen
  (`node scripts/daemon-permissions.ts show|grant`), `Mail.Send` für das
  Absenderpostfach über Exchange RBAC for Applications.
- Empfehlung: In der Liste `Applications` die Berechtigung auf Elementebene auf
  „Nur eigene Elemente lesen“ setzen.

## SVWS-/SchILD-NRW-Testserver

Für die spätere Übertragung in die Schuldatenbank startet `make` den offiziellen
**SVWS-Server** (`svwsnrw/svws-server`, REST-API und Web-Client, Serverseite von
SchILD-NRW 3) mit **MariaDB** als rootless Docker-Container – nur auf `localhost`.

```sh
make svws-init     # Images laden, erster Start mit der Testschule (GymAbi)
make svws-check    # API-Test: Version und Stammdaten der Testschule
make svws-up       # weitere Starts, Daten bleiben erhalten
make svws-logs     # Log verfolgen
make svws-down     # stoppen
make svws-reset    # alle SVWS-/MariaDB-Daten löschen
```

- Web-Client und API: https://localhost:8443 (selbstsigniertes Zertifikat)
- Testschule „Albert Zweistein Gymnasium“ (Schema `gymabi`), Benutzer `Admin` ohne Passwort
- Zugangsdaten der Datenbank: `docker/svws/.env` (wird mit Zufallspasswörtern erzeugt)
- SchILD-NRW 3 (Windows-Client) kann sich mit diesem SVWS-Server verbinden.
- Für den Weg „Browser → SVWS“ muss im SVWS-Server CORS erlaubt sein
  (`UseCORSHeader` in `svwsconfig.json`), sonst „Browser → CORS-Proxy → SVWS“ wählen.

**Übertragung aus dem Sekretariat** (SVWS-Adapter):
1. Einstellungen → SVWS: Adresse, Verbindung und **Datenbank-Schema** der Schule
   (Testserver: `https://localhost:8443`, Verbindung „Browser → CORS-Proxy“,
   Proxy-Adresse `http://localhost:5173/svws-proxy` – der Entwicklungsserver leitet weiter –,
   Schema `gymabi`); optional das Schuljahr der Neuaufnahmen.
2. Anmeldungen → freigegebene Anmeldungen auswählen → „Ausgewählte an SVWS übertragen …“ →
   SVWS-Benutzer und Passwort (werden nicht gespeichert) → „Verbindung prüfen“ → übertragen.
3. Angelegt werden Schüler (Status Aufnahme, Jahrgang 05), Stammdaten mit Adresse, Herkunft,
   Religion und **Passfoto** sowie die Erziehungsberechtigten. Katalogwerte werden zur Laufzeit
   aus SVWS gelesen; was nicht zugeordnet werden kann, erscheint als Warnung. Vollständig
   übertragene Anmeldungen erhalten den Status „In SVWS übernommen“ und die Schüler-ID;
   eine zweite Übertragung wird verhindert.

`make test-svws` prüft den Adapter gegen den laufenden Testserver.

Version und Ports lassen sich in `docker/svws/.env` ändern (`SVWS_VERSION`,
`SVWS_PORT`, `MARIADB_PORT`).

## Sicherheit und Datenschutz

- personenbezogene Daten nur in SharePoint; der Server protokolliert keine Inhalte
- Familien erhalten einen Zugangsschlüssel für ihre Anmeldung; gespeichert wird nur dessen Hash
- Secrets nie im Browser-Code (geprüft in den Tests), `.env` ist Testinfrastruktur

## Lizenz

[MIT](LICENSE). Mitgelieferte Schrift: DejaVu Sans
([Lizenz](packages/pdf/fonts/LICENSE-DejaVu.txt)). Abhängigkeiten unter ihren
jeweiligen Lizenzen (u. a. Svelte, pdf-lib, MSAL – MIT; tiny_http, ureq, serde – MIT/Apache-2.0).
