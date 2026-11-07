<img src="docs/brand/symbol-512.png" alt="Anmeldesystem" width="128">

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
- Verfahren (Löschen entfernt auch Termine, Anmeldungen und Uploads, nicht die Formulare), Formulare (Designer mit Vorschau als Arbeitsfläche, Import mit Schema-Prüfung, Löschen nur ohne verwendende Verfahren), Dateien (Logo, Kataloge, PDF-Vorlage)
- Einstellungen: SharePoint-Provisionierung, Konfigurationsliste, Browser-Konfiguration (Import/Export)

**Öffentlicher Server** (`server`, Rust)
- ein Binary für alles Öffentliche: die Anmeldeseite ist beim Bau eingebettet, dazu die API unter `/api`
- schmale API für die öffentliche SPA, Zugriff auf SharePoint nur mit Listenrechten
- Verbindungstest `/api/status` (Server läuft, erreicht SharePoint) für die Einstellungen im Sekretariat
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
desktop               Sekretariat als Desktop-App (Tauri) mit SVWS-Proxy
tests                 Integrations-, Browser-, SVWS- und Mailtests (Vitest)
scripts               daemon-permissions (Listenrechte der Daemon-App), check-version (Release)
scripts/tenant        setup-tenant.ps1: Einrichtung eines Tenants; sharepoint-schema.json
packaging             Debian-Paket des Servers: systemd-Dienst, config.env, build-deb.sh; nginx-Snippet
.github/workflows     CI (jeder Push) und Release (Tag vX.Y.Z)
docs                  Sprint-Reviews, Logo; bisheriges Anmeldeformular (Word) nur lokal in docs/reference/
```

## Voraussetzungen

- Node.js 24, pnpm, Rust (rustup), GNU Make
- Debian/Ubuntu: `make system-deps` (musl-tools für den statischen Server,
  WebKitGTK u. a. für die Desktop-App); Rust-Ziel `rustup target add x86_64-unknown-linux-musl`
- für `make test-svws`: ein erreichbarer SVWS-Server mit der Testschule (siehe unten)
- Microsoft-365-Tenant mit einer SharePoint-Site und zwei App-Registrierungen (siehe unten)

`make doctor` prüft die Werkzeuge.

**Windows:** Das Makefile braucht bash und GNU-Werkzeuge, also WSL (oder Git Bash
mit make). Ohne Make baut `pnpm build` alles in der richtigen Reihenfolge
(SPAs, dann `server/target/release/edo-anmeldung-server.exe` mit eingebetteter
Anmeldeseite und `desktop/target/release/edo-anmeldung.exe` mit eingebettetem
Sekretariat; Rust mit MSVC-Toolchain). `.cargo/config.toml` linkt die C-Laufzeit
statisch, beide sind einzelne `.exe` ohne weitere Dateien (die Desktop-App nutzt
das in Windows 10/11 enthaltene WebView2). Ebenso laufen `pnpm dev:server`, `pnpm dev:public`,
`pnpm dev:secretariat` sowie die Tests (`pnpm exec vitest run --config
tests/vitest.config.ts tests/…`) auch direkt unter Windows. Der Server läuft dort
in der Zeitzone des Systems (`TZ` wird unter Windows nicht beachtet).

## Schnellstart

```sh
cp .env.example .env        # Werte eintragen (siehe info.md)
make install
make dev                    # Server :23180, Public :8954, Sekretariat :8944
```

Im Sekretariat (http://localhost:8944) anmelden, unter „Einstellungen“ die Site
initialisieren, unter „Formulare“ ein Formular importieren (JSON), unter „Dateien“ den Standard-Anmeldebogen hochladen, unter „Verfahren“
ein Verfahren anlegen, unter „Termine“ Termine erzeugen und veröffentlichen.

## Make-Targets

`make help` listet alle Targets. Die wichtigsten:

| Target | Zweck |
|---|---|
| `make build` / `make dist` | Sekretariat, Server (mit Anmeldeseite) und Desktop-App bauen / nach `dist/` |
| `make deb` | Debian-Paket des Servers nach `dist/` (arm64: `MUSL=aarch64-unknown-linux-musl DEB_ARCH=arm64`) |
| `make check` | Typprüfung, Rust-Lints, Formatierung |
| `make test` | Unit-Tests (TypeScript, Rust) |
| `make test-integration` | gegen die SharePoint-Test-Site |
| `make test-e2e` | Browser-Tests (headless Chromium, M365-Testbenutzer) |
| `make test-mail` | eine Testbuchung → genau eine Mail an `MAIL_TEST_TO` |
| `make test-svws` | SVWS-Adapter gegen den SVWS-Server aus `.env` |
| `make generate` | Kataloge und PDF-Vorlage neu erzeugen |
| `make clean` | alles Erzeugte löschen, auch `node_modules` und `server/target` |

Einzelne Befehle ohne Make: `pnpm dev:server`, `pnpm dev:public`, `pnpm dev:secretariat`.
Die Tests liegen unter `tests/` (`integration`, `e2e`, `svws`, `mail`) und laufen mit
Vitest gegen die echten Systeme, nacheinander statt parallel.

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
(Standard `127.0.0.1:23180`), `WORKERS`, `TRUST_PROXY=1` hinter einem
Reverse-Proxy, `FRAME_ANCESTORS` (wer die Anmeldeseite in einem Frame einbinden
darf, Standard `'self'`, z. B. `'self' https://www.schule.de`), `MAIL_DISABLED`,
`MAIL_REDIRECT` (Tests). Der Server muss in der Zeitzone der Schule laufen
(z. B. `TZ=Europe/Berlin`).

