# GranBoard LED Controller (Web Bluetooth)

Dieses Projekt ist ein **Reverse-Engineering / Test-Tool** für die LED-Steuerung eines GranBoard über **Web Bluetooth**.
Es stellt eine **lokal ausführbare HTML-Datei** bereit, mit der man:

- den **statischen Ring (20 Segmente)** per 20-Byte-Palette steuern kann
- verschiedene **Preset-Effekte** (OP-Codes) mit Farbe(n) + Speed senden kann
- den **Target Hit Effekt** (Single/Double/Triple) auf ein Segment mit zwei Farben senden kann
- Roh-Hex-Kommandos manuell senden kann (Debug / zukünftige Erweiterungen)

> Hinweis: Das ist keine offizielle GranBoard-API. Alles basiert auf beobachteten BLE-Nachrichten (Sniffer / Logging).
> Verwendung auf eigenes Risiko.

---

## Voraussetzungen

### Browser / Plattform
Web Bluetooth funktioniert i.d.R. nur in Chromium-basierten Browsern, z.B.:

- **Google Chrome (Desktop)**
- **Microsoft Edge (Desktop)**
- (Android Chrome kann je nach Gerät funktionieren)

**Safari / iOS** unterstützt Web Bluetooth in der Regel nicht zuverlässig bzw. nicht standardmäßig.

### Hardware
- GranBoard, Bluetooth eingeschaltet, Board erreichbar.

---

## Start / Nutzung

1. Datei `granboard_led_controller.html` lokal speichern
2. In Chrome öffnen (z.B. per Doppelklick oder `file://...`)
3. **Connect** klicken → BLE-Chooser öffnet sich
4. GranBoard auswählen
5. Danach können alle Buttons/Presets gesendet werden

Im rechten Log sieht man:
- **TX**: gesendete Bytes an das Board
- **RX**: Notifications vom Board (falls welche kommen)

---

## BLE / GATT Überblick

### Service + Characteristics

Das Tool nutzt diese UUIDs (Vendor Service):

- **Service UUID**
  - `442f1570-8a00-9a28-cbe1-e1d4212d53eb`

- **Notify Characteristic (RX)**
  - `442f1571-8a00-9a28-cbe1-e1d4212d53eb`
  - wird per `startNotifications()` aktiviert
  - liefert Events/Antworten des Boards (wenn vorhanden)

- **Write Characteristic (TX)**
  - `442f1572-8a00-9a28-cbe1-e1d4212d53eb`
  - hier werden alle LED-Frames hingeschrieben
  - bevorzugt `writeWithoutResponse` für geringere Latenz

### Verbindung / Ablauf
1. `navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices:[SVC_UUID] })`
2. `device.gatt.connect()`
3. `getPrimaryService(SVC_UUID)`
4. `getCharacteristic(CH_NOTIFY)` + `startNotifications()`
5. `getCharacteristic(CH_WRITE)` + Senden der Frames

---

## Nachrichtentypen / Erkenntnisse aus dem Reverse Engineering

Es gibt **mindestens zwei relevante Datenformate**, die wir zuverlässig nutzen:

---

## A) Statischer Ring (20 Segmente) – 20 Bytes

Für den Ring werden **exakt 20 Bytes** gesendet:
- **1 Byte pro Segment** (S1..S20)
- Jeder Bytewert ist **kein RGB**, sondern ein **Palette-Code (00–07)**.

### Palette Mapping (Code → sichtbare Farbe)
Beobachtet am Board:

| Code | Bedeutung |
|------|----------|
| `00` | OFF |
| `01` | Rot |
| `02` | Orange |
| `03` | Gelb |
| `04` | Hellgrün |
| `05` | Türkis |
| `06` | Lila |
| `07` | Weiß |

### Beispiel: Nur S1 rot
 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### Beispiel: Nur S20 rot
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01

### Beispiel: Nur S1 rot und S20 WEIß
01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 07

### Beispiel: Alles aus
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00


---

## B) Effekt-Frames – 16 Bytes (OP-basiert)

Viele Effekte laufen über Frames mit **16 Bytes** Gesamtlänge.

### Typischer Aufbau (beobachtet)
**Byte-Index (0-basiert):**

- **[0]**  OP-Code (Effekt-ID)
- **[1..3]** Color A (R, G, B)
- **[4..6]** (manchmal Color B oder weitere Parameter)
- **[10..11]** (bei Target-Hit: Target-ID, little-endian)
- **[12]** Speed / Timing (bei vielen OPs)
- **[15]** häufig `01` (Frame-Terminierung)

> Nicht jeder OP nutzt jedes Feld gleich. Manche OPs ignorieren Farben oder nutzen nur Teilbereiche.

---

## Speed-Regelung (Slider)

### Presets (OPs)
Die UI nutzt für Presets bewusst eine “sinnvolle” Range:
- **35 = langsam**
- **0 = schnell**

Das entspricht einem Bereich, der in der Praxis gut nutzbar ist.

### Hit-Effekt (Target Hit)
Beim Hit-Effekt ist die komplette Range sinnvoll:
- **00..FF**

---

## Target Hit Effekt (Single/Double/Triple)

Dieser Effekt basiert auf App-Frames:
- 16 Byte
- **zwei Farben** (Color A / Color B)
- **Target-ID** bestimmt welches Segment “getroffen” wird
- Hit-Type bestimmt Single/Double/Triple

