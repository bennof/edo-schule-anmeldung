# Backlog -- Anmeldesystem MVP

## 1. Festgelegte Architektur

Diese Entscheidungen sind für die MVP-Implementierung festgelegt und
sollen in den einzelnen Tasks nicht erneut bewertet werden.

### Komponenten

``` text
Public SPA (Svelte/TypeScript)
        ↓
Rust Public Server
        ↓
SharePoint

Secretariat SPA (Svelte/TypeScript)
        ↓
SharePoint

später:

Secretariat SPA
        ↓
SVWS Adapter
        ↓
Transport
        ↓
SVWS
```

SharePoint ist die zentrale persistente Datenhaltung. Der öffentliche
Rust-Server speichert keine personenbezogenen Daten dauerhaft.

### SharePoint-Basis

Es gibt sechs grundlegende Bereiche:

-   `Config`
-   `Assets`
-   `Appointments`
-   `Applications`
-   `Forms`
-   `Procedures`

#### Config

Enthält alle notwendigen globalen und installationsbezogenen Parameter.

#### Assets

Key-basierte Ablage binärer Ressourcen:

``` text
key → blob
```

Insbesondere für Logos, Bilder und PDF-Vorlagen.

#### Appointments

``` text
id
procedure_id
application_id
verantwortlicher_id
datetime
state
email_customer
name_customer
request_time
```

`request_time` ist der Zeitpunkt der Buchungsanfrage.

Terminstatus:

``` text
draft → available → booked → done
```

Für eine Absage im MVP ist zusätzlich zulässig:

``` text
booked → available
```

Weitere Terminstatus gibt es nicht.

#### Applications

``` text
id
procedure_id
form_id
data: JSON
state
```

Application-Status:

``` text
created
→ form_in_progress
→ submitted
→ interview
→ in_review
→ checked
→ ready_for_svws
→ imported
```

`interview` bedeutet, dass die Familie tatsächlich zur Anmeldung
erschienen ist und das Anmeldegespräch angetreten wurde.

`form_in_progress` entfällt bei Abläufen, bei denen kein digitales
Formular begonnen wurde.

#### Forms

``` text
id
form_json
date_last_update
```

Formulare werden versioniert. Eine Application hält die konkret
verwendete `form_id`.

#### Procedures

``` text
id
form_id
info: JSON
start_date
end_date
```

### Terminabsage

Absagen erfolgen im MVP telefonisch über das Sekretariat.

Bei einer Absage:

``` text
Appointment: booked → available
```

Die Buchungsdaten und die Verknüpfung zur Application werden aus dem
Appointment entfernt.

**Die Application wird nicht gelöscht.**

Sie bleibt über die Anmeldungsverwaltung auffindbar und bearbeitbar.

Terminverschiebungen sind kein Bestandteil des MVP.

------------------------------------------------------------------------

# 2. Epic A -- Projektgrundlage

## A1 -- Repository und Workspace aufsetzen

**Ziel:** Gemeinsame Projektstruktur für Public SPA, Secretariat SPA,
gemeinsame TypeScript-Komponenten und Rust-Server.

**Output:** Buildbare leere Anwendungen mit gemeinsamem Domain-Paket.

**Technische Vorgaben:**

-   Svelte + TypeScript für die SPAs
-   Rust für den Public Server
-   gemeinsame Geschäftsmodelle nicht zwischen den SPAs duplizieren

**Definition of Done:**

Clean Checkout → Dependencies installieren → beide SPAs und Rust-Server
bauen und starten erfolgreich.

**Dependencies:** keine

------------------------------------------------------------------------

## A2 -- Gemeinsames Domain-Modell

**Ziel:** Zentrale TypeScript-Typen für die fachlichen Objekte
definieren.

**Output:**

Typen für:

-   `Config`
-   `Asset`
-   `Appointment`
-   `Application`
-   `FormDefinition`
-   `Procedure`
-   States

Beispiel:

