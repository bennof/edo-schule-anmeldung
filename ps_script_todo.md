# PowerShell-Skript: Einrichtung in Entra und SharePoint

Ziel: Ein Skript (`scripts/setup-tenant.ps1`) richtet einen Schul-Tenant so ein,
dass Sekretariat, Desktop-App und Server ohne Handarbeit laufen. Grundlage ist
der Stand des Test-Tenants vom 2026-11-04; die Berechtigungen wurden aus den
Tokens der beiden Apps abgelesen.

Module: `Microsoft.Graph` (Applications, Sites), `ExchangeOnlineManagement`.
Ausführen als Global Admin bzw. Application Admin + SharePoint Admin + Exchange Admin.

## Eingaben

- [ ] Tenant (Domain oder ID)
- [ ] SharePoint-Site: Adresse, z. B. `https://<tenant>.sharepoint.com/sites/Anmeldung`; neu anlegen, falls nicht vorhanden
- [ ] Adresse(n) des Sekretariats als Redirect-URI (Web-Variante, z. B. `https://sekretariat.schule.de`)
- [ ] Absenderpostfach der Bestätigungsmail, z. B. `anmeldung@schule.de`
- [ ] Adresse der öffentlichen Anmeldeseite (`publicUrl`), Schulname
- [ ] Gruppe(n) der Sekretariats-Mitarbeitenden

## 1. SharePoint-Site

- [ ] Site anlegen oder vorhandene verwenden; Site-ID ermitteln (`Get-MgSite -SiteId "<host>:/sites/<name>"`, Format `host,siteCollectionId,webId`)
- [ ] Sekretariats-Gruppe als **Mitglieder** (Bearbeiten) eintragen
- [ ] Mindestens eine Person als **Besitzer**: Sie führt im Sekretariat „Site initialisieren“ aus (legt die Listen an)

## 2. App-Registrierung „Anmeldesystem“ (Sekretariat, Desktop-App)

- [ ] App-Registrierung anlegen, Single Tenant
- [ ] Plattform **Single-Page Application** mit Redirect-URIs:
  - Adresse des Sekretariats (Web)
  - `http://localhost:8964` (Desktop-App)
- [ ] Delegierte Graph-Berechtigungen: `Sites.Selected`, `User.Read` (Profilfoto, Name); `openid`, `profile`, `email` kommen automatisch
- [ ] Admin-Zustimmung für den Tenant erteilen
- [ ] Site-Berechtigung für diese App auf die Site: **`fullcontrol`** (Listen anlegen beim Initialisieren). Mit `Sites.Selected` greift die App nur auf freigegebene Sites zu; wirksam ist die Schnittmenge aus App-Freigabe und den Rechten der angemeldeten Person
  - Graph: `POST /sites/{site-id}/permissions` mit `roles: ["fullcontrol"]`, `grantedTo.application = { id, displayName }`; für `fullcontrol` ggf. erst `write` anlegen und dann auf `fullcontrol` ändern (Graph-Einschränkung prüfen)
  - Alternative: PnP `Grant-PnPAzureADAppSitePermission`
- [ ] Kein Client-Secret und keine Anwendungsberechtigungen für den Betrieb. Im Test-Tenant hat die App zusätzlich die Anwendungsberechtigung `Sites.Selected` mit Secret, nur für die automatisierten Tests

## 3. App-Registrierung „Anmeldesystem Public Daemon“ (Rust-Server)

