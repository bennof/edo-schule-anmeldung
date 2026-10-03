# Sprint 3 – Termine und erster Testbetrieb

**Status:** Abgeschlossen. Der im Backlog geforderte Durchstich läuft:
SharePoint → Termine anlegen → veröffentlichen → Public SPA → Termin buchen → SharePoint.

## Ergebnis

| Task | Stand |
|---|---|
| E1 Appointment Domain Service | ✅ `AppointmentService`: alle Statuswechsel geprüft, Änderungen mit eTag (keine stillen Überschreibungen), Absage `booked → available` mit Löschen der Buchungsdaten bereits vorhanden |
| E2 Terminplan-Generator | ✅ Datum, Anfang, Ende, Intervall, Pausen; deterministisch; nach einer Pause geht es direkt am Pausenende weiter |
| E3 Terminplan bearbeiten | ✅ Entwürfe anzeigen, Uhrzeit/Verantwortliche ändern, einzeln oder tageweise löschen; doppelte Slots werden beim erneuten Erzeugen übersprungen |
| E4 Veröffentlichen | ✅ alle oder tageweise `draft → available`; API liefert nur buchbare Slots aktiver Verfahren |
| E5 Parallelität | ✅ Verantwortliche/Räume kommagetrennt, je Zeitpunkt ein Slot pro Verantwortlichem, getrennt buchbar |
| F1 Public SharePoint Client | ✅ Rust, Daemon-Identität (Client Credentials), Token-Cache, Throttling-Retry |
| F2 Public Configuration API | ✅ nur Config-Einträge mit `isPublic` und aktive Verfahren |
| F3 Available-Appointments API | ✅ nur künftige `available` Slots, nur ID und Uhrzeit |
| F4 Appointment Booking | ✅ Eingabeprüfung, erneute Prüfung direkt vor der Buchung, eTag gegen Doppelbuchung |
| G1 Bootstrap/Branding | ✅ Schulname (`schoolName`, öffentlich), Logo, Verfahrensauswahl |
| G2 Terminauswahl | ✅ Tage, dann freie Uhrzeiten; parallele Slots erscheinen einmal |
| G3 Terminbuchung | ✅ Name, E-Mail, Einwilligung → Buchung → weiter zum Formular |
| B4 Asset-System (vorgezogen) | ✅ Sekretariat „Dateien“: hochladen, ersetzen, löschen, Bildvorschau |

## Tests

- Unit: 59 TS (u. a. Generator, Service-Übergänge, Batch), 8 Rust
- Integration (`pnpm test:integration`):
  - Adapter inkl. Batch mit 45 Terminen
  - Public API gegen echte Site mit Daemon-Identität. **5 gleichzeitige Buchungen desselben Slots → genau 1 Erfolg, 4× 409.** Keine Personendaten im Server-Log.
- Browser (`pnpm test:e2e`), neu `e2e-booking`: kompletter Durchstich, dazu zwei Familien, die gleichzeitig denselben letzten Slot wollen. Die zweite bekommt einen Hinweis und eine aktualisierte Auswahl.
- Alle Tests räumen ihre Daten auf (geprüft).

Gefunden und behoben:
- „Buchung freigeben“ hätte einen *Entwurf* veröffentlicht. Die Freigabe verlangt jetzt `booked`.
- Datei-Upload meldete trotz Erfolg einen Fehler.
- Logo ohne Dateiendung wurde als `octet-stream` ausgeliefert. Der Server erkennt Bildformate jetzt am Inhalt.

## Testbetrieb manuell

```sh
pnpm dev:server          # Rust-Server :8080
pnpm dev:secretariat     # http://localhost:5173 – Verfahren, Termine, Dateien
pnpm dev:public          # http://localhost:5174 – öffentliche Buchung
```
Ein Verfahren ist öffentlich, solange das heutige Datum zwischen Beginn und Ende liegt.

## Entscheidungen (bitte prüfen)

- **Aktives Verfahren** = heute liegt im Zeitraum. Sind mehrere aktiv, wählt die Familie.
- **Einwilligungstext** bei der Buchung ist ein Platzhalter. Der verbindliche Datenschutztext muss von der Schule kommen.
- **Öffentliche Assets:** nur `logo` und Optionslisten aktiver Formulare. Alles andere liefert 404.
- **Zeitzone:** „vergangen“ wird mit der lokalen Zeit des Servers bestimmt. Er muss in der Zeitzone der Schule laufen (z. B. `TZ=Europe/Berlin`). `requestTime` wird in UTC gespeichert.