``` ts
interface Appointment {
    id: string;
    procedureId: string;
    applicationId?: string;
    verantwortlicherId?: string;
    datetime: string;
    state: AppointmentState;
    emailCustomer?: string;
    nameCustomer?: string;
    requestTime?: string;
}
```

``` ts
interface Application {
    id: string;
    procedureId: string;
    formId: string;
    data: unknown;
    state: ApplicationState;
}
```

``` ts
interface Procedure {
    id: string;
    formId: string;
    info: unknown;
    startDate: string;
    endDate: string;
}
```

**Constraints:** Keine SVWS-spezifischen Felder in den allgemeinen
Domain-Modellen.

**Definition of Done:** Beide SPAs verwenden dieselben Modelle und
State-Definitionen.

**Dependencies:** A1

------------------------------------------------------------------------

# 3. Epic B -- SharePoint-Plattform

## B1 -- SharePoint-Adapter

**Ziel:** Generischer Zugriff auf die benötigten SharePoint-Listen und
Assets.

**Output:** CRUD-Abstraktion für die Anwendung.

**Constraints:** SharePoint-spezifische Details gelangen nicht in
UI-Komponenten.

**Definition of Done:** Lesen, Erstellen, Aktualisieren und Löschen
funktionieren über die Abstraktion.

**Dependencies:** A2

------------------------------------------------------------------------

## B2 -- Schema-Provisionierung

**Ziel:** Die Secretariat SPA kann eine geeignete leere SharePoint-Site
für das System initialisieren.

**Output:** Automatische Anlage von:

-   `Config`
-   `Assets`
-   `Appointments`
-   `Applications`
-   `Forms`
-   `Procedures`

einschließlich benötigter Spalten und Indizes.

**Constraints:**

-   Schema-Version in `Config`
-   wiederholter Aufruf darf bestehende Daten nicht zerstören
-   Provisionierung muss idempotent sein

**Definition of Done:** Eine leere Site kann initialisiert werden;
erneute Provisionierung verändert bestehende gültige Daten nicht
destruktiv.

**Dependencies:** B1

------------------------------------------------------------------------

## B3 -- Config-System

**Ziel:** Alle installationsbezogenen Parameter zentral verwalten.

**Output:** Key/Value-basierte Konfiguration einschließlich
Schema-Version.

**Constraints:** Keine Secrets in Browser-Konfiguration.

**Definition of Done:** Config kann gelesen, geändert und von den
Anwendungen verwendet werden.

**Dependencies:** B2

------------------------------------------------------------------------

## B4 -- Asset-System

**Ziel:** Binäre Ressourcen über logische Schlüssel verwalten.

``` text
key → blob
```

MVP insbesondere:

-   Logo
-   Bilder
-   PDF-Vorlagen

**Definition of Done:** Asset hochladen, über Key laden, ersetzen und
löschen.

**Dependencies:** B2

------------------------------------------------------------------------

# 4. Epic C -- Form Engine

## C1 -- Form-JSON-Schema spezifizieren

**Ziel:** Versioniertes maschinenlesbares Formularformat festlegen.

### MVP-Feldtypen

-   Text
-   E-Mail
-   Telefon
-   Datum
-   Jahr
-   Integer
-   Boolean
-   Single-Select
-   Multi-Select
-   Searchable Select

### Struktur

Unterstützt werden:

-   Sections
-   wiederverwendbare Groups
-   Group-Instanzen
-   repeatable Groups
-   `minItems`
-   `maxItems`
-   Bedingungen
-   conditional required
-   einmaliges Kopieren zwischen Gruppen
-   generische Validierung

Select-Werte verwenden Key/Value:

``` json
{
  "key": "interner-wert",
  "value": "Angezeigter Text"
}
```

Datumswerte werden ohne Zeitzone gespeichert.

Volles Datum:

``` text
YYYY-MM-DD
```

Jahreswerte sind vierstellig.

**Constraints:**

