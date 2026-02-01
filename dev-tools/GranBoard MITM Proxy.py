#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import json
import queue
import threading
import asyncio
import subprocess
from collections import deque

import dbus
import dbus.exceptions
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

from bleak import BleakClient, BleakScanner

from flask import Flask, Response, request, jsonify, render_template_string, make_response


# =========================
# UI / BUILD INFO
# =========================
UI_VERSION = "webui-2026-01-31-02"   # <-- siehst du oben links in der UI


# =========================
# CONFIG
# =========================
REAL_BOARD_ADDR = "C2:A4:CF:2B:5F:F6"   # dein GranBoard (random addr)
REAL_BOARD_NAME = "GRANBOARD"

PROXY_LOCAL_NAME = "GRANBOARD"          # muss für die App exakt so aussehen

VENDOR_SERVICE_UUID = "442f1570-8a00-9a28-cbe1-e1d4212d53eb"
CHAR_NOTIFY_UUID    = "442f1571-8a00-9a28-cbe1-e1d4212d53eb"  # notify from board
CHAR_WRITE_UUID     = "442f1572-8a00-9a28-cbe1-e1d4212d53eb"  # write to board

REAL_NOTIFY_BUFFER_MAX = 300
UPSTREAM_CONNECT_TIMEOUT = 20
UPSTREAM_RETRY_SEC = 3

# Web/UI
WEB_HOST = "0.0.0.0"
WEB_PORT = 8787

DATA_DIR = os.path.expanduser("~/gb_mitm")
LOG_DB_PATH = os.path.join(DATA_DIR, "mitm_log.json")

# Auto Bluetooth Reset (du wolltest restart bluetooth + hci0 up automatisiert)
AUTO_BT_RESET_ON_START = True
AUTO_BT_RESET_ON_EXIT  = False   # meist reicht Start; Exit optional
BT_ADAPTER = "hci0"


# =========================
# Helpers
# =========================
def ts():
    return time.strftime("%H:%M:%S")

def log(msg: str):
    print(f"[{ts()}] {msg}", flush=True)

def hx(b: bytes) -> str:
    return " ".join(f"{x:02X}" for x in b)

def ascii_vis(b: bytes) -> str:
    out = []
    for x in b:
        if 32 <= x <= 126:
            out.append(chr(x))
        else:
            out.append(".")
    return "".join(out)

def now_ms():
    return int(time.time() * 1000)

def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)

def run_cmd(cmd):
    """Best-effort command runner (no crash)."""
    try:
        log(f"🛠️ RUN: {' '.join(cmd)}")
        subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        log(f"⚠️ CMD failed: {e}")

def bluetooth_reset_start():
    # entspricht deinem manuellen Ablauf
    run_cmd(["systemctl", "restart", "bluetooth"])
    run_cmd(["hciconfig", BT_ADAPTER, "up"])

def bluetooth_reset_exit():
    # optional – viele lassen Bluetooth einfach laufen
    # Wenn du wirklich willst: Adapter kurz down oder bluetooth restart
    run_cmd(["hciconfig", BT_ADAPTER, "down"])
    # run_cmd(["systemctl", "restart", "bluetooth"])


# =========================
# BlueZ DBus constants
# =========================
BLUEZ_SERVICE_NAME = "org.bluez"
DBUS_OM_IFACE      = "org.freedesktop.DBus.ObjectManager"
DBUS_PROP_IFACE    = "org.freedesktop.DBus.Properties"

GATT_MANAGER_IFACE = "org.bluez.GattManager1"
LE_ADV_MGR_IFACE   = "org.bluez.LEAdvertisingManager1"

GATT_SERVICE_IFACE = "org.bluez.GattService1"
GATT_CHRC_IFACE    = "org.bluez.GattCharacteristic1"

ADV_IFACE          = "org.bluez.LEAdvertisement1"

PID = os.getpid()
BASE = f"/com/gb/mitm/{PID}"  # unique per run


# =========================
# LOG STORE (persist comments)
# =========================
class LogStore:
    def __init__(self, path: str, max_items: int = 4000):
        self.path = path
        self.max_items = max_items
        self.lock = threading.Lock()
        self.items = []
        self._load()

    def _load(self):
        try:
            if os.path.exists(self.path):
                with open(self.path, "r", encoding="utf-8") as f:
                    self.items = json.load(f)
                    if not isinstance(self.items, list):
                        self.items = []
        except Exception:
            self.items = []

    def _save(self):
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.items, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        except Exception as e:
            log(f"⚠️ LogStore save failed: {e}")

    def add(self, entry: dict):
        with self.lock:
            self.items.append(entry)
            if len(self.items) > self.max_items:
                self.items = self.items[-self.max_items:]
            self._save()

    def list(self, limit: int = 800):
        with self.lock:
            return self.items[-limit:]

    def set_comment(self, entry_id: str, comment: str):
        with self.lock:
            for it in self.items:
                if it.get("id") == entry_id:
                    it["comment"] = comment
                    self._save()
                    return True
        return False


