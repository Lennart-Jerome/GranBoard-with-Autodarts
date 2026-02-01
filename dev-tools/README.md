# Entwickler-Tools (Advanced)

Dieser Ordner enthält **Entwicklungs- und Analyse-Tools**, die während der
Entwicklung von **GranBoard-with-Autodarts** verwendet wurden.

⚠️ **Normale Nutzer benötigen diese Tools NICHT.**  
Sie richten sich ausschließlich an Entwickler, Bastler und technisch versierte Anwender.

---

## Inhalt

### 🛠️ GranBoard MITM Proxy
- Python-basierter **BLE Man-in-the-Middle Proxy**
- Dient zur Analyse und zum Loggen der Bluetooth-Kommunikation
  zwischen GranBoard und offiziellen Apps
- Hilfreich für:
  - Reverse Engineering
  - Protokollanalyse
  - Debugging neuer Funktionen

➡️ Details: **`README GranBoard MITM Proxy.md`**

---

### 🌈 GranBoard LED Control
- HTML/JavaScript-Tool zur **direkten Steuerung der GranBoard-LEDs**
- Ermöglicht das Senden von **rohen LED-Kommandos** an das Board
- Wird verwendet für:
  - Tests von LED-Effekten
  - visuelles Feedback (z. B. bei `Next`)
  - Vorbereitung zukünftiger LED-Integrationen

➡️ Details: **`README GranBoard_LED_Control.md`**

---

## ⚠️ Hinweis / Haftungsausschluss
Diese Tools können:
- das normale Verhalten des GranBoards beeinflussen
- eine aktive BLE-Verbindung blockieren
- unerwartete Effekte verursachen

**Verwendung auf eigene Gefahr.**

Für den normalen Betrieb von *GranBoard-with-Autodarts* sind diese Tools **nicht erforderlich**.