Das Form JSON enthält keine HTML- oder PDF-Koordinaten. Datenmodell und
Darstellung bleiben getrennt.

**Definition of Done:** JSON-Schema mit gültigen und ungültigen
Testdefinitionen.

**Dependencies:** A2

------------------------------------------------------------------------

## C2 -- Form Runtime

**Ziel:** Form JSON in eine ausführbare Formularstruktur überführen.

**Output:** Framework-unabhängige Logik für:

-   Initialisierung
-   Werte
-   Bedingungen
-   Validierung
-   Groups
-   Repeat-Groups
-   Copy-Funktion

**Definition of Done:** Unit Tests decken insbesondere Bedingungen,
`required-if-visible`, Repeat-Groups und Copy ab.

**Dependencies:** C1

------------------------------------------------------------------------

## C3 -- Svelte Form Renderer

**Ziel:** `FormDefinition` als interaktives Webformular darstellen.

**Output:** Wiederverwendbarer Renderer für Public SPA und Secretariat
SPA.

**Constraints:** Renderer kennt keinen SharePoint-Zugriff.

**Definition of Done:** Alle MVP-Feldtypen und Gruppen werden korrekt
dargestellt und validiert.

**Dependencies:** C2

------------------------------------------------------------------------

## C4 -- Secretariat-Modus des Renderers

**Ziel:** Dasselbe Formular intern vollständig bearbeiten können.

**Besonderheit:** Alle Felder werden angezeigt, auch wenn sie im
öffentlichen Formular aufgrund einer Verzweigung nicht sichtbar gewesen
wären. Nicht beantwortete Felder bleiben leer.

**Definition of Done:** Bestehende Application kann vollständig geladen
und bearbeitet werden.

**Dependencies:** C3

------------------------------------------------------------------------

## C5 -- Bestehendes Anmeldeformular migrieren

**Ziel:** Das aktuelle Schul-Anmeldeformular vollständig als Form JSON
abbilden.

**Constraints:**

-   Sorgeberechtigte als wiederverwendbare Gruppe
-   Schullaufbahn sinnvoll als wiederholbare Struktur
-   keine unnötige Duplikation von Feldern

**Definition of Done:** Alle für das neue Verfahren benötigten Felder
des bisherigen Formulars sind repräsentiert.

**Dependencies:** C1--C3

------------------------------------------------------------------------

# 5. Epic D -- Procedures und Formularverwaltung

## D1 -- Procedure-Verwaltung

**Ziel:** Anmeldeverfahren erstellen und bearbeiten.

Modell:

``` text
id
form_id
info: JSON
start_date
end_date
```

**Definition of Done:** Verfahren können erstellt, angezeigt und
bearbeitet werden.

**Dependencies:** B2

------------------------------------------------------------------------

## D2 -- Form Designer MVP

**Ziel:** Formularstrukturen intern erstellen und bearbeiten.

**Output:** Editor für:

-   Sections
-   Fields
-   Groups
-   Reihenfolge
-   Optionen
-   Validierung
-   Bedingungen

**Constraints:** Kein visueller PDF-Designer.

**Definition of Done:** Form kann erstellt, gespeichert und anschließend
vom Public Renderer ausgeführt werden.

**Dependencies:** C1--C3, B2

------------------------------------------------------------------------

## D3 -- Formularversionierung

**Ziel:** Änderungen an Formularen dürfen bestehende Applications nicht
semantisch verändern.

**Output:** Neue Version statt destruktiver Änderung.

`Application.formId` referenziert die konkret verwendete Definition.

**Definition of Done:** Eine alte Application kann nach Veröffentlichung
einer neuen Form-Version weiterhin mit ihrer ursprünglichen Definition
geöffnet werden.

**Dependencies:** D2

------------------------------------------------------------------------

# 6. Epic E -- Terminverwaltung

## E1 -- Appointment Domain Service

**Ziel:** Geschäftslogik für Termine zentral implementieren.

Erlaubte Zustände:

``` text
draft → available → booked → done
```