# =========================
# Event fanout (SSE)
# =========================
class EventHub:
    def __init__(self):
        self.clients = []
        self.lock = threading.Lock()

    def subscribe(self):
        q = queue.Queue(maxsize=300)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            try:
                self.clients.remove(q)
            except ValueError:
                pass

    def publish(self, event: dict):
        with self.lock:
            dead = []
            for q in self.clients:
                try:
                    q.put_nowait(event)
                except Exception:
                    dead.append(q)
            for q in dead:
                try:
                    self.clients.remove(q)
                except Exception:
                    pass


# =========================
# GATT Base classes
# =========================
class Application(dbus.service.Object):
    """
    org.freedesktop.DBus.ObjectManager
    """
    def __init__(self, bus):
        self.path = f"{BASE}/app"
        self.services = []
        super().__init__(bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_service(self, service):
        self.services.append(service)

    @dbus.service.method(DBUS_OM_IFACE, out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        response = {}
        for service in self.services:
            response[service.get_path()] = service.get_properties()
            for chrc in service.characteristics:
                response[chrc.get_path()] = chrc.get_properties()
        return response


class Service(dbus.service.Object):
    def __init__(self, bus, index, uuid, primary=True):
        self.path = f"{BASE}/service{index}"
        self.bus = bus
        self.uuid = uuid
        self.primary = primary
        self.characteristics = []
        super().__init__(bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_characteristic(self, chrc):
        self.characteristics.append(chrc)

    def get_properties(self):
        return {
            GATT_SERVICE_IFACE: {
                "UUID": dbus.String(self.uuid),
                "Primary": dbus.Boolean(self.primary),
                "Characteristics": dbus.Array([c.get_path() for c in self.characteristics], signature="o"),
            }
        }


class Characteristic(dbus.service.Object):
    def __init__(self, bus, index, uuid, flags, service: Service):
        self.path = f"{service.path}/char{index}"
        self.bus = bus
        self.uuid = uuid
        self.flags = flags
        self.service = service
        self.value = bytearray()
        self.notifying = False
        super().__init__(bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        return {
            GATT_CHRC_IFACE: {
                "Service": self.service.get_path(),
                "UUID": dbus.String(self.uuid),
                "Flags": dbus.Array([dbus.String(f) for f in self.flags], signature="s"),
                "Value": dbus.Array([dbus.Byte(b) for b in self.value], signature="y"),
            }
        }

    @dbus.service.method(DBUS_PROP_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        if interface != GATT_CHRC_IFACE:
            return {}
        return self.get_properties()[GATT_CHRC_IFACE]

    @dbus.service.signal(DBUS_PROP_IFACE, signature="sa{sv}as")
    def PropertiesChanged(self, interface, changed, invalidated):
        pass

    def _props_changed_value(self):
        self.PropertiesChanged(
            GATT_CHRC_IFACE,
            {"Value": dbus.Array([dbus.Byte(b) for b in self.value], signature="y")},
            []
        )

    @dbus.service.method(GATT_CHRC_IFACE, in_signature="a{sv}", out_signature="ay")
    def ReadValue(self, options):
        return dbus.Array([dbus.Byte(b) for b in self.value], signature="y")

    @dbus.service.method(GATT_CHRC_IFACE, in_signature="aya{sv}")
    def WriteValue(self, value, options):
        self.value = bytearray(value)

    @dbus.service.method(GATT_CHRC_IFACE)
    def StartNotify(self):
        self.notifying = True

    @dbus.service.method(GATT_CHRC_IFACE)
    def StopNotify(self):
        self.notifying = False


# =========================
# Advertisement (minimal, BlueZ-safe)
# =========================
class Advertisement(dbus.service.Object):
    def __init__(self, bus, index):
        self.path = f"{BASE}/advertisement{index}"
        self.bus = bus
        super().__init__(bus, self.path)

        self.ad_type = "peripheral"
        self.local_name = PROXY_LOCAL_NAME
        self.service_uuids = [VENDOR_SERVICE_UUID]
        self.appearance = 0x0000

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def get_properties(self):
        return {
            ADV_IFACE: {
                "Type": dbus.String(self.ad_type),
                "LocalName": dbus.String(self.local_name),
                "ServiceUUIDs": dbus.Array([dbus.String(u) for u in self.service_uuids], signature="s"),
                "Appearance": dbus.UInt16(self.appearance),
            }
        }

    @dbus.service.method(DBUS_PROP_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        if interface != ADV_IFACE:
            return {}
        return self.get_properties()[ADV_IFACE]

    @dbus.service.method(ADV_IFACE)
    def Release(self):
        log("📢 Advertisement released")


# =========================
# MITM State (+ UI hooks)
# =========================
class MitmState:
    def __init__(self, logstore: LogStore, hub: EventHub):
        self.real_notify_buffer = deque(maxlen=REAL_NOTIFY_BUFFER_MAX)
        self.app_notify_char = None
        self.app_subscribed = False
        self.upstream = None

        self.logstore = logstore
        self.hub = hub

    def _emit_ui(self, direction: str, payload: bytes, kind: str = "ble", comment: str = ""):
        entry = {
            "id": f"{now_ms()}-{os.getpid()}-{int(time.time()*1000)%1000000}",
            "t": ts(),
            "ms": now_ms(),
            "dir": direction,     # "app->board" / "board->app"
            "kind": kind,         # "ble" / "manual"
            "hex": hx(payload),
            "ascii": ascii_vis(payload),
            "comment": comment or "",
        }
        self.logstore.add(entry)
        self.hub.publish({"type": "log", "entry": entry})

    def on_real_notify(self, payload: bytes):
        # Board -> App
        self.real_notify_buffer.append(payload)

        # Terminal debug
        log(f"REAL->PI NOTIFY {hx(payload)}  ASCII:{ascii_vis(payload)}")

        # UI log
        self._emit_ui("board->app", payload, kind="ble")

        # forward to app
        if self.app_subscribed and self.app_notify_char is not None:
            GLib.idle_add(self._send_to_app, payload)

    def _send_to_app(self, payload: bytes):
        try:
            if self.app_notify_char:
                self.app_notify_char.send_notify(payload)
        except Exception as e:
            log(f"⚠️ Send notify to APP failed: {e}")
        return False

    def flush_buffer_to_app(self):
        if not self.app_subscribed or not self.app_notify_char:
            return False
        if not self.real_notify_buffer:
            return False

        items = list(self.real_notify_buffer)
        self.real_notify_buffer.clear()

        log(f"[HANDSHAKE] ▶️ Replaying {len(items)} buffered REAL notify frames to APP...")
        for p in items:
            try:
                self.app_notify_char.send_notify(p)
                time.sleep(0.02)  # iOS drops bursts if too fast
            except Exception as e:
                log(f"[HANDSHAKE] ⚠️ Replay failed: {e}")
                break
        return False

    def forward_write_to_real(self, data: bytes):
        if self.upstream:
            log(f"PI->REAL WRITE  {hx(data)}")
            self.upstream.write(data)

    # Manual tools (UI)
    def manual_send_to_board(self, payload: bytes, comment: str = ""):
        self._emit_ui("app->board", payload, kind="manual", comment=comment)
        self.forward_write_to_real(payload)

    def manual_send_to_app(self, payload: bytes, comment: str = ""):
        self._emit_ui("board->app", payload, kind="manual", comment=comment)
        GLib.idle_add(self._send_to_app, payload)


# =========================
# Vendor GATT
# =========================
class VendorService(Service):
    def __init__(self, bus, index, state: MitmState):
        super().__init__(bus, index, VENDOR_SERVICE_UUID, primary=True)
        self.state = state
        self.notify_char = VendorNotifyCharacteristic(bus, 0, self, state)
        self.write_char  = VendorWriteCharacteristic(bus, 1, self, state)
        self.add_characteristic(self.notify_char)
        self.add_characteristic(self.write_char)


class VendorNotifyCharacteristic(Characteristic):
    def __init__(self, bus, index, service, state: MitmState):
        super().__init__(bus, index, CHAR_NOTIFY_UUID, ["notify"], service)
        self.state = state
        self.notifying = False

    def StartNotify(self):
        if self.notifying:
            return
        self.notifying = True
        self.state.app_subscribed = True
        self.state.app_notify_char = self
        log("📲 APP subscribed NOTIFY")
        GLib.idle_add(self.state.flush_buffer_to_app)

    def StopNotify(self):
        if not self.notifying:
            return
        self.notifying = False
        self.state.app_subscribed = False
        log("📲 APP unsubscribed NOTIFY")

    def send_notify(self, payload: bytes):
        if not self.notifying:
            return
        self.value = bytearray(payload)
        self._props_changed_value()


class VendorWriteCharacteristic(Characteristic):
    def __init__(self, bus, index, service, state: MitmState):
        super().__init__(bus, index, CHAR_WRITE_UUID, ["write", "write-without-response"], service)
        self.state = state

    def WriteValue(self, value, options):
        data = bytes(value)
        log(f"APP->PI WRITE  {hx(data)}")
        self.state._emit_ui("app->board", data, kind="ble")
        self.state.forward_write_to_real(data)


# =========================
# Upstream (Bleak) Thread
# =========================
class Upstream:
    def __init__(self, addr: str, notify_cb):
        self.addr = addr
        self.notify_cb = notify_cb
        self.loop = None
        self.thread = None
        self.client = None
        self.stop_flag = False
        self.write_queue = None

    def start(self):
        self.thread = threading.Thread(target=self._thread_main, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_flag = True
        try:
            if self.loop:
                self.loop.call_soon_threadsafe(lambda: None)
        except Exception:
            pass

    def write(self, data: bytes):
        if not data or not self.loop or not self.write_queue:
            return

        async def _qput():
            await self.write_queue.put(bytes(data))

        asyncio.run_coroutine_threadsafe(_qput(), self.loop)

    def _thread_main(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.write_queue = asyncio.Queue()
        self.loop.run_until_complete(self._run())

    async def _find_addr_by_scan(self):
        devs = await BleakScanner.discover(timeout=6)
        for d in devs:
            if d.name and REAL_BOARD_NAME in d.name.upper():
                return d.address
        return None

    async def _run(self):
        while not self.stop_flag:
            try:
                addr = self.addr
                log(f"🔗 Connecting REAL board {addr} ...")
                self.client = BleakClient(addr)
                await asyncio.wait_for(self.client.connect(), timeout=UPSTREAM_CONNECT_TIMEOUT)
                log(f"✅ Connected REAL: {self.client.is_connected}")

                def _on_notify(_uuid, data: bytearray):
                    self.notify_cb(bytes(data))

                await self.client.start_notify(CHAR_NOTIFY_UUID, _on_notify)
                log("📡 Subscribed REAL notify")

                while not self.stop_flag and self.client.is_connected:
                    try:
                        data = await asyncio.wait_for(self.write_queue.get(), timeout=0.25)
                    except asyncio.TimeoutError:
                        continue
                    try:
                        await self.client.write_gatt_char(CHAR_WRITE_UUID, data, response=False)
                    except Exception as e:
                        log(f"❌ REAL write failed: {e}")
                        break

                try:
                    await self.client.disconnect()
                except Exception:
                    pass
                log("🔌 REAL disconnected")

            except Exception as e:
                log(f"❌ Failed to connect REAL board: {repr(e)}")
                try:
                    new_addr = await self._find_addr_by_scan()
                    if new_addr and new_addr != self.addr:
                        log(f"🔁 Updated REAL addr from scan: {self.addr} -> {new_addr}")
                        self.addr = new_addr
                except Exception:
                    pass

            for _ in range(int(UPSTREAM_RETRY_SEC * 10)):
                if self.stop_flag:
                    break
                await asyncio.sleep(0.1)


# =========================
# Register helpers
# =========================
def find_adapter(bus):
    om = dbus.Interface(bus.get_object(BLUEZ_SERVICE_NAME, "/"), DBUS_OM_IFACE)
    objs = om.GetManagedObjects()
    for path, ifaces in objs.items():
        if GATT_MANAGER_IFACE in ifaces and LE_ADV_MGR_IFACE in ifaces:
            return path
    return None


# =========================
# Web UI (Flask + SSE)
# =========================
def parse_hex_string(s: str) -> bytes:
    s = (s or "").replace(",", " ").replace("0x", "").replace("0X", "").strip()
    if not s:
        raise ValueError("empty hex")
    parts = [p for p in s.split() if p]
    try:
        return bytes(int(p, 16) for p in parts)
    except Exception:
        raise ValueError("invalid hex format (use: '01 0A FF')")

def encode_raw_ascii(raw: str) -> bytes:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("empty raw")
    if not raw.endswith("@"):
        raw = raw + "@"
    return raw.encode("ascii", errors="strict")


HTML = r"""
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>GranBoard MITM – Log & Tools</title>
  <style>
    :root{
      --bg:#0b0d10; --panel:#12161c; --text:#e8eef7; --muted:#9aa7b8;
      --stroke:#243041; --good:#36d399; --warn:#fbbf24; --bad:#f87171;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial;
    }
    body{margin:0; background:var(--bg); color:var(--text); font-family:var(--sans);}
    .wrap{display:grid; grid-template-columns: 440px 1fr; height:100vh; gap:12px; padding:12px; box-sizing:border-box;}
    @media (max-width: 1100px){ .wrap{grid-template-columns:1fr; height:auto;} .log{height:70vh;} }
    .card{background:var(--panel); border:1px solid var(--stroke); border-radius:12px; padding:12px;}
    h2{margin:0 0 8px 0; font-size:16px;}
    .row{display:flex; gap:8px; align-items:center; margin:8px 0;}
    .row label{width:140px; color:var(--muted); font-size:12px;}
    input, textarea, select, button{
      background:#0f141b; color:var(--text); border:1px solid var(--stroke);
      border-radius:10px; padding:8px 10px; font-family:var(--mono); font-size:12px;
      outline:none;
    }
    textarea{width:100%; min-height:60px; resize:vertical;}
    input[type="text"]{width:100%;}
    button{cursor:pointer; font-family:var(--sans); font-size:12px; padding:9px 12px;}
    button.primary{background:#1a2636;}
    button.good{background:rgba(54,211,153,.12); border-color:rgba(54,211,153,.35);}
    button.warn{background:rgba(251,191,36,.12); border-color:rgba(251,191,36,.35);}
    .muted{color:var(--muted); font-size:12px;}
    .log{height: calc(100vh - 24px); overflow:auto;}

    /* IMPORTANT: no ellipsis, full wrap */
    table{width:100%; border-collapse:collapse; font-family:var(--mono); font-size:12px; table-layout:fixed;}
    thead th{position:sticky; top:0; background: #0f141b; border-bottom:1px solid var(--stroke); z-index:2;}
    th, td{padding:8px 10px; border-bottom:1px solid var(--stroke); vertical-align:top;}
    td.msg{
      white-space:pre-wrap;
      overflow:visible;
      text-overflow:clip;
      word-break:break-all;
    }
    td.comment{white-space:normal;}
    .pill{display:inline-block; padding:2px 8px; border-radius:999px; font-family:var(--sans); font-size:11px; border:1px solid var(--stroke);}
    .dir-a{background:rgba(251,191,36,.10); border-color:rgba(251,191,36,.35);}
    .dir-b{background:rgba(54,211,153,.10); border-color:rgba(54,211,153,.35);}
    .kind{opacity:.8;}
    .topbar{display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:8px;}
    .filters{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
    .filters input{width:260px; font-family:var(--sans);}
    .small{font-size:11px; color:var(--muted);}
    .btns{display:flex; gap:8px; flex-wrap:wrap;}

    /* Dartboard */
    #dartboard .seg { cursor:pointer; opacity:0.9; }
    #dartboard .seg:hover { opacity:1.0; }
    #dartboard .lbl { pointer-events:none; font-family:var(--sans); font-size:12px; fill:var(--text); opacity:0.85; }
    #dartboard .ringStroke { fill:none; stroke:rgba(255,255,255,.08); stroke-width:1; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="topbar">
        <h2>Tools</h2>
        <div class="small">UI: {{ui_version}} • Port: {{port}}</div>
      </div>

      <div class="row"><label>Status</label><div class="muted" id="status">SSE: connecting…</div></div>

      <h2 style="margin-top:14px;">Send → Board (Write)</h2>
      <div class="row">
        <label>Hex bytes</label>
        <input id="hexToBoard" type="text" placeholder="z.B. 01 00 00 00 ... (20 bytes)"/>
      </div>
      <div class="row">
        <label>Kommentar</label>
        <input id="cBoard" type="text" placeholder="z.B. LED test: 1 rot"/>
      </div>
      <div class="btns">
        <button class="primary warn" onclick="sendToBoard()">Send to Board</button>
      </div>
      <div class="small">Hinweis: Leerzeichen ok. Hex ohne 0x. Beispiel: <span class="muted">01 00 ... 01</span></div>

      <h2 style="margin-top:18px;">Send → App (Fake Hit Notify)</h2>

      <div class="btns" style="margin-bottom:8px;">
        <button class="primary" onclick="sendRaw('OUT@','MISS / OUT')">OUT@ (Miss)</button>
        <button class="primary" onclick="sendRaw('BTN@','NEXT / BTN')">BTN@ (Next)</button>
      </div>

      <div class="row">
        <label>Custom</label>
        <input id="rawCustom" type="text" placeholder="z.B. 11.6@ oder OUT@"/>
      </div>
      <div class="row">
        <label>Kommentar</label>
        <input id="cApp" type="text" placeholder="z.B. simuliere T19"/>
      </div>
      <div class="btns">
        <button class="primary good" onclick="sendCustomToApp()">Send Custom</button>
      </div>

      <div class="muted" style="margin-top:10px; font-size:12px;">
        Klick auf ein Feld im Board → sendet sofort den passenden RAW Code (SO/SI/D/T + Bulls).
      </div>

      <div id="boardWrap" style="margin-top:10px; display:flex; justify-content:center;">
        <svg id="dartboard" width="380" height="380" viewBox="-190 -190 380 380"
             style="border:1px solid var(--stroke); border-radius:12px; background:#0f141b;">
        </svg>
      </div>

      <h2 style="margin-top:18px;">Log</h2>
      <div class="filters">
        <input id="filter" placeholder="Filter (z.B. 11.6@ oder 01 00)" oninput="applyFilter()"/>
        <button onclick="clearLog()">Clear UI</button>
        <button onclick="reload()">Reload</button>
      </div>
      <div class="small">Kommentare: in der Tabelle bearbeiten, Enter speichert. (Persistiert in {{logfile}})</div>
    </div>

    <div class="card log">
      <table>
        <thead>
          <tr>
            <th style="width:74px;">Time</th>
            <th style="width:110px;">Dir</th>
            <th style="width:60px;">Kind</th>
            <th style="width:240px;">Msg (ASCII)</th>
            <th>Msg (HEX)</th>
            <th style="width:340px;">Kommentar</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>

<script>
  const tbody = document.getElementById('tbody');
  const statusEl = document.getElementById('status');
  let allRows = [];

  function esc(s){ return (s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

  function addRow(entry, toTop=false){
    allRows.push(entry);
    const tr = document.createElement('tr');
    tr.dataset.id = entry.id;
    tr.dataset.search = (entry.t+" "+entry.dir+" "+entry.kind+" "+(entry.ascii||"")+" "+(entry.hex||"")+" "+(entry.comment||"")).toLowerCase();

    const dirPill = entry.dir === "app->board"
      ? `<span class="pill dir-a">APP → BOARD</span>`
      : `<span class="pill dir-b">BOARD → APP</span>`;

    tr.innerHTML = `
      <td>${esc(entry.t)}</td>
      <td>${dirPill}</td>
      <td class="kind">${esc(entry.kind||"")}</td>
      <td class="msg">${esc(entry.ascii||"")}</td>
      <td class="msg">${esc(entry.hex||"")}</td>
      <td class="comment">
        <input type="text" value="${esc(entry.comment||"")}" style="width:100%; font-family: var(--sans);"
               onkeydown="if(event.key==='Enter'){ saveComment('${entry.id}', this.value); }"/>
      </td>
    `;

    if (toTop && tbody.firstChild) tbody.insertBefore(tr, tbody.firstChild);
    else tbody.appendChild(tr);
  }

  function applyFilter(){
    const f = (document.getElementById('filter').value||"").toLowerCase().trim();
    for (const tr of tbody.querySelectorAll('tr')){
      if(!f){ tr.style.display=""; continue; }
      tr.style.display = tr.dataset.search.includes(f) ? "" : "none";
    }
  }

  async function saveComment(id, comment){
    await fetch('/api/comment', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id, comment})
    });
  }

  async function sendToBoard(){
    const hex = document.getElementById('hexToBoard').value.trim();
    const comment = document.getElementById('cBoard').value.trim();
    const res = await fetch('/api/send_to_board', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({hex, comment})
    });
    const j = await res.json();
    if(!j.ok) alert("Error: " + j.error);
  }

  async function sendRaw(raw, comment){
    const res = await fetch('/api/send_to_app', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({raw, comment: (comment||"")})
    });
    const j = await res.json();
    if(!j.ok) alert("Error: " + j.error);
  }

  async function sendCustomToApp(){
    const raw = (document.getElementById('rawCustom').value || "").trim();
    const comment = (document.getElementById('cApp').value || "").trim();
    if(!raw){ alert("Custom RAW leer"); return; }
    await sendRaw(raw, comment);
  }

  function clearLog(){
    tbody.innerHTML = "";
    allRows = [];
  }

  async function reload(){
    clearLog();
    const res = await fetch('/api/log?limit=800');
    const j = await res.json();
    for (const e of j.items) addRow(e);
    applyFilter();
  }

  // ========== TARGET -> RAW map (aus deiner RAW_TO_TARGET Liste) ==========
  const TARGET_TO_RAW = new Map([
    ["SO1","2.5@"], ["SI1","2.3@"], ["D1","2.6@"], ["T1","2.4@"],
    ["SO2","9.2@"], ["SI2","9.1@"], ["D2","8.2@"], ["T2","9.0@"],
    ["SO3","7.2@"], ["SI3","7.1@"], ["D3","8.4@"], ["T3","7.0@"],
    ["SO4","0.5@"], ["SI4","0.1@"], ["D4","0.6@"], ["T4","0.3@"],
    ["SO5","5.4@"], ["SI5","5.1@"], ["D5","4.6@"], ["T5","5.2@"],
    ["SO6","1.3@"], ["SI6","1.0@"], ["D6","4.4@"], ["T6","1.1@"],
    ["SO7","11.4@"], ["SI7","11.1@"], ["D7","8.6@"], ["T7","11.2@"],
    ["SO8","6.5@"], ["SI8","6.2@"], ["D8","6.6@"], ["T8","6.4@"],
    ["SO9","9.5@"], ["SI9","9.3@"], ["D9","9.6@"], ["T9","9.4@"],
    ["SO10","2.2@"], ["SI10","2.0@"], ["D10","4.3@"], ["T10","2.1@"],
    ["SO11","7.5@"], ["SI11","7.3@"], ["D11","7.6@"], ["T11","7.4@"],
    ["SO12","5.5@"], ["SI12","5.0@"], ["D12","5.6@"], ["T12","5.3@"],
    ["SO13","0.4@"], ["SI13","0.0@"], ["D13","4.5@"], ["T13","0.2@"],
    ["SO14","10.5@"], ["SI14","10.3@"], ["D14","10.6@"], ["T14","10.4@"],
    ["SO15","3.2@"], ["SI15","3.0@"], ["D15","4.2@"], ["T15","3.1@"],
    ["SO16","11.5@"], ["SI16","11.0@"], ["D16","11.6@"], ["T16","11.3@"],
    ["SO17","10.2@"], ["SI17","10.1@"], ["D17","8.3@"], ["T17","10.0@"],
    ["SO18","1.5@"], ["SI18","1.2@"], ["D18","1.6@"], ["T18","1.4@"],
    ["SO19","6.3@"], ["SI19","6.1@"], ["D19","8.5@"], ["T19","6.0@"],
    ["SO20","3.5@"], ["SI20","3.3@"], ["D20","3.6@"], ["T20","3.4@"],
    ["SBULL25","8.0@"],
    ["DBULL50","4.0@"],
  ]);

  // Dartboard Reihenfolge (Standard)
  const BOARD_ORDER = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

  // Radien für Click-Zonen (UI-Approx)
  const R = {
    outer: 175,
    d_out: 175,
    d_in: 160,
    so_in: 150,
    t_out: 115,
    t_in: 100,
    si_in: 55,
    bull_out: 42,
    dbull_out: 18
  };

  function polar(r, a){ return [r * Math.cos(a), r * Math.sin(a)]; }

  function arcPath(r1, r2, a1, a2){
    const [x1,y1] = polar(r1,a1);
    const [x2,y2] = polar(r1,a2);
    const [x3,y3] = polar(r2,a2);
    const [x4,y4] = polar(r2,a1);
    const large = (a2-a1) > Math.PI ? 1 : 0;
    return [
      `M ${x1} ${y1}`,
      `A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${r2} ${r2} 0 ${large} 0 ${x4} ${y4}`,
      `Z`
    ].join(" ");
  }

  function addSeg(svg, d, raw, label, fill){
    if(!raw) return;
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d", d);
    p.setAttribute("class","seg");
    p.setAttribute("fill", fill || "rgba(255,255,255,0.06)");
    p.setAttribute("stroke", "rgba(255,255,255,0.08)");
    p.setAttribute("stroke-width","1");
    p.addEventListener("click", async () => {
      const c = (document.getElementById('cApp').value || "").trim();
      await sendRaw(raw, `${label}${c ? " | "+c : ""}`);
    });
    svg.appendChild(p);
  }

  function addText(svg, x, y, t){
    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", x); tx.setAttribute("y", y);
    tx.setAttribute("text-anchor","middle");
    tx.setAttribute("dominant-baseline","middle");
    tx.setAttribute("class","lbl");
    tx.textContent = t;
    svg.appendChild(tx);
  }

  function buildBoard(){
    const svg = document.getElementById("dartboard");
    svg.innerHTML = "";

    // Rings
    for(const rr of [R.outer, R.d_in, R.t_out, R.t_in, R.si_in, R.bull_out, R.dbull_out]){
      const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
      c.setAttribute("cx","0"); c.setAttribute("cy","0"); c.setAttribute("r", rr);
      c.setAttribute("class","ringStroke");
      svg.appendChild(c);
    }

    const step = (2*Math.PI)/20;
    const start = -Math.PI/2; // oben

    for(let i=0;i<20;i++){
      const n = BOARD_ORDER[i];
      const a1 = start + i*step;
      const a2 = start + (i+1)*step;

      // Double ring
      addSeg(svg, arcPath(R.d_out, R.d_in, a1, a2), TARGET_TO_RAW.get(`D${n}`), `D${n}`, "rgba(248,113,113,0.08)");
      // Single Outer
      addSeg(svg, arcPath(R.d_in, R.so_in, a1, a2), TARGET_TO_RAW.get(`SO${n}`), `SO${n}`, "rgba(255,255,255,0.06)");
      // Triple ring
      addSeg(svg, arcPath(R.t_out, R.t_in, a1, a2), TARGET_TO_RAW.get(`T${n}`), `T${n}`, "rgba(251,191,36,0.08)");
      // Single Inner
      addSeg(svg, arcPath(R.t_in, R.si_in, a1, a2), TARGET_TO_RAW.get(`SI${n}`), `SI${n}`, "rgba(255,255,255,0.05)");

      // Zahlen außen
      const mid = (a1+a2)/2;
      const [lx,ly] = polar(165, mid);
      addText(svg, lx, ly, String(n));
    }

    // SBULL
    const sb = document.createElementNS("http://www.w3.org/2000/svg","circle");
    sb.setAttribute("cx","0"); sb.setAttribute("cy","0"); sb.setAttribute("r", R.bull_out);
    sb.setAttribute("class","seg");
    sb.setAttribute("fill","rgba(54,211,153,0.10)");
    sb.setAttribute("stroke","rgba(54,211,153,0.25)");
    sb.addEventListener("click", async ()=>{
      const c = (document.getElementById('cApp').value || "").trim();
      await sendRaw(TARGET_TO_RAW.get("SBULL25"), `SBULL25${c ? " | "+c : ""}`);
    });
    svg.appendChild(sb);

    // DBULL
    const db = document.createElementNS("http://www.w3.org/2000/svg","circle");
    db.setAttribute("cx","0"); db.setAttribute("cy","0"); db.setAttribute("r", R.dbull_out);
    db.setAttribute("class","seg");
    db.setAttribute("fill","rgba(248,113,113,0.15)");
    db.setAttribute("stroke","rgba(248,113,113,0.35)");
    db.addEventListener("click", async ()=>{
      const c = (document.getElementById('cApp').value || "").trim();
      await sendRaw(TARGET_TO_RAW.get("DBULL50"), `DBULL50${c ? " | "+c : ""}`);
    });
    svg.appendChild(db);

    addText(svg, 0, -58, "SBULL");
    addText(svg, 0, 0, "DBULL");
  }

  buildBoard();

  // SSE
  const es = new EventSource('/api/events');
  es.onopen = () => { statusEl.textContent = "SSE: connected"; };
  es.onerror = () => { statusEl.textContent = "SSE: disconnected (retrying…)"; };
  es.onmessage = (ev) => {
    try{
      const data = JSON.parse(ev.data);
      if(data.type === "log"){
        addRow(data.entry, false);
        applyFilter();
        const logDiv = document.querySelector('.log');
        const nearBottom = (logDiv.scrollHeight - logDiv.scrollTop - logDiv.clientHeight) < 80;
        if(nearBottom) logDiv.scrollTop = logDiv.scrollHeight;
      }
    }catch(e){}
  };

  reload();
</script>
</body>
</html>
"""


def start_web(state: MitmState):
    app = Flask(__name__)

    # No-cache headers so UI changes always show up
    @app.after_request
    def add_no_cache_headers(resp):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    @app.get("/")
    def index():
        return render_template_string(
            HTML,
            port=WEB_PORT,
            ui_version=UI_VERSION,
            logfile=LOG_DB_PATH
        )

    @app.get("/api/log")
    def api_log():
        try:
            limit = int(request.args.get("limit", "800"))
        except Exception:
            limit = 800
        return jsonify({"ok": True, "items": state.logstore.list(limit=limit)})

    @app.post("/api/comment")
    def api_comment():
        data = request.get_json(force=True, silent=True) or {}
        entry_id = data.get("id", "")
        comment = data.get("comment", "")
        ok = state.logstore.set_comment(entry_id, comment)
        return jsonify({"ok": ok})

    @app.post("/api/send_to_board")
    def api_send_to_board():
        data = request.get_json(force=True, silent=True) or {}
        hex_str = data.get("hex", "")
        comment = data.get("comment", "")
        try:
            payload = parse_hex_string(hex_str)
            state.manual_send_to_board(payload, comment=comment)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    @app.post("/api/send_to_app")
    def api_send_to_app():
        data = request.get_json(force=True, silent=True) or {}
        raw = data.get("raw", "")
        comment = data.get("comment", "")
        try:
            payload = encode_raw_ascii(raw)
            state.manual_send_to_app(payload, comment=comment)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    @app.get("/api/events")
    def sse_events():
        q = state.hub.subscribe()

        def gen():
            try:
                yield "data: " + json.dumps({"type":"hello","ui":UI_VERSION}) + "\n\n"
                while True:
                    ev = q.get()
                    yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
            finally:
                state.hub.unsubscribe(q)

        return Response(gen(), mimetype="text/event-stream")

    # Flask thread
    def _run():
        log(f"🌐 Web UI: http://{WEB_HOST}:{WEB_PORT}  (UI={UI_VERSION})")
        app.run(host=WEB_HOST, port=WEB_PORT, debug=False, use_reloader=False, threaded=True)

    threading.Thread(target=_run, daemon=True).start()


# =========================
# MAIN
# =========================
def main():
    ensure_data_dir()

    if AUTO_BT_RESET_ON_START:
        log("🔄 Auto Bluetooth reset (start)")
        bluetooth_reset_start()

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    adapter_path = find_adapter(bus)
    if not adapter_path:
        log("❌ No BLE adapter with GATT+LEAdvertisingManager found.")
        sys.exit(1)

    log(f"✅ Using adapter: {adapter_path}")

    logstore = LogStore(LOG_DB_PATH)
    hub = EventHub()
    state = MitmState(logstore, hub)

    # Start web UI
    start_web(state)

    # Build GATT app
    app = Application(bus)
    app.add_service(VendorService(bus, 0, state))

    # Advertisement
    adv = Advertisement(bus, 0)

    gatt_mgr = dbus.Interface(bus.get_object(BLUEZ_SERVICE_NAME, adapter_path), GATT_MANAGER_IFACE)
    adv_mgr  = dbus.Interface(bus.get_object(BLUEZ_SERVICE_NAME, adapter_path), LE_ADV_MGR_IFACE)

    log("🧩 Registering GATT application...")
    gatt_mgr.RegisterApplication(
        app.get_path(), {},
        reply_handler=lambda: log("✅ GATT registered."),
        error_handler=lambda e: log(f"❌ GATT register error: {e}")
    )

    log(f"📢 Registering Advertisement ({PROXY_LOCAL_NAME})...")
    adv_mgr.RegisterAdvertisement(
        adv.get_path(), {},
        reply_handler=lambda: log("✅ Advertisement registered."),
        error_handler=lambda e: log(f"❌ Adv register error: {e}")
    )

    log(f"✅ MITM READY: open GranBoard app and scan/connect to: {PROXY_LOCAL_NAME}")
    log("   - UI log shows only APP↔BOARD frames (no proxy chatter).")

    # Start upstream
    state.upstream = Upstream(REAL_BOARD_ADDR, notify_cb=state.on_real_notify)
    state.upstream.start()

    mainloop = GLib.MainLoop()
    try:
        mainloop.run()
    except KeyboardInterrupt:
        log("🛑 Stopping...")
    finally:
        try:
            state.upstream.stop()
        except Exception:
            pass

        try:
            adv_mgr.UnregisterAdvertisement(adv.get_path())
        except Exception:
            pass
        try:
            gatt_mgr.UnregisterApplication(app.get_path())
        except Exception:
            pass

        if AUTO_BT_RESET_ON_EXIT:
            log("🔄 Auto Bluetooth reset (exit)")
            bluetooth_reset_exit()


if __name__ == "__main__":
    main()