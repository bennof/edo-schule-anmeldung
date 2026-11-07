# edo-anmeldung-server

Öffentlicher Server des Anmeldesystems: liefert die Anmeldeseite für die
Familien aus und stellt die API für Terminbuchung, Anmeldebogen und Uploads
bereit. Die Daten liegen in SharePoint; der Server selbst speichert keine
personenbezogenen Daten.

- ein einzelnes, statisch gebautes Binary (musl), läuft auf jeder Linux-Distribution
- die Anmeldeseite (`apps/public`) ist beim Bau eingebettet
- Zugriff auf SharePoint über die App-Registrierung `<Name> Server` aus
  [`setup-tenant.ps1`](../scripts/tenant/README.md), nur auf die Listen der eigenen Site

## Installation mit systemd (Debian-Paket)

Für Debian 12/13 und Ubuntu 22.04/24.04, `amd64` oder `arm64`. Die Pakete
liegen im [Release](https://github.com/bennof/edo-schule-anmeldung/releases).

```sh
sudo apt install ./edo-anmeldung-server_<version>_amd64.deb
sudoedit /etc/edo-anmeldung-server/config.env
sudo systemctl enable --now edo-anmeldung-server
```

Das Paket installiert:

| Pfad | Inhalt |
|---|---|
| `/usr/bin/edo-anmeldung-server` | der Server |
| `/usr/lib/systemd/system/edo-anmeldung-server.service` | der Dienst ([Vorlage](../packaging/edo-anmeldung-server.service)) |
| `/etc/edo-anmeldung-server/config.env` | Einstellungen, nur für root lesbar ([Vorlage](../packaging/config.env)) |
| `/usr/share/edo-anmeldung-server/nginx/edo-anmeldung.conf` | nginx-Snippet ([Vorlage](../packaging/nginx/edo-anmeldung.conf)) |
| `/etc/nginx/snippets/edo-anmeldung.conf` | Kopie des Snippets, nur wenn nginx schon installiert ist |

Dazu legt es den Systembenutzer `edo-anmeldung-server` an. Der Dienst wird
**nicht** automatisch gestartet oder aktiviert; das passiert erst mit
`systemctl enable --now`, nachdem die Einstellungen eingetragen sind.

## Einstellungen

`/etc/edo-anmeldung-server/config.env`, eine Zeile `NAME=wert` je Einstellung.
Die ersten vier Werte stehen in der `<name>.env`, die `setup-tenant.ps1 init`
erzeugt.

| Name | Pflicht | Bedeutung |
|---|---|---|
| `TENANT_ID` | ja | Microsoft-365-Tenant |
| `DAEMON_CLIENT_ID` | ja | Client-ID der App `<Name> Server` |
| `DAEMON_CLIENT_SECRET` | ja | Client-Secret dieser App |
| `SHAREPOINT_ID` | ja | Site mit den Listen |
| `BIND_ADDR` | nein | Adresse und Port, Standard `127.0.0.1:23180` |
| `TRUST_PROXY` | nein | `1` hinter nginx: Client-IP aus `X-Forwarded-For`, Standard `0`; siehe [TRUST_PROXY](#trust_proxy-verantwortung-des-betreibers) |
| `FRAME_ANCESTORS` | nein | wer die Seite in einem Frame einbetten darf, Standard `'self'`, z. B. `"'self' https://www.schule.de"` |
| `WORKERS` | nein | Anzahl gleichzeitiger Anfragen, Standard `8` |

`TZ=Europe/Berlin` setzt der Dienst selbst. Nach einer Änderung:

```sh
sudo systemctl restart edo-anmeldung-server
```

## Betrieb

```sh
systemctl status edo-anmeldung-server          # läuft der Dienst?
journalctl -u edo-anmeldung-server -f          # Protokoll
curl http://127.0.0.1:23180/api/status         # Server und SharePoint-Verbindung
```

`/api/status` antwortet mit `{"status":"ok","version":…,"sharepoint":"ok"}`,
wenn der Server SharePoint erreicht. `/api/health` prüft nur, ob der Server läuft.

Fehlt eine Pflichteinstellung, beendet sich der Server mit
`missing setting <NAME>`, und systemd versucht es alle 5 Sekunden erneut.
Das steht im Protokoll.

## Reverse-Proxy (nginx)

Der Server spricht nur HTTP und lauscht standardmäßig nur lokal. Für HTTPS
bindet man ihn mit dem Snippet `edo-anmeldung.conf` in eine `location` einer
bestehenden HTTPS-Site von nginx ein.

Ist nginx bei der Installation des Pakets schon vorhanden, liegt das Snippet
bereits in `/etc/nginx/snippets/`. Sonst nach der Installation von nginx kopieren:

```sh
sudo cp /usr/share/edo-anmeldung-server/nginx/edo-anmeldung.conf /etc/nginx/snippets/
```

In der Site (z. B. `/etc/nginx/sites-available/default`) einbinden:

```nginx
location /anmeldung/ {
    include snippets/edo-anmeldung.conf;
}
```

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Der Pfad ist frei wählbar (`/anmeldung/`, `/schulanmeldung/`, `/`), muss aber
mit `/` enden. nginx entfernt ihn vor dem Weiterleiten (`/anmeldung/api/…` →
`/api/…`); die Anmeldeseite verwendet relative Pfade und funktioniert unter
jedem Pfad. Im Sekretariat muss `publicUrl` die volle Adresse sein, z. B.
`https://www.schule.de/anmeldung/`, sonst stimmt der Link in der Bestätigungsmail nicht.

Das Snippet erlaubt Uploads bis 5 MB und setzt `X-Forwarded-For` auf die
Adresse des Clients. Der Server nimmt den ersten Eintrag dieses Headers;
deshalb darf nginx ihn nicht anhängen (`$proxy_add_x_forwarded_for`), sonst
könnte ein Client eine Adresse vortäuschen.

Ein Update des Pakets überschreibt ein geändertes Snippet nicht, sondern legt
die neue Version als `edo-anmeldung.conf.dpkg-dist` daneben. Das gilt auch für
ein unverändertes Snippet einer älteren Version: nach einem Update auf
`.dpkg-dist` prüfen und bei Bedarf übernehmen. Das Paket ändert keine Sites
und lädt nginx nicht neu; `apt purge` lässt das Snippet stehen, damit nginx
weiter startet.

### TRUST_PROXY: Verantwortung des Betreibers

Der Server begrenzt die Buchungen je IP-Adresse (`maxBookingsPerIp` in der
Config-Liste, Standard 3). Welche Adresse er dafür nimmt, bestimmt `TRUST_PROXY`
in `config.env`. Die Einstellung muss zum Aufbau passen; das Paket setzt sie
nicht automatisch.

| Aufbau | `TRUST_PROXY` | `BIND_ADDR` |
|---|---|---|
| hinter nginx mit dem Snippet | **`1`** | `127.0.0.1:23180` (nur lokal) |
| ohne Reverse-Proxy, direkt erreichbar | `0` | z. B. `0.0.0.0:23180` |

- **Hinter nginx mit `TRUST_PROXY=0`** sieht der Server bei jeder Anfrage die
  Adresse von nginx. Nach 3 Buchungen je Verfahren bekommen alle weiteren
  Familien „Limit erreicht“.
- **`TRUST_PROXY=1` ohne Reverse-Proxy** oder mit einem Server, der von außen
  direkt erreichbar ist: Jeder Client kann einen eigenen `X-Forwarded-For`-Header
  senden und so die Begrenzung umgehen. Mit `TRUST_PROXY=1` darf der Server
  deshalb nur auf `127.0.0.1` lauschen.
- **Steht vor nginx ein weiterer Proxy** (Firewall der Schule, CDN), sieht nginx
  nur dessen Adresse. Dann zählen wieder alle Familien als eine Adresse; nginx
  muss in diesem Fall die echte Adresse übernehmen (`real_ip`-Modul) oder die
  Begrenzung wird mit `maxBookingsPerIp = 0` abgeschaltet.
- Familien hinter derselben Adresse (Mobilfunk, gemeinsames WLAN) teilen sich
  die Begrenzung. Bei Bedarf `maxBookingsPerIp` erhöhen.

Nach einer Änderung: `sudo systemctl restart edo-anmeldung-server`.

## Client-Secret erneuern

Das Secret läuft ab (Datum: `daemonSecretExpires` in der Config-Liste). Vorher:

1. `pwsh setup-tenant.ps1 refresh -Name "<Name>"` ausführen, siehe
   [`scripts/tenant/README.md`](../scripts/tenant/README.md).
2. Den neuen `DAEMON_CLIENT_SECRET` in `config.env` eintragen.
3. `sudo systemctl restart edo-anmeldung-server` und `/api/status` prüfen.
4. Erst dann im Skript das Löschen der alten Secrets bestätigen.

## Update und Entfernen

```sh
sudo apt install ./edo-anmeldung-server_<neue-version>_amd64.deb   # behält config.env, startet einen laufenden Dienst neu
sudo apt remove edo-anmeldung-server                               # stoppt den Dienst, config.env bleibt
sudo apt purge edo-anmeldung-server                                # entfernt auch config.env und den Benutzer (das nginx-Snippet bleibt)
```

## Sicherheit

Der Dienst läuft als eigener Benutzer ohne Rechte und ohne Capabilities. Er hat
keinen Schreibzugriff auf das System und kein Home-Verzeichnis. Er darf nur
ausgehende Verbindungen (HTTPS zu Microsoft) aufbauen und auf seinem Port lauschen.
Die Einstellungen in [`edo-anmeldung-server.service`](../packaging/edo-anmeldung-server.service)
sind kommentiert.

## Ohne Debian-Paket

Auf anderen Distributionen das Binary `edo-anmeldung-server-linux-<amd64|arm64>`
aus dem Release verwenden:

```sh
sudo install -m 755 edo-anmeldung-server-linux-amd64 /usr/bin/edo-anmeldung-server
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin edo-anmeldung-server
sudo install -d -m 755 /etc/edo-anmeldung-server
sudo install -m 600 packaging/config.env /etc/edo-anmeldung-server/config.env
sudo install -m 644 packaging/edo-anmeldung-server.service /etc/systemd/system/
sudo install -m 644 packaging/nginx/edo-anmeldung.conf /etc/nginx/snippets/   # mit nginx
sudo systemctl daemon-reload
```

Danach wie oben die Einstellungen eintragen und den Dienst aktivieren.

## Entwicklung

```sh
make dev-server      # cargo run auf :23180, liest die .env im Repository
make build-server    # statisches Binary mit eingebetteter Anmeldeseite
make deb             # Debian-Paket nach dist/
```

Ohne systemd liest der Server seine Einstellungen aus der Umgebung, sonst aus
`ENV_FILE`, `.env` oder `../.env` (die erste vorhandene Datei).
