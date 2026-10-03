# Sprint 4 – Vollständige Anmeldung

**Status:** Abgeschlossen. Der End-to-End-Ablauf aus dem Backlog läuft:
Termin buchen → Formular ausfüllen → absenden → Application in SharePoint.

## Ergebnis

| Task | Stand |
|---|---|
| F5 Application erstellen | ✅ Der Server legt bei der Buchung die Application an (`created`, Formular des Verfahrens) und verknüpft sie mit dem Termin. Die Familie erhält einen zufälligen Zugangsschlüssel; in SharePoint steht nur dessen SHA-256-Hash (Spalte `AccessTokenHash`). |
| F6 Application Submission | ✅ Mit dem Schlüssel: Formular laden, starten (`created → form_in_progress`), einmalig absenden (`→ submitted`, `SubmittedAt`). Der Server prüft die Struktur gegen die Formulardefinition (nur bekannte Felder, passende Typen, Repeat-Grenzen) und speichert nichts lokal. Falscher oder fehlender Schlüssel → 404. |
| G4 Anmeldeformular | ✅ Nach der Buchung: Formular mit Katalogen (Länder, Sprachen, Staatsangehörigkeiten). Entwurf wird lokal auf dem Gerät gespeichert; nach Neuladen oder späterem Besuch „Willkommen zurück → fortsetzen“. |
| G5 Formular absenden | ✅ Vollständige Prüfung im Browser, Sprung zum ersten Fehler, ausgeblendete Werte werden entfernt. Danach Bestätigung, lokale Daten gelöscht. |
| C5 Anmeldeformular migrieren | ✅ `packages/forms/examples/anmeldung-klasse5.json`, im Sekretariat per Knopf „Schulformular anlegen“ (lädt Kataloge mit hoch) |

**C5 im Detail:**
- Wiederverwendbare Gruppen: Adresse, Schule, Schulbesuch (wiederholbar), Erziehungsberechtigte (2×, mit Übernahme), Notfallkontakt (wiederholbar).
- Alle Einverständnisse und Kenntnisnahmen sind enthalten. Kenntnisnahmen sind Pflicht-Häkchen (neue Formatoption `mustAccept`).
- Nachweis: `anmeldung-klasse5.mergefields.json` ordnet alle **59 Seriendruckfelder** der Word-Vorlage einem Formularfeld zu. Ein Test liest die .docx und prüft Vollständigkeit und Gültigkeit. Die Zuordnung dient auch als Grundlage für I3 (PDF-Mapping).
- Kataloge werden aus den ICU-Daten von Node erzeugt (`pnpm --filter @anmeldung/forms catalogs`), Schlüssel sind ISO-Codes. Die Zuordnung zu SVWS-Schlüsseln folgt mit den Katalogen (Future Release).

## Tests

- Unit: 67 TS, 12 Rust (u. a. Strukturprüfung der Formulardaten, Token)
- Integration Public API (live, nur Listenrechte):
  - Application entsteht bei der Buchung, nur der Hash wird gespeichert.
  - Falscher Schlüssel → 404, ungültige Daten → 400.
  - Zweites Absenden → 409.
  - Kein Token und keine Personendaten im Server-Log.
- Browser: neuer Test `e2e-registration`.
  - Ablauf: Schulformular importieren → buchen → komplettes Schulformular ausfüllen (Kataloge, Übernahme, Wiederholgruppen, Einverständnisse) → neu laden und fortsetzen → fehlende Kenntnisnahme blockiert → absenden.
  - Prüfung danach: Daten bereinigt in SharePoint, Anzeige im Sekretariat mit Katalognamen.
- Alle 6 Browser-Tests und beide Integrationstests grün, keine Testdaten übrig.

Gefunden und behoben: Ohne hochgeladenes Logo erzeugte jeder Seitenaufruf einen 404 in der Konsole. `/api/config` meldet jetzt `hasLogo`.

## Bitte prüfen / entscheiden

1. **Texte im Schulformular:** Die Vorlage enthielt für die Einverständnisse nur Seriendruckfelder, nicht die Wortlaute. Formulierungen, Belehrungs-Zusammenfassungen und die Platzhalter (Klassenfahrt ca. 180 €) bitte von der Schule prüfen lassen. Auswahllisten (Religion, Religionsunterricht, Rollen, Förderschwerpunkte mit NRW-Kürzeln) ebenso.
2. ~~Unterschrift vor SVWS-Übernahme als Feld~~: entschieden, entfällt. Der unterschriebene Antrag auf Papier ist der Auslöser für die Übernahme; die Freigabe bleibt ein bewusster Schritt des Sekretariats.
3. **Applications-Leserecht des Daemons:** Jetzt relevant, da der Server Anmeldungen anlegt. Empfehlung: In SharePoint unter Applications → Listeneinstellungen → Erweiterte Einstellungen die *Berechtigungen auf Elementebene* auf „Nur eigene Elemente lesen“ setzen. Das geht nur manuell. Der Server liest ohnehin nur Anmeldungen mit passendem Schlüssel.
4. ~~Entwurf im Browser~~: umgesetzt als Häkchen „Eingaben auf diesem Gerät speichern, bis die Anmeldung abgeschickt ist“ (Buchungsbestätigung und oben im Formular). Standard ohne Häkchen: Daten nur im aktuellen Browser-Tab (überleben Neuladen, weg beim Schließen). Mit Häkchen: auf dem Gerät bis zum Absenden. Entfernen des Häkchens löscht sie sofort vom Gerät. Getestet im Browser-Test.

## Nächster Schritt

Sprint 5 – Sekretariat (J2–J6, K1–K5, L1).
