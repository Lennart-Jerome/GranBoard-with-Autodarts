# GranBoard with Autodarts

**GranBoard with Autodarts** is a Tampermonkey userscript that connects a **GranBoard via Bluetooth (BLE)** directly to **Autodarts** and automatically enters throws.

The script intelligently decides whether input should be handled via the **Autodarts keyboard** or directly via the **board view**, depending on the active game mode.

---

## ✨ Features

- 🔵 Direct Bluetooth connection to GranBoard (WebBluetooth)
- 🎯 Automatic detection of hits (Single / Double / Triple / Bull / Miss)
- ⌨️ **Keyboard input** when numbers are allowed in the Autodarts keypad
- 🎯 **Boardview fallback** when no numbers are allowed (e.g. Bobs27)
- 🔁 Automatic switching between keyboard and board view (auto mode)
- 👁️ Overlay with status, mode display and debug logs
- 🌈 **Visual feedback on the board** when `Next` is pressed (touch field briefly lights up)

---

## 🧩 Supported Game Modes (Examples)

- ✅ X01
- ✅ Cricket
- ✅ Training
- ✅ Bobs27  
  → No numeric keypad available, only *Hit / Miss / Undo / Next*  
  → The script automatically switches to **Boardview** and clicks the board ❗ Manuel switch i Autodarts currently needed

---

## ⚠️ Current Development Status (Important)

- ❗ **No Auto-Next yet**  
  → `Next` must currently be triggered **manually via the GranBoard touch field**  
  → Automatic Next is **planned**, but not implemented yet
- ❗ **LED control is still in development**  
  → Stop initial Rainbow effekt by disconnect and reconnect
  → Currently, there is **only visual feedback** when `Next` is pressed  
  → The touch field briefly lights up in rainbow mode  
  → Further LED integrations are planned (DevTools already prepared)

---

## 🖥️ Requirements

- Google **Chrome** or **Microsoft Edge**
- Bluetooth enabled
- GranBoard powered on
- Autodarts account
- **Tampermonkey** browser extension

> ❌ Firefox is **not supported**, as WebBluetooth is not reliably available.

---

## 🔧 Browser Settings (Very Important)

To ensure proper operation, **userscripts must be allowed**:

### Chrome / Edge
1. Install Tampermonkey
2. In Tampermonkey:
   - Enable “Allow userscripts”❗ 
3. Allow Bluetooth access in the browser
4. Do **not** block the Bluetooth device selection popup

> ⚠️ The Bluetooth dialog must **always be confirmed manually**  
> (browser security requirement)

---

## 📦 Installation

### 1️⃣ Install Tampermonkey
- https://www.tampermonkey.net/

Einstellung von Tampermonkey erweiterung
![Settings ](images/Tampermonkey-setting.png)



![Settings](images/Tampermonkey-setting-2.png)

### 2️⃣ Install the userscript
👉 Open this link (Tampermonkey will detect it automatically):

https://raw.githubusercontent.com/Lennart-Jerome/GranBoard-with-Autodarts/main/GranBoard-with-Autodarts.user.js

### 3️⃣ Open Autodarts
- https://play.autodarts.io

### 4️⃣ Power on the GranBoard

### 5️⃣ Open the overlay
- A **GB circle** appears in the bottom-right corner
- Click it to open the overlay

### 6️⃣ Connect
- Click **Connect**
- Select the GranBoard in the Bluetooth dialog
- Confirm the connection

---

## 🔄 How Does the Input Logic Work?

### 🔹 Keyboard Has Priority
If numeric buttons are **visible and clickable** in the Autodarts keypad (e.g. `S20`, `D20`, `T20`):
- Throws are entered **via the keyboard**
- All other hits are treated as **Miss**

### 🔹 Boardview Fallback (Auto)
If the keypad **does not contain any numbers**, for example:
- only `Hit`
- `Miss`
- `Undo`
- `Next`

➡️ Then:
- the script automatically switches to **Boardview**
- clicks the board at the calculated position

The current mode is shown in the overlay.

---

## 🔘 Overlay & Controls

- **Connect / Disconnect**: Bluetooth connection
- **Mode selection**:
  - Auto (recommended)
  - Keyboard
  - Board
- **Debug mode**:
  - Displays logs and raw data
- **Status display**:
  - Green = connected
  - Red = disconnected

---

## 🔐 Privacy & Security

- ✅ No personal data
- ✅ No accounts, tokens or IDs
- ✅ No fixed MAC addresses
- ✅ BLE UUIDs are identical across all GranBoards
- ✅ All data remains local in the browser

---

## 🧪 Compatibility

- Tested with GranBoard (BLE)
- Should work with all GranBoard models supported by the official GranBoard app

---

## 🚧 Known Limitations

- Autodarts UI changes may require adjustments
- WebBluetooth behavior depends on the browser
- Firefox is not supported

---

## 🛠️ Development & Roadmap

Planned features:
- Automatic `Next`
- Extended LED control
- More detailed visual feedback
- Optional browser extension

Contributions, feedback and testing are welcome 👍

---

## 📜 License

Private use and hobby projects allowed.  
No official affiliation with Autodarts or GranBoard.
