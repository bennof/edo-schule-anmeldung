# setup-tenant.ps1

Richtet das Anmeldesystem in einem Microsoft-365-Tenant ein, erneuert das
Client-Secret des Servers oder entfernt alles wieder.

```sh
pwsh setup-tenant.ps1 init                                  # neues System anlegen
pwsh setup-tenant.ps1 refresh -Name "Anmeldung Gymnasium"   # neues Client-Secret für den Server
pwsh setup-tenant.ps1 remove -File anmeldung-gymnasium_config.json   # alles entfernen
```

Dateien in diesem Ordner:

| Datei | Inhalt |
|---|---|
| `setup-tenant.ps1` | das Skript |
| `sharepoint-schema.json` | Listen, Spalten und Startwerte der Config-Liste; muss neben dem Skript liegen |
| `export-schema.ts` | erzeugt `sharepoint-schema.json` (`make tenant-schema`) |

Im Release liegen Skript und Schema als `edo-anmeldung-tenant-setup.zip`.

## Voraussetzungen

- PowerShell 7.2 oder neuer (`pwsh`) unter Windows, Linux oder macOS
- ein Konto mit der Rolle **Globaler Administrator** im Ziel-Tenant
- Internetzugang; die Module `Microsoft.Graph.Authentication` und
  `ExchangeOnlineManagement` installiert das Skript bei Bedarf für den
  aktuellen Benutzer

Die Anmeldung läuft mit Gerätecode: Das Skript zeigt einen Code an, den man
unter https://microsoft.com/devicelogin in einem beliebigen Browser eingibt.
Das geht auch per SSH. Exchange verlangt eine zweite Anmeldung auf dieselbe Art.

## Parameter

| Parameter | Bedeutung |
|---|---|
| `init`, `refresh`, `remove` | Modus (Pflicht, erste Angabe) |
| `-Name` | Name des Systems; wird sonst abgefragt (`init`, `refresh`) |
| `-OutDir` | Ordner für `<name>.env` und `<name>_config.json`, Standard: aktueller Ordner |
| `-File` | `remove`: die `<name>_config.json` des Systems |
| `-TenantId` | Tenant für die Anmeldung, falls das Konto in mehreren Tenants ist |

Aus dem Namen wird ein Kurzname gebildet (klein, Bindestriche, z. B.
„Anmeldung Gymnasium“ → `anmeldung-gymnasium`). Er wird für die Gruppe, die
Site-Adresse und die Dateinamen verwendet.

## init

Legt an:

| Was | Name | Zweck |
|---|---|---|
| Microsoft-365-Gruppe mit Teamwebsite | `<Name>`, Site `/sites/<kurzname>` | Daten; wer das Skript startet, wird Besitzer |
| Listen und Bibliothek | aus `sharepoint-schema.json` | Config, Assets, Appointments, Applications, Forms, Procedures, Uploads |
| App-Registrierung | `<Name> Sekretariat` | Anmeldung im Sekretariat und in der Desktop-App |
| App-Registrierung | `<Name> Server` | Server mit Client-Secret, Zugriff nur auf die Listen dieser Site |
| Exchange-Regeln | `<Name> Absender`, `<Name> Mail.Send` | der Server darf nur aus dem Absenderpostfach senden |
| Absenderpostfach | Vorschlag `noreply-<kurzname>@<domäne>` | Bestätigungsmails an die Familien |

Abgefragt werden der Name, weitere Adressen des Sekretariats (z. B.
`https://sekretariat.schule.de`) und das Absenderpostfach.
`http://localhost:8964` (Desktop-App) und `http://localhost:8944` (Sekretariat
lokal) sind immer eingetragen.

Rechte:

- **Sekretariat:** delegierte Graph-Rechte mit Admin-Zustimmung. Jede Person
  sieht nur, worauf sie selbst Zugriff hat, also die Site, wenn sie Mitglied der
  Gruppe ist.