## Offene Punkte / Risiken

1. **Daemon-Berechtigung zu weit:** `Sites.Selected` mit Schreibrecht gilt für die ganze Site. Technisch könnte der Daemon also auch Applications lesen; der Code tut es nicht. Für Produktion auf Listenebene einschränken (z. B. `Lists.SelectedOperations.Selected`). Das ist eine Aufgabe für die Administration.
2. **Missbrauchsschutz fehlt:** Jeder kann mit erfundenen Adressen alle Termine buchen. Vor dem öffentlichen Betrieb sollten mindestens eine Rate-Begrenzung pro IP und ggf. eine E-Mail-Bestätigung dazukommen. Das steht nicht im Backlog; Vorschlag: neuer Task.
3. Nach dem Neuladen der Seite ist die Buchungsbestätigung weg (die Buchung bleibt erhalten). Wird mit F5 (Application) in Sprint 4 und H1 (Bestätigungsmail) entschärft.
4. Das Formular nach der Buchung ist sichtbar, aber noch nicht absendbar (G4/G5 in Sprint 4).

## Nächster Schritt

Sprint 4 – Vollständige Anmeldung (F5, F6, G4, G5, C5). Für C5 brauche ich das **bisherige Anmeldeformular** der Schule (PDF/Word/Foto).

## Nachtrag: IP-Filter, Einwilligungstext, Daemon-Berechtigungen

**IP-Filter (umgesetzt):**
- Neue Spalte `RequestIp` in Appointments (Schema-Version 2; die Provisionierung ergänzt sie in bestehenden Listen).
- Der Server zählt gebuchte Termine je Verfahren und IP-Adresse. Ab dem Wert von `maxBookingsPerIp` (Config, nicht öffentlich, Vorgabe 3, `0` = aus) antwortet er mit 429 und dem Hinweis, sich ans Sekretariat zu wenden.
- Hinter einem Reverse-Proxy `TRUST_PROXY=1` setzen; dann gilt die erste Adresse aus `X-Forwarded-For`, sonst die Verbindungsadresse.
- Bei einer Absage wird die IP zusammen mit den übrigen Buchungsdaten gelöscht. Das Sekretariat sieht die IP in der Terminliste.
- Grenzen: Gleichzeitige Anfragen derselben IP können das Limit knapp überschreiten. Familien hinter einem gemeinsamen Anschluss (z. B. Schulnetz) teilen sich das Limit.
- Getestet live: 3. Buchung derselben IP bei Limit 2 → 429, Limit 0 → Filter aus.

**Einwilligungstext (umgesetzt):** Config-Eintrag `consentText` (öffentlich). Die Provisionierung legt einen Platzhalter an, wenn er fehlt, und überschreibt nie einen vorhandenen Text. Die Public SPA zeigt den Eintrag an. Ist er leer, erscheint ein kurzer Standardsatz.

**Daemon-Berechtigungen auf Listenebene (umgesetzt):**
- Gesetzt (`node scripts/daemon-permissions.ts grant`): Config, Assets, Forms, Procedures = `read`; Appointments, Applications = `write`.
- Der Rust-Server spricht Listen jetzt direkt über ihren Namen an und braucht keinen Lesezugriff mehr auf die ganze Site.
- `Lists.SelectedOperations.Selected` wurde in Entra gesetzt und die Site-weite Schreibberechtigung entfernt (`revoke-site`). Der Server läuft nur mit Listenrechten, alle Integrationstests sind grün.
- Test belegt: Der Daemon sieht zwar, welche Listen es gibt, aber keinen Inhalt nicht freigegebener Listen (Datei in „Dokumente“ → 404) und darf dort nicht schreiben.
- Optional: `Sites.Selected` beim Daemon in Entra entfernen; es wird nicht mehr gebraucht. Rückweg bei Problemen: `restore-site`.
- Einschränkung: Graph kennt nur `read`/`write`/`owner`. `write` auf Applications schließt Lesen ein. Damit der Daemon nur selbst angelegte Anmeldungen lesen kann, in SharePoint unter Applications → Listeneinstellungen → Erweiterte Einstellungen → *Berechtigungen auf Elementebene* „Nur eigene Elemente lesen“ setzen. Das geht per App-Secret nicht automatisiert (SharePoint-REST verlangt dafür ein Zertifikat).