**Bau und Betrieb:** `make dist` erzeugt `dist/edo-anmeldung-server` (unter Linux
statisch gegen musl gelinkt, läuft auf jeder Distribution), `dist/edo-anmeldung`
und `dist/secretariat/`. Beim Bau des Servers wird `apps/public/dist` in das Binary
eingebettet (`server/build.rs`); im Betrieb braucht es keine weiteren Dateien.
Der Server liefert die Seite mit CSP, `nosniff` und `no-referrer`, `index.html`
ohne Cache, die gehashten Dateien unter `/assets/` dauerhaft cachebar.
Unbekannte Pfade ohne Dateiendung bekommen `index.html`. Ein reines
`cargo build` ohne gebaute Seite liefert nur die API (Entwicklung über Vite).

**Server als Debian-Paket** (`edo-anmeldung-server_<version>_<amd64|arm64>.deb`,
Debian 12/13, Ubuntu 22.04/24.04):

```sh
sudo apt install ./edo-anmeldung-server_*.deb
sudoedit /etc/edo-anmeldung-server/config.env    # Werte aus <name>.env von setup-tenant.ps1
sudo systemctl enable --now edo-anmeldung-server
journalctl -u edo-anmeldung-server -f
```

Das Paket legt den Systembenutzer `edo-anmeldung-server` an und installiert
`/usr/bin/edo-anmeldung-server` und den Dienst
[`packaging/edo-anmeldung-server.service`](packaging/edo-anmeldung-server.service).
Der Dienst wird **nicht** automatisch aktiviert. Die Einstellungen stehen in
`/etc/edo-anmeldung-server/config.env` (nur für root lesbar, Vorlage:
[`packaging/config.env`](packaging/config.env)); systemd liest sie beim Start,
`TZ=Europe/Berlin` ist voreingestellt. Ein Update behält die Einstellungen und
startet einen laufenden Dienst neu; `apt purge` entfernt Einstellungen und Benutzer.
Der Dienst läuft ohne Rechte und mit systemd-Härtung (kein Schreibzugriff aufs
System, keine Capabilities); für Port 80/443 nginx mit dem mitgelieferten Snippet davorsetzen, Details und `TRUST_PROXY`: [`server/README.md`](server/README.md).