Absage:

``` text
booked → available
```

**Constraints:** Keine weiteren Terminstatus.

**Definition of Done:** Ungültige State-Transitions werden verhindert.

**Dependencies:** A2, B1

------------------------------------------------------------------------

## E2 -- Terminplan-Generator

**Ziel:** Sekretariat kann Termine für ein Verfahren generieren.

Parameter insbesondere:

-   Datum
-   Anfang
-   Ende
-   Intervall, z. B. 5, 10 oder 20 Minuten
-   Pausen

**Output:** `draft` Appointments.

**Definition of Done:** Ein definierter Zeitraum erzeugt deterministisch
die erwarteten Slots.

**Dependencies:** E1

------------------------------------------------------------------------

## E3 -- Terminplan bearbeiten

**Ziel:** Draft-Termine anzeigen, ändern und entfernen.

**Definition of Done:** Plan kann vor Veröffentlichung vollständig
bearbeitet werden.

**Dependencies:** E2

------------------------------------------------------------------------

## E4 -- Termine veröffentlichen

**Ziel:** Freigabe für öffentliche Buchung.

Transition:

``` text
draft → available
```

**Definition of Done:** Public API liefert ausschließlich buchbare
`available` Slots des aktiven Verfahrens.

**Dependencies:** E3

------------------------------------------------------------------------

## E5 -- Parallelität und Verantwortliche

**Ziel:** Mehrere parallele Gesprächsmöglichkeiten unterstützen.

**Output:** Zuordnung über `verantwortlicher_id`.

**Definition of Done:** Identische Zeitpunkte können für
unterschiedliche Verantwortliche existieren und separat gebucht werden.

**Dependencies:** E2

------------------------------------------------------------------------

# 7. Epic F -- Public Server

## F1 -- Public SharePoint Client

**Ziel:** Rust-Server authentifiziert sich app-only gegenüber Microsoft
365 / SharePoint.

### Berechtigungen

Der Public Server darf:

-   öffentliche Config lesen
-   Formulare lesen
-   benötigte Assets lesen
-   verfügbare Termine lesen
-   Termine buchen
-   neue Applications anlegen bzw. für den laufenden Vorgang schreiben

Er erhält keine allgemeine Leseberechtigung auf bestehende Applications.

**Definition of Done:** Zugriff funktioniert mit den minimal notwendigen
Berechtigungen.

**Dependencies:** B2

------------------------------------------------------------------------

## F2 -- Public Configuration API

**Ziel:** Public SPA erhält ausschließlich benötigte öffentliche
Konfiguration, Branding und Procedure-Informationen.

**Definition of Done:** Keine internen Konfigurationswerte werden
veröffentlicht.

**Dependencies:** F1

------------------------------------------------------------------------

## F3 -- Available-Appointments API

**Ziel:** Öffentliche Liste buchbarer Termine.

**Output:** Nur `available` Slots und die für die Buchung benötigten
Daten.

**Constraints:** Keine Informationen über bereits gebuchte Personen.

**Definition of Done:** Gebuchte Termine sind öffentlich nicht sichtbar.

**Dependencies:** F1, E4

------------------------------------------------------------------------

## F4 -- Appointment Booking

**Ziel:** Termin verbindlich buchen.

**Input:**

-   Slot-ID
-   Name
-   E-Mail

Operation:

``` text
available → booked
```

Dabei werden gesetzt:

-   `name_customer`
-   `email_customer`
-   `request_time`

**Constraints:**

-   Verfügbarkeit unmittelbar vor Buchung erneut prüfen
-   Doppelbuchung verhindern

**Definition of Done:** Zwei konkurrierende Buchungsversuche können
denselben Slot nicht erfolgreich buchen.

**Dependencies:** F3

------------------------------------------------------------------------

## F5 -- Application erstellen

**Ziel:** Nach Terminbuchung Application für das Verfahren anlegen und
Appointment damit verbinden.

