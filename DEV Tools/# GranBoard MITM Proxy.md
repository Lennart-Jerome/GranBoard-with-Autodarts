# GranBoard MITM Proxy + Web UI (gb_proxy2_web.py)

Dieses Projekt ist ein **Reverse-Engineering / Test-Tool** für das GranBoard BLE-Protokoll.
Es läuft auf einem **Raspberry Pi** als **Man-in-the-Middle (MITM)** zwischen:

- **GranBoard App (iOS/Android)**  ↔  **Raspberry Pi (Proxy / Fake GranBoard)**  ↔  **echtes GranBoard**

Zusätzlich stellt es einen **lokalen Webserver** bereit, um:
- BLE Frames **live zu loggen** (APP→BOARD & BOARD→APP)
- **Kommentare/Notizen** zu Frames zu speichern (persistiert)
- **manuell Frames an das Board zu senden** (z.B. LED Frames testen)
- **Fake “Hit”-Events an die App zu senden**, ohne das Board zu treffen (klickbares Dartboard)

> Hinweis: Das ist keine offizielle GranBoard-API. Alles basiert auf beobachteten BLE-Nachrichten.
> Verwendung auf eigenes Risiko.

---

## Features

### MITM Proxy (BlueZ GATT Server + Bleak Client)
- Der Pi advertised als `GRANBOARD` (oder eigener Name).
- Die App verbindet sich mit dem Pi, als wäre es das Board.
- Der Pi verbindet sich upstream mit dem echten Board und leitet Daten weiter.

### Web UI
- Live Log (Tabellenansicht, Monitor-tauglich)
- **Keine abgeschnittenen Messages** (ASCII/HEX umbrechen)
- Kommentare pro Logzeile (Enter zum Speichern)
- Manuelles Senden:
  - **Send → Board**: Hex-Bytes (für LED Reverse Engineering)
  - **Send → App**: Fake Hit Strings (z.B. `11.6@`)
- Fake Hit per **klickbarem Dartboard** (SO/SI/D/T + Bulls)
- Quick Buttons:
  - `OUT@` = Miss/Out
  - `BTN@` = Next/Button

---


# HARDWARE-VORAUSSETZUNGEN

- Raspberry Pi mit Bluetooth (Pi 3 / Pi 4 empfohlen)
- GranBoard in Reichweite
- Smartphone / Tablet mit GranBoard App

---

# SOFTWARE-VORAUSSETZUNGEN

- Raspberry Pi OS oder anderes Linux mit BlueZ
- Bluetooth Service aktiv
- Python 3
- Virtual Environment empfohlen

Benötigte Python-Module:
- bleak
- flask
- dbus-python
- gi (GLib Bindings)

---

# INSTALLATION (Raspberry Pi)

1) System-Abhängigkeiten installieren

sudo apt-get update
sudo apt-get install -y bluetooth bluez \
  python3 python3-venv python3-pip \
  python3-dbus python3-gi

Bluetooth aktivieren:

sudo systemctl enable bluetooth
sudo systemctl start bluetooth

---

2) Projektordner & Python venv

mkdir -p ~/gb_mitm
cd ~/gb_mitm

python3 -m venv venv
source venv/bin/activate

python3 -m pip install --upgrade pip
python3 -m pip install bleak flask

---

# KONFIGURATION

Im Header von gb_proxy_web.py befinden sich folgende Einstellungen:

- REAL_BOARD_ADDR
  BLE-Adresse des echten GranBoards (optional)

- REAL_BOARD_NAME
  Scan-Name des Boards, z.B. "GRANBOARD"

- PROXY_LOCAL_NAME
  Name, unter dem sich der Pi gegenüber der App meldet


Beispiel:

export GB_REAL_ADDR="C2:A4:CF:XX:YY:ZZ"

---

# STARTEN

WICHTIG:
Das Script MUSS mit dem venv-Python unter sudo gestartet werden.

sudo -E ~/gb_mitm/venv/bin/python3 ~/gb_mitm/gb_proxy_web.py

Danach:

- GranBoard App öffnen
- Mit PROXY_LOCAL_NAME verbinden (z.B. "GRANBOARD")
- Web UI im Browser öffnen:

http://<PI-IP>:8787

---

# AUTOMATISCHER BLUETOOTH RESET (optional)

Viele Setups sind stabiler, wenn Bluetooth vor dem Start neu initialisiert wird.

Manuell:

sudo systemctl restart bluetooth
sudo hciconfig hci0 up

Im Script kann das automatisiert werden:

AUTO_BT_RESET_ON_START = True
AUTO_BT_RESET_ON_EXIT  = False

---

# MITM / HANDSHAKE ERKLÄRT

BLE Rollen:

- App verbindet sich mit dem Raspberry Pi (GATT Server)
- Raspberry Pi verbindet sich mit dem echten Board (Bleak Client)

Warum Buffer Replay?

Einige Apps abonnieren Notifications erst nach dem Verbindungsaufbau.
Dadurch können initiale Frames verloren gehen.

Lösung:

- Board -> App Notifications werden gepuffert
- Sobald die App StartNotify() ausführt,
  werden alle gepufferten Frames erneut gesendet