- **Server:** nur `Lists.SelectedOperations.Selected`. Er darf Config, Assets,
  Forms und Procedures lesen und Appointments, Applications und Uploads schreiben.
  Andere Listen, Dokumente und Sites sieht er nicht.

Das Client-Secret gilt 24 Monate. Lässt der Tenant das nicht zu, versucht das
Skript 12, 6 und 3 Monate. Das Ablaufdatum steht als `daemonSecretExpires` in
der Config-Liste und in der `<name>_config.json`.

Ergebnis im Ausgabeordner:

| Datei | Inhalt | Wohin |
|---|---|---|
| `<kurzname>.env` | vollständige Server-Konfiguration: `TENANT_ID`, `DAEMON_CLIENT_ID`, `DAEMON_CLIENT_SECRET`, `SHAREPOINT_ID`, dazu `BIND_ADDR`, `TRUST_PROXY` und `FRAME_ANCESTORS` mit Standardwerten | auf den Server als `/etc/edo-anmeldung-server/config.env`, enthält das Secret |
| `<kurzname>_config.json` | Tenant, Client-ID des Sekretariats, Site, Ablaufdatum | im Sekretariat unter Einstellungen importieren |

Danach:

1. Werte aus `<kurzname>.env` in die Server-Konfiguration übernehmen, siehe [`server/README.md`](../../server/README.md).
2. Sekretariat oder Desktop-App: Tenant-ID und Client-ID eintragen, anmelden,
   `<kurzname>_config.json` importieren.
3. Personen aus dem Sekretariat zur Gruppe `<Name>` hinzufügen.
4. Im Sekretariat die Adresse der öffentlichen Anmeldeseite (`publicUrl`) eintragen.

Ein zweiter Lauf mit demselben Namen verwendet alles Vorhandene weiter und
ergänzt nur, was fehlt. Bestehende Listen und Spalten werden nie geändert oder
gelöscht.

## refresh

Erzeugt ein neues Client-Secret für `<Name> Server` und schreibt eine neue
`<kurzname>.env`. Das neue Ablaufdatum kommt in die Config-Liste und, falls sie
im Ausgabeordner liegt, in die `<kurzname>_config.json`.

Alte Secrets werden erst nach Rückfrage gelöscht. Deshalb erst die neuen
Werte auf dem Server eintragen und den Dienst neu starten, dann bestätigen.

## remove

```sh
pwsh setup-tenant.ps1 remove -File <kurzname>_config.json
```

Entfernt alles, was `init` angelegt hat: die Exchange-Regeln, beide
App-Registrierungen und die Gruppe mit der Site und **allen Daten** (Listen,
Anmeldungen, Uploads).

- Vorher prüft das Skript, dass Tenant, App und Site zur Datei passen, und
  zeigt an, was gelöscht wird.
- Zur Bestätigung muss der Name genau eingetippt werden; bei falscher Eingabe
  wird nichts gelöscht.
- Das Absenderpostfach wird nur nach eigener Rückfrage gelöscht.
- Gruppe, Apps und Postfach landen im Papierkorb und sind 30 Tage
  wiederherstellbar: Entra Admin Center unter „Gelöschte Gruppen“ und
  „Gelöschte Anwendungen“, das Postfach im Exchange Admin Center.
- Lokale Dateien bleiben liegen.

## Schema

`sharepoint-schema.json` wird aus `packages/sharepoint/src/schema.ts` erzeugt
und nicht von Hand bearbeitet. Jede Änderung an Listen, Spalten oder
Startwerten braucht einen neuen Eintrag in `SCHEMA_HISTORY`, danach
`make tenant-schema`. `make check` prüft, dass JSON und Code übereinstimmen.

## Sicherheit

- Secrets werden nie angezeigt, nur in die `.env` geschrieben (unter Linux und
  macOS mit Rechten `600`).
- Die `.env` nicht weitergeben und nicht ins Repository legen.