**Definition of Done:** `Appointment.application_id` und Application
sind eindeutig miteinander verbunden.

**Dependencies:** F4

------------------------------------------------------------------------

## F6 -- Application Submission

**Ziel:** Ausgefülltes Formular validieren und nach SharePoint
übertragen.

Normaler digitaler Ablauf:

``` text
created → form_in_progress → submitted
```

**Constraints:** Server hält die Daten nicht persistent lokal.

**Definition of Done:** Erfolgreiche Submission ist anschließend
vollständig in SharePoint vorhanden.

**Dependencies:** F5, C2

------------------------------------------------------------------------

# 8. Epic G -- Public SPA

## G1 -- Public Bootstrap und Branding

**Ziel:** SPA lädt öffentliche Config, Procedure, Logo und
FormDefinition.

**Dependencies:** F2

------------------------------------------------------------------------

## G2 -- Terminauswahl

**Ziel:** Verfügbare Termine übersichtlich anzeigen und auswählen.

**Dependencies:** F3

------------------------------------------------------------------------

## G3 -- Terminbuchung

**Ziel:** Name und E-Mail erfassen und Termin buchen.

**Definition of Done:** Nach erfolgreicher Buchung gelangt der Benutzer
zum Formular.

**Dependencies:** G2, F4

------------------------------------------------------------------------

## G4 -- Anmeldeformular

**Ziel:** Nach Buchung die `FormDefinition` ausfüllen.

Verbindlicher Ablauf:

``` text
Terminbuchung → Formular → Submission
```

**Dependencies:** G3, C3, F5

------------------------------------------------------------------------

## G5 -- Formular absenden

**Ziel:** Formular validieren und Application übertragen.

**Definition of Done:** Erfolgreiche Submission führt zu `submitted`.

**Dependencies:** G4, F6

------------------------------------------------------------------------

# 9. Epic H -- E-Mail

## H1 -- Terminbestätigung

**Ziel:** Nach erfolgreicher Buchung Bestätigung an `email_customer`
senden.

Inhalt mindestens:

-   Verfahren
-   Datum
-   Uhrzeit

**Offen innerhalb des Tasks:** Konkreter Microsoft-365-Versandweg und
Absender.

**Definition of Done:** Eine Testbuchung erzeugt genau eine korrekte
Bestätigung.

**Dependencies:** F4

------------------------------------------------------------------------

# 10. Epic I -- PDF MVP

## I1 -- pdf-lib Integration

**Ziel:** PDFs mit AcroForm-Feldern im Browser laden und befüllen.

**Definition of Done:** Test-PDF wird geladen, Felder werden anhand von
Application-Daten gesetzt und ein gültiges PDF erzeugt.

**Dependencies:** A1

------------------------------------------------------------------------

## I2 -- Festes Anmelde-PDF gestalten

**Ziel:** Erste produktive PDF-Vorlage.

**Anforderungen:**

-   AcroForm-Felder
-   hohe Informationsdichte
-   digital vorausfüllbar
-   leer ausgedruckt handschriftlich sinnvoll ausfüllbar
-   druckbar

**Offen innerhalb des Tasks:** Werkzeug zur Erstellung der
Ausgangsvorlage.

**Dependencies:** C5

------------------------------------------------------------------------

## I3 -- Application → PDF Mapping

**Ziel:** Canonical Application-Daten auf AcroForm-Felder abbilden.

**Constraints:** PDF ist Darstellung, nicht Datenquelle.

**Definition of Done:** Vollständige Application erzeugt korrekt
vorausgefülltes Dokument.

**Dependencies:** I1, I2

------------------------------------------------------------------------

## I4 -- Public PDF Download

**Ziel:** Nach Submission PDF clientseitig erzeugen und zum Download
bzw. Druck anbieten.

**Constraints:** Kein Server-Roundtrip für die eigentliche
PDF-Erzeugung.

**Dependencies:** G5, I3

------------------------------------------------------------------------

## I5 -- Secretariat PDF