Im Code realisiert durch:

- real_notify_buffer
- flush_buffer_to_app()

---

# LOGGING

Was wird geloggt:

- APP -> BOARD Writes
- BOARD -> APP Notifications
- Keine internen Proxy-Debug-Messages

Log-Datei:

~/gb_mitm/mitm_log.json

Pro Eintrag:

- Zeit
- Richtung (app->board / board->app)
- Art (ble / manual)
- ASCII
- HEX
- Kommentar

Kommentare:

- Direkt in der Web UI editierbar
- `Enter speichert`
- Persistiert im JSON-Log

---
## GranBoard Hit-Ergebnisse (ASCII Frames)

Das GranBoard sendet Treffer als **ASCII-Strings**, die mit `@` enden.  
Diese Frames kommen als **BLE Notification** vom Board zur App.

Beispiel:
- ASCII: `11.6@`
- HEX: `31 31 2E 36 40`

Format:
<ZONE>.<INDEX>@

---

### Single / Double / Triple Felder (1–20)

Legende:
- SI = Single Inner
- SO = Single Outer
- D  = Double
- T  = Triple

SO1 -> 2.5@
SI1 -> 2.3@
D1 -> 2.6@
T1 -> 2.4@

SO2 -> 9.2@
SI2 -> 9.1@
D2 -> 8.2@
T2 -> 9.0@

SO3 -> 7.2@
SI3 -> 7.1@
D3 -> 8.4@
T3 -> 7.0@

SO4 -> 0.5@
SI4 -> 0.1@
D4 -> 0.6@
T4 -> 0.3@

SO5 -> 5.4@
SI5 -> 5.1@
D5 -> 4.6@
T5 -> 5.2@

SO6 -> 1.3@
SI6 -> 1.0@
D6 -> 4.4@
T6 -> 1.1@

SO7 -> 11.4@
SI7 -> 11.1@
D7 -> 8.6@
T7 -> 11.2@

SO8 -> 6.5@
SI8 -> 6.2@
D8 -> 6.6@
T8 -> 6.4@

SO9 -> 9.5@
SI9 -> 9.3@
D9 -> 9.6@
T9 -> 9.4@

SO10 -> 2.2@
SI10 -> 2.0@
D10 -> 4.3@
T10 -> 2.1@

SO11 -> 7.5@
SI11 -> 7.3@
D11 -> 7.6@
T11 -> 7.4@

SO12 -> 5.5@
SI12 -> 5.0@
D12 -> 5.6@
T12 -> 5.3@

SO13 -> 0.4@
SI13 -> 0.0@
D13 -> 4.5@
T13 -> 0.2@

SO14 -> 10.5@
SI14 -> 10.3@
D14 -> 10.6@
T14 -> 10.4@

SO15 -> 3.2@
SI15 -> 3.0@
D15 -> 4.2@
T15 -> 3.1@

SO16 -> 11.5@
SI16 -> 11.0@
D16 -> 11.6@
T16 -> 11.3@

SO17 -> 10.2@
SI17 -> 10.1@
D17 -> 8.3@
T17 -> 10.0@

SO18 -> 1.5@
SI18 -> 1.2@
D18 -> 1.6@
T18 -> 1.4@

SO19 -> 6.3@
SI19 -> 6.1@
D19 -> 8.5@
T19 -> 6.0@

SO20 -> 3.5@
SI20 -> 3.3@
D20 -> 3.6@
T20 -> 3.4@


---

### Bullseye

SBULL (25) -> 8.0@
DBULL (50) -> 4.0@


---

### Miss / Sonder-Events

OUT@ -> Miss / Dart außerhalb
BTN@ -> Button / Next / Continue (App abhängig)

# FAKE HITS (OHNE DART WERFEN)

GranBoard Treffer werden als ASCII gesendet, z.B.:

11.6@

HEX:
31 31 2E 36 40

Die Web UI erlaubt:

- Klickbares Dartboard
- OUT@ Button (Miss)
- BTN@ Button (Next)

Ideal für:

- LED-Tests
- App-Logik
- Trainingsdaten
- Reverse Engineering

---

# MANUELLES SENDEN AN DAS BOARD (LED TESTS)

Unter "Send -> Board" können beliebige Hex-Frames gesendet werden.

Beispiel (20 Byte LED Frame):

01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 07

Ziel:

- LED-Protokoll verstehen
- Effekte analysieren
- Trainingsdaten generieren

---

# LOGS AUSLESEN

Anzahl der Einträge:

python3 - <<'PY'
import json, os
p=os.path.expanduser('~/gb_mitm/mitm_log.json')
d=json.load(open(p))
print(len(d))
PY

Alle Einträge anzeigen (mit jq):

jq -r '.[] | "\(.t) \(.dir) \(.ascii) | \(.hex) | \(.comment)"' ~/gb_mitm/mitm_log.json

---


HAFTUNGSAUSSCHLUSS

Dieses Projekt basiert auf Reverse Engineering.
Keine Garantie für Kompatibilität mit allen GranBoard-Firmwares.
Verwendung auf eigenes Risiko.

