# Sprint 5 – Sekretariat

**Status:** Abgeschlossen. Ein kompletter Anmeldetag mit Testpersonen wird im Browser-Test simuliert (`e2e-day`).

## Ergebnis

| Task | Stand |
|---|---|
| J2 Tagesansicht | ✅ Neue Startansicht: Termine eines Tages über alle Verfahren, parallele Verantwortliche/Räume als Spalten, Termin- und Anmeldestatus, Tag vor/zurück/heute; Datum in der URL (`#tag/2026-10-07`) |
| J3 Application öffnen | ✅ Aus der Tagesansicht in den gemeinsamen Anmeldungs-Editor (Termin, Kontakt, Verfahren, alle Formularfelder) |
| J4 Gespräch angetreten | ✅ Knopf „Erschienen“ (Tagesansicht) bzw. „Gespräch angetreten“ (Editor): Application → `interview`, gebuchter Termin → `done` |
| J5 Autosave | ✅ Speichert 1,5 s nach der letzten Änderung (Daten und Kommentare), Statusanzeige; Warnung beim Verlassen mit offenen Änderungen. Gleichzeitige Änderungen werden per eTag als **Konflikt** erkannt statt überschrieben („Neu laden“). |
| J6 Kommentare | ✅ `secretariatComment` und `interviewerComment` als Textfelder, mitgespeichert |
| K1 Applications Panel | ✅ „Anmeldungen“: alle Anmeldungen unabhängig vom Termin, mit Termin, Kontakt, Verfahren, Status; lädt ohne die großen Formulardaten |
| K2 Namenssuche | ✅ Kind, Kontaktname, E-Mail; unabhängig von Groß-/Kleinschreibung, Akzenten und Reihenfolge. Findet Anmeldungen auch **nach einer Absage**, weil Kontaktname und -mail an der Application gespeichert sind. |
| K3 Application bearbeiten | ✅ Aus der Suche in den Editor |
| K4 Statusfilter | ✅ Umschaltknöpfe je Status mit Anzahl, kombinierbar |
| K5 Prüfung und Freigabe | ✅ Je Status genau ein nächster Schritt: Gespräch angetreten → Prüfung beginnen → Als geprüft markieren → **Für SVWS freigeben** (nur nach Rückfrage „Liegt der unterschriebene Anmeldebogen vor?“). Ungültige Sprünge werden abgelehnt. |
| L1 Terminabsage | ✅ „Absage“ in Tagesansicht und Terminplan: Termin → `available`, Buchungsdaten und Verknüpfung entfernt, Application bleibt |

**Technik:**
- Schema-Version 4: Applications erhalten `ChildName`, `ContactName` und `ContactEmail`. Der Server setzt die Kontaktdaten bei der Buchung und den Kindnamen beim Absenden, der Editor den Kindnamen beim Speichern.
- `ApplicationService` prüft die Statusübergänge und speichert mit eTag.
- Navigation: Tagesansicht · Anmeldungen · Termine · Verfahren · Formulare · Dateien · Einstellungen (vorher „Start“).

## Tests

- Unit: 73 TS (u. a. Service: Übergänge, Konflikt, `interview` → Termin `done`), 13 Rust
- Integration: beide grün
- Browser: 7 Tests grün. Neu `e2e-day`: 3 Buchungen über die echte API → Tagesansicht → Absage (Slot wieder öffentlich, Anmeldung bleibt) → Erschienen → Bearbeiten mit Autosave und Kommentar, Neuladen → Prüfung bis Freigabe → Konflikterkennung → Suche nach Absage → Statusfilter
- Keine Testdaten übrig

Gefunden und verbessert: Statusfilter waren Checkboxen mit verstecktem Eingabefeld und damit schlecht per Tastatur bedienbar. Jetzt sind es Umschaltknöpfe (`aria-pressed`).

## Hinweise / offene Punkte

1. **Kein Zurück im Status:** Der Backlog sieht keine Rückwärtsübergänge vor, z. B. „geprüft“ → „in Prüfung“ nach einem Fehler. Wird das im Testbetrieb gebraucht, wäre das ein neuer Task.
2. **Kindname** wird aus den Formularfeldern `nachname`/`vorname` (oberste Ebene) gebildet. Neue Formulare sollten diese IDs beibehalten.
3. Suche und Liste laden alle Anmeldungen auf einmal. Für einige hundert Anmeldungen pro Jahr ist das unkritisch.

## Nächster Schritt

Sprint 6 – Dokumente und Abschluss (H1 Bestätigungsmail, I1–I5 PDF, M1/M2 SVWS-Grenze, N1/N2 Konfiguration).
Für **H1** wird ein Versandweg gebraucht: Microsoft Graph `Mail.Send` für ein Absender-Postfach (Daemon). Das braucht eine Admin-Freigabe in Entra, idealerweise auf ein Postfach eingeschränkt (Application Access Policy bzw. RBAC for Applications).