**Ziel:** Dasselbe PDF aus einer vorhandenen Application im Sekretariat
erzeugen.

**Dependencies:** I3, J3

------------------------------------------------------------------------

# 11. Epic J -- Secretariat SPA

## J1 -- Microsoft-365-Login

**Ziel:** Persönliche Authentifizierung der Sekretariatsmitarbeiter.

**Constraints:**

-   kein eigenes Benutzerverwaltungssystem
-   Berechtigungen kommen aus Microsoft 365 / SharePoint

**Definition of Done:** Autorisierte Benutzer erhalten Zugriff; nicht
autorisierte Benutzer nicht.

**Dependencies:** B1

------------------------------------------------------------------------

## J2 -- Tagesansicht

**Ziel:** Termine eines auswählbaren Tages darstellen.

Darstellung berücksichtigt:

-   parallele Verantwortliche
-   Appointment-State
-   Application-State

**Dependencies:** J1, E1

------------------------------------------------------------------------

## J3 -- Gespräch/Application öffnen

**Ziel:** Aus einem Termin die zugehörige Application öffnen und
bearbeiten.

**Dependencies:** J2, C4

------------------------------------------------------------------------

## J4 -- Gespräch angetreten

**Ziel:** Application explizit auf `interview` setzen.

**Semantik:** Die Familie ist erschienen und das Anmeldegespräch wurde
angetreten.

**Dependencies:** J3

------------------------------------------------------------------------

## J5 -- Autosave

**Ziel:** Änderungen an Applications automatisch persistieren.

**Constraints:** Sinnvolles Debouncing; nicht für jede einzelne Eingabe
unnötig eine Schreiboperation erzeugen.

**Definition of Done:** Browser-Neuladen nach gespeicherter Änderung
verliert keine Daten.

**Dependencies:** J3

------------------------------------------------------------------------

## J6 -- Kommentare

**Ziel:** Zwei einfache Textfelder im Datenmodell berücksichtigen:

``` text
secretariatComment
interviewerComment
```

Im MVP wird insbesondere `secretariatComment` verwendet.

**Constraints:** Kein Chat- oder Thread-System.

**Dependencies:** J3

------------------------------------------------------------------------

# 12. Epic K -- Anmeldungsverwaltung

## K1 -- Applications Panel

**Ziel:** Terminunabhängige Verwaltung aller Anmeldungen.

**Output:** Eigener Bereich in der Secretariat SPA.

**Dependencies:** J1

------------------------------------------------------------------------

## K2 -- Namenssuche

**Ziel:** Applications anhand des Namens finden.

**Definition of Done:** Sekretariat kann insbesondere eine Application
nach Terminabsage weiterhin finden.

**Dependencies:** K1

------------------------------------------------------------------------

## K3 -- Application bearbeiten

**Ziel:** Aus Suchergebnis vollständigen internen Form Renderer öffnen.

**Dependencies:** K2, C4

------------------------------------------------------------------------

## K4 -- Statusfilter

**Ziel:** Applications nach Status filtern.

Insbesondere:

-   `submitted`
-   `interview`
-   `in_review`
-   `checked`
-   `ready_for_svws`
-   `imported`

**Dependencies:** K1

------------------------------------------------------------------------

## K5 -- Prüfung und Freigabe

**Ziel:** Sekretariat führt die fachlichen Statusübergänge durch.

Insbesondere:

``` text
interview → in_review → checked → ready_for_svws
```

**Constraints:** `checked → ready_for_svws` erfolgt explizit und nicht
automatisch.

**Dependencies:** K3

------------------------------------------------------------------------

# 13. Epic L -- Terminabsage

## L1 -- Buchung freigeben

**Ziel:** Sekretariat kann einen telefonisch abgesagten Termin
freigeben.

Operation:

``` text
booked → available
```

Terminbezogene Kundendaten und `application_id` werden aus dem
Appointment entfernt.

