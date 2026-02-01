# Developer Tools (Advanced)

This folder contains **development and reverse-engineering tools** used during
the creation of **GranBoard-with-Autodarts**.

⚠️ **Normal users do NOT need these tools.**  
They are intended for developers, tinkerers and advanced users only.

---

## Contents

### 🛠️ GranBoard MITM Proxy
- Python-based **BLE Man-in-the-Middle proxy**
- Used to inspect and log Bluetooth communication
  between the GranBoard and official apps
- Helpful for:
  - reverse engineering
  - protocol analysis
  - debugging new features

➡️ See: **`README GranBoard MITM Proxy.md`**

---

### 🌈 GranBoard LED Control
- HTML/JavaScript tool for **direct GranBoard LED control**
- Allows sending **raw LED commands** to the board
- Used for:
  - testing LED effects
  - visual feedback (e.g. on `Next`)
  - preparing future LED integrations

➡️ See: **`README GranBoard_LED_Control.md`**

---

## ⚠️ Disclaimer
These tools may:
- interfere with normal GranBoard operation
- block active BLE connections
- cause unexpected behavior

**Use at your own risk.**

They are **not required** for normal usage of *GranBoard-with-Autodarts*.