## Desktop-App (Sekretariat)

`desktop/` ist eine Tauri-App: Sie startet einen lokalen Server auf
**http://localhost:8964** mit dem eingebetteten Sekretariat und öffnet ihn in
einem Fenster. Unter `/svws-proxy` leitet sie SVWS-Anfragen an die Adresse aus
`X-SVWS-Target` weiter und akzeptiert selbstsignierte Zertifikate – damit
entfällt CORS im SVWS-Server. Die App nutzt diesen Proxy für SVWS immer
automatisch; unter „Einstellungen“ werden nur SVWS-Adresse, Schema und
Schuljahr eingetragen. Der Server nimmt nur Anfragen mit Host
`localhost:8964` an. Für die Anmeldung muss `http://localhost:8964` als
Redirect-URI der SPA-App eingetragen sein. Die Werte liegen im Speicher des
WebViews, getrennt vom Browser.

`make dev-desktop` startet sie (braucht einen Bildschirm). Unter Windows ist sie
eine einzelne `.exe`; unter Linux braucht sie WebKitGTK (glibc), kann daher
nicht statisch gebaut werden.

## Releases

Jeder Push: `make check` und `make test` (GitHub Actions, `.github/workflows/ci.yml`;
nur Tests ohne Tenant und Zugangsdaten). Ein Tag `vX.Y.Z` startet
`.github/workflows/release.yml`:

1. Prüfung, dass der Tag zu allen Versionen passt (`node scripts/check-version.ts vX.Y.Z`:
   `Cargo.toml`, `tauri.conf.json`, `package.json`), dann Checks und Tests
2. Bau aller Dateien, Prerelease mit `SHA256SUMS` und automatisch erzeugten Release-Notes
3. Nach Freigabe in der GitHub-Umgebung `release` wird das Prerelease zum Release

| Datei | Inhalt |
|---|---|
| `edo-anmeldung-server-linux-<amd64\|arm64>` | Server, statisch (musl) |
| `edo-anmeldung-server_<version>_<amd64\|arm64>.deb` | Server mit systemd-Dienst |
| `edo-anmeldung-linux-<amd64\|arm64>` | Desktop-App, braucht WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`); gebaut auf Debian 12 |
| `edo-anmeldung.exe` | Desktop-App Windows (WebView2; ohne Signatur warnt SmartScreen) |
| `edo-anmeldung.dmg` | Desktop-App macOS, Apple Silicon und Intel (ohne Signatur: beim ersten Start erlauben) |
| `edo-anmeldung-web.zip` | Sekretariat als statische Dateien, ohne Tenant (Einrichtung über das Zahnrad) |
| `edo-anmeldung-tenant-setup.zip` | `setup-tenant.ps1` und `sharepoint-schema.json` |

## Microsoft 365

Einrichtung eines neuen Systems mit PowerShell 7 als Admin (Anmeldung mit Gerätecode):

```sh
pwsh scripts/tenant/setup-tenant.ps1 init       # Gruppe, Site, Listen, App-Registrierungen, Mailversand
pwsh scripts/tenant/setup-tenant.ps1 refresh    # neues Client-Secret für den Server
pwsh scripts/tenant/setup-tenant.ps1 remove -File <name>_config.json   # alles wieder entfernen (Papierkorb)
```

`init` legt `<name>.env` (Server, mit Secret) und `<name>_config.json`
(Import im Sekretariat) an. Das Schema kommt aus `scripts/tenant/sharepoint-schema.json`;
jede Schema-Änderung braucht einen neuen Eintrag in `SCHEMA_HISTORY`
(`packages/sharepoint/src/schema.ts`), danach `make tenant-schema`.

- **App „Anmeldesystem“** (Sekretariats-SPA): SPA-Plattform mit Redirect-URI
  (Adresse des Sekretariats; Desktop-App: `http://localhost:8964`),
  delegierte Graph-Berechtigungen für SharePoint. Benutzer brauchen Zugriff auf die Site.