### Hit-Type
| Wert | Meaning |
|------|--------|
| `01` | Single |
| `02` | Double |
| `03` | Triple |

### Target-ID Mapping (Segment → Target-ID)
Diese IDs wurden aus Sniffer-Logs rekonstruiert:

| Segment | Target-ID (hex) |
|---------|------------------|
| S1  | 0x001C |
| S2  | 0x0031 |
| S3  | 0x0037 |
| S4  | 0x0022 |
| S5  | 0x0016 |
| S6  | 0x0028 |
| S7  | 0x0001 |
| S8  | 0x0007 |
| S9  | 0x0010 |
| S10 | 0x002B |
| S11 | 0x000A |
| S12 | 0x0013 |
| S13 | 0x0025 |
| S14 | 0x000D |
| S15 | 0x002E |
| S16 | 0x0004 |
| S17 | 0x0034 |
| S18 | 0x001F |
| S19 | 0x003A |
| S20 | 0x0019 |

---

## Presets / OP-Codes im Tool

Das Tool enthält nur die OPs, die wir als “brauchbar” festgelegt haben (ohne A/B Spielereien),
plus Sniffer-basierte Frames.

Beispiele:
- OP0C Touch Rainbow
- OP0F Rainbow Rotate (3 Segmente)
- OP10 Split Rainbow
- OP0D Event 0D (Ring + Touch)
- OP14 Pulse
- OP15 Dark Solid
- OP16 Color Cycle
- OP17 Flash/Blink
- OP18 Flicker (Default Speed 0x14 empfohlen)
- OP19 Hunt Flicker (mit Pattern-Bytes)
- OP1B Shake
- OP1D Fade / Sweep + Fade
- OP11 Next (2-Segment)
- OP1F Bull Multicolor Fade (3 Farben)

> Manche OPs reagieren zwar auf Farbfelder, andere ignorieren Farben (die UI lässt Farben dennoch setzen, damit man testen kann).

---

## Manuell senden (Hex)

Das Tool erlaubt “Raw Frames” zu senden:
- Hex-Bytes mit Leerzeichen, Komma oder `0x`
- Kommentare nach `;` oder `#` werden ignoriert

Beispiel:
18 FF 00 00 00 00 00 00 00 00 00 00 14 00 00 01

---

## Ziel / Nächste Schritte

Diese HTML ist als **Test- und Referenz-Tool** gedacht, um später in z.B. einem Tampermonkey-Skript
LED-Logik zu integrieren, z.B.:

- Finish-Weg: Triple-Felder rot leuchten lassen
- “Next Player” Animation
- Bull-Hit Multicolor Effekte

---

## Board Settings (Reverse Engineered – Info Only)

Neben LED-Kommandos wurden auch mehrere **Board-Einstellungen**
über BLE beobachtet.  
Diese sind **nicht Teil dieses Tools**, werden hier aber dokumentiert,
da sie für Analyse, Debugging und zukünftige Erweiterungen relevant sind.

### Antwortintervall des Boards

- GranBoatd App UI: Slider (kurz ↔ lang)
- BLE-Kommando endet auf ASCII `45` (HEX `34 35`)
- Wert liegt im ersten Byte (0 = sehr kurz)

Beispiel:
Antwortintervall = 0 (sehr kurz)
04 00 00 00 00 00 00 00 00 00 34 35

Antwortintervall = 8
08 00 00 00 00 00 00 00 00 00 34 35

Antwortintervall = 12
0E 00 00 00 00 00 00 00 00 00 34 35




### Out-Reaktionsempfindlichkeit (außerhalb Zielbereich)

- GranBoatd AppUI: Slider (niedrig ↔ hoch)
- Wertebereich beobachtet: 0–15
- BLE-Kommando endet auf ASCII `67` (HEX `36 37`)

Beispiel:
Out-Reaktionsempfindlichkeit = 0 (sehr niedrig)
00 00 00 00 00 00 00 00 00 00 36 37

Out-Reaktionsempfindlichkeit = 7
07 00 00 00 00 00 00 00 00 00 36 37

Out-Reaktionsempfindlichkeit = 15 (sehr hoch)
0F 00 00 00 00 00 00 00 00 00 36 37


### Reaktionsempfindlichkeit im Zielbereich (Presets)

Die GranBoard-App verwendet **keinen Slider**, sondern
vier feste Presets:

- SET1
- SET2
- SET3
- SET4

Diese Presets werden über BLE als **komplette Parameter-Sets**
gesendet (kein einzelner Wert).

Merkmale:
- UI: Radio Buttons
- BLE-Kommando endet auf `3A 3B`
- mehrere Parameter pro Set
- keine lineare Skala

SET1
00 00 00 4B 04 05 00 00 00 00 3A 3B
SET2
00 00 00 73 02 05 00 00 00 00 3A 3B
SET3
00 00 00 96 02 05 00 00 00 00 3A 3B
SET4
00 00 00 96 00 0A 00 00 00 00 3A 3B



## Haftungsausschluss

Dies ist Reverse Engineering, keine offizielle Schnittstelle.
Keine Garantie, dass das mit allen GranBoard-Firmwares identisch funktioniert.
Verwendung auf eigenes Risiko.