**Invariante:** Die referenzierte Application wird nicht gelöscht.

**Definition of Done:** Slot erscheint anschließend wieder öffentlich;
Application bleibt über die Namenssuche auffindbar.

**Dependencies:** E1, K2

------------------------------------------------------------------------

# 14. Epic M -- SVWS-Grenze

## M1 -- Adapter Boundary

**Ziel:** Im Code eine klare Schnittstelle für die spätere
SVWS-Integration vorsehen.

**Output:** Interface/Port, aber noch keine reale SVWS-Implementierung.

**Constraints:** Keine Arbeit an konkreten SVWS-Endpunkten, solange der
übrige Workflow nicht läuft.

**Dependencies:** A2

------------------------------------------------------------------------

## M2 -- Transferauswahl vorbereiten

**Ziel:** Applications Panel kann `ready_for_svws` Datensätze anzeigen
und auswählen.

Noch kein tatsächlicher Transfer.

**Dependencies:** K4, K5, M1

------------------------------------------------------------------------

# 15. Epic N -- Konfiguration und Deployment

## N1 -- Secretariat Client Configuration

**Ziel:** Lokale nicht-geheime Installationskonfiguration.

Mindestens:

-   Tenant
-   Client
-   SharePoint-Site

**Output:** localStorage-basierte Config mit:

-   `schemaVersion`
-   JSON-Import
-   JSON-Export

**Constraints:** Keine Secrets.

**Dependencies:** J1

------------------------------------------------------------------------

## N2 -- SVWS Endpoint Configuration

**Ziel:** Für spätere Integration einen austauschbaren `svwsEndpoint`
vorsehen.

Die Architektur muss weiterhin ermöglichen:

``` text
Browser → SVWS
Browser → CORS Proxy → SVWS
Tauri → SVWS
```

**Constraints:** Noch keine konkrete SVWS-Kommunikation.

**Dependencies:** M1

------------------------------------------------------------------------

# 16. Future Releases

Diese Punkte gehören ausdrücklich nicht zum MVP und sollen von
Coding-Agents nicht eigenständig in den MVP gezogen werden.

## Terminverschiebung

Bestehenden Appointment freigeben, neuen Termin buchen und die
vorhandene Application-ID sicher übertragen.

## Gesprächsführer-Ansicht

Persönliche Terminliste für Gesprächsführer mit:

-   verbleibenden Gesprächen
-   Uhrzeiten
-   zugehörigen Applications
-   Lesen und Korrigieren der Daten
-   `secretariatComment` anzeigen
-   `interviewerComment` bearbeiten

## Uploads

Insbesondere:

-   Passfoto
-   Dokumente

Binäre Daten werden getrennt vom strukturierten Application JSON
gespeichert.

## SVWS Adapter

Konkrete:

-   API-Erkennung
-   Mapping
-   Validierung
-   Übertragung
-   Fehlerbehandlung

## SVWS-/SchILD-Kataloge

Synchronisation bzw. Bereitstellung von Referenzdaten wie:

-   Nationalitäten
-   Religionen
-   Schulen
-   weitere statistische Schlüssel

## PDF Design Engine

Spätere Pipeline:

``` text
Form JSON
    ↓
PDF Design Engine
    ↓
pdf-lib
    ↓
AcroForm PDF
```

Die Design Engine verwendet ein einheitliches Designsystem und
wiederverwendbare Script-/Renderblöcke für beispielsweise:

-   Sections
-   Textfelder
-   Selects
-   Checkboxen
-   Gruppen
-   Tabellen
-   Unterschriftsbereiche
-   Infotexte

Webformular und PDF verwenden dieselbe FormDefinition, müssen aber nicht
dasselbe Layout besitzen.

## Flexible PDF-Templates

-   mehrere Dokumenttypen
-   mehrere Layouts
-   Template-Versionierung
-   flexiblere Gestaltung

------------------------------------------------------------------------

# 17. Sprint-Vorschlag

