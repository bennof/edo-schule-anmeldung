# Sprint 8 – SVWS-Adapter

**Status:** Abgeschlossen. Freigegebene Anmeldungen werden aus dem Sekretariat in SVWS übertragen (Schüler, Stammdaten, Passfoto, Erziehungsberechtigte). Getestet gegen den lokalen SVWS-Server 1.4.1 mit der Testschule.

## Ergebnis

**Ablauf je Anmeldung** (`packages/svws`, Endpunkte aus der OpenAPI des Servers):
1. `POST /db/{schema}/schueler/create`: Schüler mit Status „Aufnahme“, Jahrgang 05 und Schuljahresabschnitt (konfigurierbar, sonst der aktuelle), Geschlecht, Geburtsdatum, Religion, Anmeldedatum (Datum des Online-Absendens).
2. `PATCH /schueler/{id}/stammdaten`: Geburtsort; Straße, Hausnummer und Zusatz (aufgeteilt); Wohnort und Ortsteil; Staatsangehörigkeit, Geburtsland, Familiensprache, Zuzugsjahr; Telefon/E-Mail der 1. erziehungsberechtigten Person; **Passfoto** (JPEG, Base64).
3. `POST /schueler/erzieher/new/{id}/{1|2}`: Erziehungsberechtigte mit Erzieherart (Mutter/Vater/Pflegeeltern/Sonstige), Anrede, eigener oder Kinder-Adresse, E-Mail. Telefonnummern stehen als Bemerkung, weil die Erzieher-Stammdaten dafür kein Feld haben.

**Kataloge** werden bei jeder Übertragung live aus SVWS gelesen: Status, Jahrgänge, Religionen, Erzieherarten, Nationalitäten (über ISO-2, nur gültige Einträge), Verkehrssprachen, Orte und Ortsteile. In SharePoint wird dafür nichts abgelegt; die Katalogfrage bleibt wie besprochen offen.

**Zuordnungen** sind aus dem SVWS-Quelltext übernommen:
- Geschlecht: m=3, w=4, d=5, x=6
- Religion: rk→KR, ev→ER, isl→IR, alevit→AR, jued→HR, orth→XO, sonst→XR, keine→OH

Was nicht zuzuordnen ist (z. B. Ort nicht im Katalog, Religion im Katalog der Schule nicht vorhanden), wird als **Warnung** gemeldet; die Übertragung läuft trotzdem.

**Sekretariat:**
- Einstellungen: SVWS-Adresse, Verbindungsweg, **Datenbank-Schema**, optional das Schuljahr der Neuaufnahmen.
- Anmeldungen: freigegebene auswählen → „Ausgewählte an SVWS übertragen …“ → Dialog mit SVWS-Benutzer und Passwort (nur im Speicher) → „Verbindung prüfen“ (Version und Schulname) → übertragen. Danach eine Ergebnisliste pro Kind mit Warnungen.
- Bei vollständiger Übertragung: Status **„In SVWS übernommen“** und Schüler-ID (neue Spalte `SvwsId`, Schema v6), im Editor angezeigt.
- Bei einem Teilerfolg (Schüler angelegt, späterer Schritt fehlgeschlagen) wird die Schüler-ID trotzdem gespeichert. Der Status bleibt, die Meldung bittet um Prüfung in SVWS. Eine zweite Übertragung derselben Anmeldung wird in jedem Fall verhindert.

**Entwicklung:** Der Vite-Server des Sekretariats leitet `/svws-proxy` an den lokalen SVWS-Server weiter. Das ersetzt in der Entwicklung den CORS-Proxy und umgeht das selbstsignierte Zertifikat.

## Tests

- Unit: 11 SVWS-Tests (Mapping inkl. Warnungen, Straßenaufteilung, Basic-Auth, Duplikatschutz), Service-Test für `recordTransfer`
- `make test-svws` (läuft gegen `make svws-up`):
  - `integration-svws`: Verbindungstest; falsche Zugangsdaten legen nichts an. Übertragung mit Foto, danach Stammdaten, Foto und beide Erzieher über die SVWS-API geprüft. Keine Doppelanlage. Testschüler werden gelöscht.
  - `e2e-svws`: Konfiguration im Browser, Verbindungstest über den Proxy, Übertragung per Oberfläche, Status und Schüler-ID in SharePoint, Prüfung in SVWS, Aufräumen
- Regression: alle Unit-, Integrations- und Browser-Tests grün; keine Testdaten in SharePoint und SVWS übrig

Gefunden und behoben: SVWS akzeptiert Wohnort und Ortsteil nur zusammen. Der Adapter sendet `ortsteilID` jetzt immer mit dem Wohnort, notfalls als `null`. Gefunden wurde das im ersten Live-Test, wo der Adapter den Teilerfolg korrekt gemeldet hat.

## Hinweise / offen

1. **Nicht übertragen** werden bisher: Förderschwerpunkte, LRS/Autismus, bisherige Schulen, Notfallkontakte, Einverständnisse, Klassenwunsch und die Wahl des Religionsunterrichts. In SVWS gehören sie zu Lernabschnitten, Vermerken oder anderen Bereichen. Sie bleiben in SharePoint und auf dem Anmeldebogen. Welche davon in SVWS gebraucht werden, wäre mit dem Sekretariat zu klären.
2. **Produktivbetrieb:** Entweder CORS im SVWS-Server erlauben und ein vertrauenswürdiges Zertifikat einsetzen, oder einen CORS-Proxy vor SVWS betreiben (Header `X-SVWS-Target`).
3. **Schuljahr:** Ohne Angabe legt der Adapter im aktuellen Abschnitt der Schule an. Für die Anmeldungen zum Folgejahr sollte das Schuljahr in den Einstellungen gesetzt werden, sobald der Abschnitt in SVWS existiert.
4. Telefonnummern der Erziehungsberechtigten sind als Bemerkung gespeichert. SVWS hat dafür eigene Telefoneinträge; das kann als nächster Schritt folgen.

## Nächster Schritt

Testrunden mit dem Sekretariat; danach UI/UX-Überarbeitung.