- **App „Anmeldesystem Public Daemon“** (Rust-Server): Client Credentials,
  `Lists.SelectedOperations.Selected` mit Rechten nur auf die benötigten Listen
  (`node scripts/daemon-permissions.ts show|grant`), `Mail.Send` für das
  Absenderpostfach über Exchange RBAC for Applications.
- Empfehlung: In der Liste `Applications` die Berechtigung auf Elementebene auf
  „Nur eigene Elemente lesen“ setzen.

## SVWS / SchILD-NRW

Die Übertragung in die Schuldatenbank läuft über die REST-API des
**SVWS-Servers** (Serverseite von SchILD-NRW 3). Für Entwicklung und Tests wird
ein vorhandener SVWS-Server mit der offiziellen Testschule „Albert Zweistein
Gymnasium“ (Schema `gymabi`, Benutzer `Admin` ohne Passwort) verwendet.
Standard ist `https://localhost:8443`; abweichend in `.env`: `SVWS_URL`,
`SVWS_SCHEMA`, `SVWS_USER`, `SVWS_PASSWORD`.

- Für den Weg „Browser → SVWS“ muss im SVWS-Server CORS erlaubt sein
  (`UseCORSHeader` in `svwsconfig.json`), sonst „Browser → CORS-Proxy → SVWS“ wählen.
  Der Entwicklungsserver des Sekretariats leitet `/svws-proxy` an `SVWS_URL` weiter,
  die Desktop-App nutzt immer ihren eingebauten Proxy.

**Übertragung aus dem Sekretariat** (SVWS-Adapter):
1. Einstellungen → SVWS: Adresse, Verbindung und **Datenbank-Schema** der Schule
   (Entwicklung: `https://localhost:8443`, Verbindung „Browser → CORS-Proxy“,
   Proxy-Adresse `http://localhost:8944/svws-proxy`, Schema `gymabi`); optional das Schuljahr der Neuaufnahmen.
2. Anmeldungen → freigegebene Anmeldungen auswählen → „Ausgewählte an SVWS übertragen …“ →
   SVWS-Benutzer und Passwort (werden nicht gespeichert) → „Verbindung prüfen“ → übertragen.
3. Angelegt werden Schüler (Status Aufnahme, Jahrgang 05), Stammdaten mit Adresse, Herkunft,
   Religion und **Passfoto** sowie die Erziehungsberechtigten. Katalogwerte werden zur Laufzeit
   aus SVWS gelesen; was nicht zugeordnet werden kann, erscheint als Warnung. Vollständig
   übertragene Anmeldungen erhalten den Status „In SVWS übernommen“ und die Schüler-ID;
   eine zweite Übertragung wird verhindert.

`make test-svws` prüft den Adapter und den Proxy der Desktop-App gegen den SVWS-Server aus `.env`.

## Sicherheit und Datenschutz

- personenbezogene Daten nur in SharePoint; der Server protokolliert keine Inhalte
- Familien erhalten einen Zugangsschlüssel für ihre Anmeldung; gespeichert wird nur dessen Hash
- Secrets nie im Browser-Code (geprüft in den Tests), `.env` ist Testinfrastruktur

## Autor

Benjamin Benno Falkner, <benno@falkner.xyz>, [github.com/bennof](https://github.com/bennof)

Bei der Entwicklung wurde KI eingesetzt: Teile von Code, vor allem Tests und
Dokumentation sind mit KI entstanden.

## Lizenz

[MIT](LICENSE). Mitgelieferte Schrift: DejaVu Sans
([Lizenz](packages/pdf/fonts/LICENSE-DejaVu.txt)). Abhängigkeiten unter ihren
jeweiligen Lizenzen (u. a. Svelte, pdf-lib, MSAL – MIT; tiny_http, ureq, serde – MIT/Apache-2.0).