Die Sprints sollen möglichst früh einen vertikalen, testbaren Durchstich
liefern.

## Sprint 1 -- Fundament

-   A1 -- Repository und Workspace
-   A2 -- Domain-Modell
-   B1 -- SharePoint-Adapter
-   B2 -- Schema-Provisionierung
-   B3 -- Config-System
-   C1 -- Form-JSON-Schema
-   J1 -- Microsoft-365-Login

**Ergebnis:** Technisches Fundament und funktionsfähige
SharePoint-Anbindung.

------------------------------------------------------------------------

## Sprint 2 -- Formulare

-   C2 -- Form Runtime
-   C3 -- Svelte Form Renderer
-   C4 -- Secretariat-Modus
-   D1 -- Procedure-Verwaltung
-   einfache Test-FormDefinition

**Ergebnis:** Formulare können aus JSON dargestellt und intern
bearbeitet werden.

------------------------------------------------------------------------

## Sprint 3 -- Termine und erster Testbetrieb

-   E1 -- Appointment Domain Service
-   E2 -- Terminplan-Generator
-   E3 -- Terminplan bearbeiten
-   E4 -- Termine veröffentlichen
-   E5 -- Parallelität
-   F1 -- Public SharePoint Client
-   F2 -- Public Configuration API
-   F3 -- Available-Appointments API
-   F4 -- Appointment Booking
-   G1 -- Public Bootstrap
-   G2 -- Terminauswahl
-   G3 -- Terminbuchung

Erster realer technischer Test:

``` text
SharePoint
→ Termine anlegen
→ veröffentlichen
→ Public SPA
→ Termin buchen
→ SharePoint
```

Ab diesem Sprint beginnt der fortlaufende Testbetrieb.

------------------------------------------------------------------------

## Sprint 4 -- Vollständige Anmeldung

-   F5 -- Application erstellen
-   F6 -- Application Submission
-   G4 -- Anmeldeformular
-   G5 -- Formular absenden
-   C5 -- bestehendes Anmeldeformular migrieren

End-to-End-Test:

``` text
Termin buchen
→ Formular ausfüllen
→ absenden
→ Application in SharePoint
```

------------------------------------------------------------------------

## Sprint 5 -- Sekretariat

-   J2 -- Tagesansicht
-   J3 -- Application öffnen
-   J4 -- Interview
-   J5 -- Autosave
-   J6 -- Kommentare
-   K1 -- Applications Panel
-   K2 -- Namenssuche
-   K3 -- Application bearbeiten
-   K4 -- Statusfilter
-   K5 -- Prüfung und Freigabe
-   L1 -- Terminabsage

Ab hier kann ein kompletter Anmeldetag mit Testpersonen simuliert
werden.

------------------------------------------------------------------------

## Sprint 6 -- Dokumente und Abschluss

-   H1 -- Terminbestätigung
-   I1 -- pdf-lib Integration
-   I2 -- festes Anmelde-PDF
-   I3 -- Application → PDF Mapping
-   I4 -- Public PDF Download
-   I5 -- Secretariat PDF
-   M1 -- SVWS Adapter Boundary
-   M2 -- Transferauswahl
-   N1 -- Client Configuration
-   N2 -- SVWS Endpoint Configuration

**Ergebnis:** Vollständiger MVP ohne konkrete SVWS-Übertragung.

------------------------------------------------------------------------

# 18. Entwicklungsprinzip

Nicht bis zum Ende entwickeln und anschließend erstmals integrieren.

Ab Sprint 3 wird jeder Sprint gegen einen realen SharePoint-Testbestand
getestet. Ab Sprint 4 werden vollständige Anmeldevorgänge durchgeführt.
Ab Sprint 5 wird der reale Arbeitsablauf des Sekretariats simuliert.

Erkenntnisse aus dem Testbetrieb werden als neue oder geänderte
Backlog-Tasks aufgenommen, ohne die festgelegte Grundarchitektur bei
jedem Detail erneut zu öffnen.

