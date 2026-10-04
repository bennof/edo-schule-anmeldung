# Sprint 7 – Form-Designer, Versionen, Uploads

**Status:** Abgeschlossen. Zusatz-Sprint nach dem MVP (D2 und D3 waren im Backlog keinem Sprint zugeordnet; Uploads aus den Future Releases).

## Ergebnis

| Task | Stand |
|---|---|
| D2 Form-Designer | ✅ Formulare → „Neues Formular“ / „Bearbeiten → Version N“. Strukturbaum (Abschnitte, Felder, Gruppen, Gruppen-Definitionen), Reihenfolge ↑↓, Eigenschaften je Feldtyp (Pflicht, Kenntnisnahme, Grenzen, Muster, Optionen oder Katalog, Mehrfachauswahl, Upload-Einstellungen), Gruppen wiederholbar oder mit Übernahme. Bedingungen „Sichtbar, wenn“ / „Pflicht, wenn“ im Formular oder als JSON für kombinierte Bedingungen. Live-Vorschau und laufende Prüfung (Schema und Semantik); speichern erst ohne Probleme. |
| D3 Formularversionierung | ✅ Gespeicherte Versionen werden nie verändert. Jede Änderung ist eine neue Version mit gemeinsamem `FormKey` und `FormVersion` (Schema v5). Anmeldungen behalten ihre `formId`; das Verfahren bestimmt die Version für neue Buchungen. Die Formularansicht zeigt Versionen, ihre Verwendung durch Verfahren und erlaubt JSON-Export; die Verfahrensliste weist auf neuere Versionen hin. Ein Import mit vorhandenem Titel wird zur nächsten Version. |
| Uploads | ✅ Neuer Feldtyp `file` (`accept`, `multiple`, `maxFiles`, `role: "photo"`). Dateien liegen in der Bibliothek **Uploads** (ein Ordner pro Anmeldung), das Formular enthält nur die **Referenz** `{id, name, contentType, size}`. |

**Uploads im Detail:**
- **Familie:** Upload über den Server mit dem Familienschlüssel.
  - Erlaubt sind PDF, JPEG und PNG. Die Signatur der Datei muss zum angegebenen Typ passen.
  - Höchstens 4 MB pro Datei und 25 Dateien pro Anmeldung.
  - Entfernen ist bis zum Absenden möglich. Beim Absenden müssen alle Referenzen zur eigenen Anmeldung gehören.
- **Passfoto (`role: "photo"`):**
  - Wird im Browser auf höchstens 600 × 800 als JPEG verkleinert. Ein Kamerafoto mit 1600 × 2000 hatte danach unter 200 kB.
  - Wird im Sekretariat im Kopf der Anmeldung angezeigt und auf den Anmeldebogen gedruckt (Fotofeld oben rechts).
  - `fileRefs(form, data, 'photo')` liefert es eindeutig, z. B. für den SVWS-Adapter.
- **Sekretariat:** Hochladen, Ansehen und Entfernen direkt über Graph. Die Referenzen werden automatisch mitgespeichert.
- **Schulformular:** neuer Abschnitt „9. Unterlagen (optional)“ mit Passfoto, Halbjahreszeugnis Klasse 4 und weiteren Unterlagen (bis 5).
- **Daemon:** Schreibrecht nur auf die Liste Uploads (`daemon-permissions grant`).

## Tests

- Unit: 101 TS (u. a. Designer-Operationen, Versionen, Datei-Validierung), 23 Rust (Upload-Signaturen, Namen, Referenzprüfung)
- Integration Public API um Uploads erweitert:
  - Speichern, Referenz und Abruf
  - falscher Typ, gefälschte Signatur, Übergröße, falscher Schlüssel
  - eigene Datei löschen
  - fremde Referenz beim Absenden abgelehnt
  - nach dem Absenden keine Uploads und keine Löschungen mehr
- Browser: neuer Test `e2e-designer-uploads`:
  - Formular im Designer bauen, Bedingung in der Vorschau, Fehler blockiert das Speichern
  - Version 1 und Version 2; Version 1 bleibt unverändert
  - Buchung mit Foto- und PDF-Upload; das Foto wird verkleinert
  - nach Umstellung des Verfahrens bekommen neue Buchungen Version 2, die alte Anmeldung öffnet weiter mit Version 1
  - Foto im Sekretariat, Dokument hochladen und entfernen
- Alle 9 Browser-Tests und beide Integrationstests grün; keine Testdaten übrig (auch keine leeren Upload-Ordner mehr)

Gefunden und behoben:
- Svelte-Warnung `ownership_invalid_mutation` im Designer. Die Editoren verändern das Formular jetzt über gebundene Props.
- Leere Upload-Ordner nach dem Aufräumen. Neu ist `deleteUploads(applicationId)`.

## Hinweise

1. Bedingungen mit `all`/`any`/`not` werden im Designer als JSON bearbeitet; einfache Bedingungen im Formular.
2. Beim Ändern des Feldtyps fallen unpassende Eigenschaften weg (z. B. Optionen bei einem Textfeld).
3. Eine Absage löscht die Anmeldung nicht. Ihre Uploads bleiben deshalb bis zur Löschung der Anmeldung erhalten.
4. Vor einem Formularwechsel bei einem laufenden Verfahren: Neue Buchungen erhalten die neue Version, bestehende behalten ihre.

## Nächster Schritt

Sprint 8 – SVWS-Adapter gegen den Testserver (`make svws-init`): Schüler anlegen, Foto übertragen, Status `imported`.