- [ ] App-Registrierung anlegen, Single Tenant, ohne Redirect-URI
- [ ] Client-Secret anlegen (oder Zertifikat, siehe offene Punkte); Ablaufdatum ausgeben und als Erinnerung notieren
- [ ] Anwendungsberechtigung `Lists.SelectedOperations.Selected`; Admin-Zustimmung
- [ ] **Kein** `Sites.Selected` (im Test-Tenant noch vorhanden, wird nicht mehr gebraucht)
- [ ] **Keine** tenantweite Zustimmung für `Mail.Send` in Entra (sonst darf der Server als jedes Postfach senden), stattdessen Schritt 4. Im Test-Tenant steht `Mail.Send` noch im Token: prüfen und die Entra-Zustimmung entfernen
- [ ] Listenrechte erst **nach** „Site initialisieren“ (die Listen müssen existieren), wie `scripts/daemon-permissions.ts grant`:

  | Liste | Recht |
  |---|---|
  | Config, Assets, Forms, Procedures | `read` |
  | Appointments, Applications, Uploads | `write` |

  Graph: `POST /sites/{site-id}/lists/{list-id}/permissions` mit `roles: [<recht>]`, `grantedTo.application = { id, displayName }`

## 4. Exchange: Mailversand nur aus dem Absenderpostfach

- [ ] Postfach anlegen, falls nicht vorhanden (Shared Mailbox genügt)
- [ ] Exchange RBAC for Applications:
  - `New-ServicePrincipal -AppId <daemon-client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Anmeldesystem Public Daemon"`
  - `New-ManagementScope -Name "Anmeldesystem Absender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '<postfach>'"`
  - `New-ManagementRoleAssignment -App <daemon-client-id> -Role "Application Mail.Send" -CustomResourceScope "Anmeldesystem Absender"`
- [ ] Prüfen: `Test-ServicePrincipalAuthorization -Identity <daemon-client-id> -Resource <postfach>` erlaubt, ein anderes Postfach verweigert

## 5. Nach dem Initialisieren der Site

- [ ] Hinweis ausgeben: Sekretariat öffnen, als Besitzer anmelden, „Einstellungen → Site initialisieren“
- [ ] Danach Listenrechte für den Daemon setzen (Schritt 3) oder das Skript mit `-ListGrantsOnly` erneut starten
- [ ] Config-Liste füllen: `schoolName`, `publicUrl`, `mailSender` (übrige Werte legt das Initialisieren an)
- [ ] Empfehlung umsetzen: Liste `Applications`, Berechtigung auf Elementebene „Nur eigene Elemente lesen“

## 6. Ausgaben des Skripts

- [ ] Browser-Konfiguration des Sekretariats als JSON (Import über „Einstellungen“ bzw. Zahnrad): `schemaVersion`, `tenantId`, `clientId`, `siteId`, `siteUrl`, optional `redirectUri`
- [ ] Server-Umgebung (`.env` bzw. Dienst): `TENANT_ID`, `DAEMON_CLIENT_ID`, `DAEMON_CLIENT_SECRET`, `SHAREPOINT_ID`; dazu `BIND_ADDR`, `TRUST_PROXY`, `FRAME_ANCESTORS`, `TZ=Europe/Berlin`. Das Secret nur einmal anzeigen bzw. direkt in die Datei schreiben, nie ins Log
- [ ] Zusammenfassung mit Ablaufdatum des Secrets

## 7. Prüfung am Ende

- [ ] Daemon-Token holen: `roles` enthält nur `Lists.SelectedOperations.Selected`
- [ ] Server: `GET /api/status` liefert `sharepoint: ok`
- [ ] Sekretariat: „Einstellungen → Verbindungen“ zeigt SharePoint, Server und SVWS grün

## Offene Punkte

- [ ] Zertifikat statt Client-Secret für den Daemon (der Server kann bisher nur Secrets)
- [ ] Idempotenz: Das Skript darf mehrfach laufen und vorhandene Apps, Rechte und Scopes nicht doppelt anlegen
- [ ] SVWS ist nicht Teil des Tenants: Adresse, Schema und Proxy bleiben Einstellungen im Sekretariat
- [ ] Kann `fullcontrol` der SPA-App nach dem Initialisieren auf `write` reduziert werden? Testen (Schema-Updates brauchen evtl. wieder `fullcontrol`)
