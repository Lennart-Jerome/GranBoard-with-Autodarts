// ==UserScript==
// @name         GranBoard-with-Autodarts
// @updateURL    https://raw.githubusercontent.com/Lennart-Jerome/GranBoard-with-Autodarts/main/GranBoard-with-Autodarts.user.js
// @downloadURL  https://raw.githubusercontent.com/Lennart-Jerome/GranBoard-with-Autodarts/main/GranBoard-with-Autodarts.user.js
// @namespace    local.granboard.autodarts.combo
// @version      3.0.5
// @description  GranBoard BLE -> Autodarts. Keyboard authoritative when numbers exist; board fallback only when keypad has no numbers. Auto-switches AD to board/scheibe when needed. UI: Status colored/bold, shows Mode only (Boardview/Keyboardview + (Auto)). BTN@ => NEXT. Floating GB button bottom-right (no sidebar injection). Optional LED flash on NEXT (0D.. then 0F..).
// @match        *://play.autodarts.io/*
// @match        *://*.autodarts.io/*
// @all-frames   true
// @run-at       document-end
// @inject-into  content
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  if (window.__GB_AD_COMBO_V304_INIT__) return;
  window.__GB_AD_COMBO_V304_INIT__ = true;

  /********************************************************************
   * Storage / Settings
   ********************************************************************/
  const STORAGE = {
    DEBUG: "gb_debug_enabled",
    OVERLAY: "gb_overlay_visible",
    LAST_DEVICE_NAME: "gb_last_device_name",
    INPUT_MODE: "gb_input_mode_v300",      // "auto" | "keyboard" | "board"
    LED_NEXT: "gb_led_next_flash_enabled"  // "1" | "0"
  };

  const SETTINGS = {
    debug: localStorage.getItem(STORAGE.DEBUG) !== "0",
    overlay: localStorage.getItem(STORAGE.OVERLAY) !== "0",
    inputMode: (localStorage.getItem(STORAGE.INPUT_MODE) || "auto"),
    ledNext: localStorage.getItem(STORAGE.LED_NEXT) === "1"
  };

  function saveBool(key, val) { try { localStorage.setItem(key, val ? "1" : "0"); } catch {} }
  function saveStr(key, val) { try { localStorage.setItem(key, String(val ?? "")); } catch {} }
  function saveLastDeviceName(name) { try { localStorage.setItem(STORAGE.LAST_DEVICE_NAME, name || ""); } catch {} }
  function getLastDeviceName() { try { return (localStorage.getItem(STORAGE.LAST_DEVICE_NAME) || "").trim(); } catch { return ""; } }

  /********************************************************************
   * Config
   ********************************************************************/
  const CONFIG = {
    VENDOR_SERVICE: "442f1570-8a00-9a28-cbe1-e1d4212d53eb",
    extraOptionalServices: [
      "0000180f-0000-1000-8000-00805f9b34fb",
      "0000180a-0000-1000-8000-00805f9b34fb"
    ],
    labels: {
      double: "Double",
      triple: "Triple",
      miss: "Miss",
      bull25: "25",
      bull: "Bull",
      next: "Next"
    },
    waitAfterModifierMs: 200,
    minMsBetweenThrows: 250,
    hotkeys: {
      overlay: { ctrl: true, shift: true, code: "KeyO" },
      debug: { ctrl: true, shift: true, code: "KeyD" }
    },
    CONNECT_PREFIX: "GB8;102",
    namePrefix: "GRAN"
  };

  /********************************************************************
   * RAW -> Target mapping
   ********************************************************************/
  const RAW_TO_TARGET = new Map([
    ["2.5@", { ring: "SO", n: 1 }], ["2.3@", { ring: "SI", n: 1 }], ["2.6@", { ring: "D", n: 1 }], ["2.4@", { ring: "T", n: 1 }],
    ["9.2@", { ring: "SO", n: 2 }], ["9.1@", { ring: "SI", n: 2 }], ["8.2@", { ring: "D", n: 2 }], ["9.0@", { ring: "T", n: 2 }],
    ["7.2@", { ring: "SO", n: 3 }], ["7.1@", { ring: "SI", n: 3 }], ["8.4@", { ring: "D", n: 3 }], ["7.0@", { ring: "T", n: 3 }],
    ["0.5@", { ring: "SO", n: 4 }], ["0.1@", { ring: "SI", n: 4 }], ["0.6@", { ring: "D", n: 4 }], ["0.3@", { ring: "T", n: 4 }],
    ["5.4@", { ring: "SO", n: 5 }], ["5.1@", { ring: "SI", n: 5 }], ["4.6@", { ring: "D", n: 5 }], ["5.2@", { ring: "T", n: 5 }],
    ["1.3@", { ring: "SO", n: 6 }], ["1.0@", { ring: "SI", n: 6 }], ["4.4@", { ring: "D", n: 6 }], ["1.1@", { ring: "T", n: 6 }],
    ["11.4@", { ring: "SO", n: 7 }], ["11.1@", { ring: "SI", n: 7 }], ["8.6@", { ring: "D", n: 7 }], ["11.2@", { ring: "T", n: 7 }],
    ["6.5@", { ring: "SO", n: 8 }], ["6.2@", { ring: "SI", n: 8 }], ["6.6@", { ring: "D", n: 8 }], ["6.4@", { ring: "T", n: 8 }],
    ["9.5@", { ring: "SO", n: 9 }], ["9.3@", { ring: "SI", n: 9 }], ["9.6@", { ring: "D", n: 9 }], ["9.4@", { ring: "T", n: 9 }],
    ["2.2@", { ring: "SO", n: 10 }], ["2.0@", { ring: "SI", n: 10 }], ["4.3@", { ring: "D", n: 10 }], ["2.1@", { ring: "T", n: 10 }],
    ["7.5@", { ring: "SO", n: 11 }], ["7.3@", { ring: "SI", n: 11 }], ["7.6@", { ring: "D", n: 11 }], ["7.4@", { ring: "T", n: 11 }],
    ["5.5@", { ring: "SO", n: 12 }], ["5.0@", { ring: "SI", n: 12 }], ["5.6@", { ring: "D", n: 12 }], ["5.3@", { ring: "T", n: 12 }],
    ["0.4@", { ring: "SO", n: 13 }], ["0.0@", { ring: "SI", n: 13 }], ["4.5@", { ring: "D", n: 13 }], ["0.2@", { ring: "T", n: 13 }],
    ["10.5@", { ring: "SO", n: 14 }], ["10.3@", { ring: "SI", n: 14 }], ["10.6@", { ring: "D", n: 14 }], ["10.4@", { ring: "T", n: 14 }],
    ["3.2@", { ring: "SO", n: 15 }], ["3.0@", { ring: "SI", n: 15 }], ["4.2@", { ring: "D", n: 15 }], ["3.1@", { ring: "T", n: 15 }],
    ["11.5@", { ring: "SO", n: 16 }], ["11.0@", { ring: "SI", n: 16 }], ["11.6@", { ring: "D", n: 16 }], ["11.3@", { ring: "T", n: 16 }],
    ["10.2@", { ring: "SO", n: 17 }], ["10.1@", { ring: "SI", n: 17 }], ["8.3@", { ring: "D", n: 17 }], ["10.0@", { ring: "T", n: 17 }],
    ["1.5@", { ring: "SO", n: 18 }], ["1.2@", { ring: "SI", n: 18 }], ["1.6@", { ring: "D", n: 18 }], ["1.4@", { ring: "T", n: 18 }],
    ["6.3@", { ring: "SO", n: 19 }], ["6.1@", { ring: "SI", n: 19 }], ["8.5@", { ring: "D", n: 19 }], ["6.0@", { ring: "T", n: 19 }],
    ["3.5@", { ring: "SO", n: 20 }], ["3.3@", { ring: "SI", n: 20 }], ["3.6@", { ring: "D", n: 20 }], ["3.4@", { ring: "T", n: 20 }],
    ["OUT@", { ring: "OUT", n: 0 }],
    ["8.0@", { ring: "SBULL", n: 25 }],
    ["4.0@", { ring: "DBULL", n: 50 }]
  ]);

  /********************************************************************
   * Helpers
   ********************************************************************/
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();

  function isClickableButton(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    const aria = btn.getAttribute("aria-disabled");
    if (aria && aria.toLowerCase() === "true") return false;
    const style = getComputedStyle(btn);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
    return true;
  }

  function findBtnExact(label) {
    const wanted = norm(label);
    return Array.from(document.querySelectorAll("button")).find(b => norm(b.textContent) === wanted) || null;
  }
  function findBtnContains(labelPart) {
    const wanted = norm(labelPart);
    return Array.from(document.querySelectorAll("button")).find(b => norm(b.textContent).includes(wanted)) || null;
  }
  function findNextButton() {
    return findBtnExact(CONFIG.labels.next) || findBtnContains("NEXT");
  }

  function normalizeActionFromButtonText(t) {
    const u = norm(t);
    if (!u) return null;

    if (u === "MISS") return "MISS";
    if (u === "UNDO") return null;
    if (u === "NEXT") return "NEXT";
    if (u === "DOUBLE") return "DOUBLE_MOD";
    if (u === "TRIPLE") return "TRIPLE_MOD";
    if (u === "BULL") return "BULL";
    if (u === "25") return "25";
    if (u === "HIT") return "HIT";

    const m = u.match(/^([SDT])\s*(\d{1,2})$/);
    if (m) {
      const n = parseInt(m[2], 10);
      if (n >= 0 && n <= 20) return m[1] + String(n);
    }
    return null;
  }

  function getAllowedActions() {
    const allowed = new Set();
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const b of buttons) {
      if (!isClickableButton(b)) continue;
      const a = normalizeActionFromButtonText(b.textContent || "");
      if (a) allowed.add(a);
    }
    return allowed;
  }

  function allowedHasAnyNumbers(allowed) {
    for (const a of allowed) {
      if (/^[SDT]\d{1,2}$/.test(a)) return true;
      if (a === "25" || a === "BULL") return true;
    }
    return false;
  }

  function shouldUseBoardFallbackInAuto(allowed) {
    return !allowedHasAnyNumbers(allowed);
  }

  function formatModeLabel(resolvedMode) {
    const view = resolvedMode === "board" ? "Boardview" : "Keyboardview";
    const suffix = SETTINGS.inputMode === "auto" ? " (Auto)" : "";
    return `${view}${suffix}`;
  }

  /********************************************************************
   * UI
   ********************************************************************/
  function createUI() {
    try { document.getElementById("__gb_ad_overlay__")?.remove(); } catch {}
    try { document.getElementById("__gb_ad_tab__")?.remove(); } catch {}

    const root = document.createElement("div");
    root.id = "__gb_ad_overlay__";
    root.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "background:rgba(8,10,14,.30);backdrop-filter: blur(7px);-webkit-backdrop-filter: blur(7px);" +
      "color:#fff;padding:10px 12px;border-radius:12px;" +
      "font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "width:420px;max-width:calc(100vw - 24px);" +
      "box-shadow:0 8px 30px rgba(0,0,0,.25);" +
      "border:1px solid rgba(255,255,255,.14);";

    // Floating tab bottom-right (like before)
    const tab = document.createElement("button");
    tab.id = "__gb_ad_tab__";
    tab.textContent = "GB";
    tab.title = "GranBoard overlay (Ctrl+Shift+O)";
    tab.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "padding:10px 12px;border-radius:999px;" +
      "border:2px solid rgba(255,80,80,.95);" +
      "background:rgba(8,10,14,.35);backdrop-filter: blur(7px);-webkit-backdrop-filter: blur(7px);" +
      "color:#fff;cursor:pointer;font:12px system-ui;display:none;" +
      "box-shadow:0 0 14px rgba(255,80,80,.35);";

    root.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">' +
        '<div style="font-weight:800;font-size:14px;">GranBoard → Autodarts</div>' +
        '<button id="gb-hide" title="Hide overlay" style="padding:4px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.10);color:#fff;cursor:pointer;">Hide</button>' +
      "</div>" +

      '<div style="margin-top:10px;opacity:.92;font-size:11px;">' +
        '<div>Status: <span id="gb-status" style="font-weight:900;">disconnected</span></div>' +
        '<div>Device: <span id="gb-device">—</span></div>' +
        '<div>Mode: <span id="gb-mode">—</span></div>' +
        '<div>RAW: <span id="gb-raw">—</span></div>' +
        '<div>Action: <span id="gb-action">—</span></div>' +
      "</div>" +

      '<div style="margin-top:12px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">' +
        '<button id="gb-connect-toggle" style="' +
          'padding:8px 14px;border-radius:14px;border:2px solid rgba(60,180,110,.50);' +
          'cursor:pointer;background:rgba(60,180,110,.22);color:#fff;font-weight:800;' +
          'font-size:13px;line-height:1.2;display:inline-block;' +
        '">Connect</button>' +

        '<select id="gb-input-select" title="Input mode" style="' +
          'padding:8px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.18);' +
          'background:rgba(0,0,0,.25);color:#fff;cursor:pointer;font-weight:700;' +
        '">' +
          '<option value="auto">Auto</option>' +
          '<option value="keyboard">Keyboard</option>' +
          '<option value="board">Board</option>' +
        '</select>' +
      "</div>" +

      '<div style="margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">' +
        '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none;">' +
          '<input type="checkbox" id="gb-debug-toggle" /> <span>Debug</span>' +
        "</label>" +
        '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none;">' +
          '<input type="checkbox" id="gb-led-toggle" /> <span>LED on Next</span>' +
        "</label>" +
      "</div>" +

      '<div id="gb-log-wrap" style="margin-top:12px;max-height:200px;overflow:auto;font-size:11px;opacity:.92;display:none;">' +
        '<div style="font-weight:700;margin-bottom:6px;">Log</div>' +
        '<div id="gb-log"></div>' +
      "</div>";

    document.documentElement.appendChild(root);
    document.documentElement.appendChild(tab);

    const $ = (sel) => root.querySelector(sel);
    const logEl = $("#gb-log");

    return {
      root,
      tab,
      hideBtn: $("#gb-hide"),
      debugToggle: $("#gb-debug-toggle"),
      ledToggle: $("#gb-led-toggle"),
      logWrap: $("#gb-log-wrap"),
      connectToggleBtn: $("#gb-connect-toggle"),
      inputSelect: $("#gb-input-select"),
      status: $("#gb-status"),
      device: $("#gb-device"),
      mode: $("#gb-mode"),
      raw: $("#gb-raw"),
      action: $("#gb-action"),
      log: (msg) => {
        if (!SETTINGS.debug) return;
        const line = document.createElement("div");
        line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
        logEl.prepend(line);
      }
    };
  }

  let ui = createUI();

  let connected = false;
  function paintStatus() {
    if (!ui?.status) return;
    ui.status.style.fontWeight = "900";
    if (connected) {
      ui.status.style.color = "rgba(60,220,120,.98)";
      ui.status.textContent = "connected";
    } else {
      ui.status.style.color = "rgba(255,80,80,.98)";
      ui.status.textContent = "disconnected";
    }
  }

  function setOverlayVisible(v) {
    SETTINGS.overlay = !!v;
    saveBool(STORAGE.OVERLAY, SETTINGS.overlay);
    ui.root.style.display = SETTINGS.overlay ? "block" : "none";
    ui.tab.style.display = SETTINGS.overlay ? "none" : "block";
  }

  function applyDebugUI() {
    ui.debugToggle.checked = SETTINGS.debug;
    ui.logWrap.style.display = SETTINGS.debug ? "block" : "none";
  }

  function applyLedUI() {
    ui.ledToggle.checked = SETTINGS.ledNext;
  }

  function applyInputModeUI() {
    ui.inputSelect.value = SETTINGS.inputMode;
  }

  setOverlayVisible(SETTINGS.overlay);
  applyDebugUI();
  applyLedUI();
  applyInputModeUI();
  paintStatus();

  ui.hideBtn.addEventListener("click", () => setOverlayVisible(false));
  ui.tab.addEventListener("click", () => setOverlayVisible(true));

  ui.debugToggle.addEventListener("change", () => {
    SETTINGS.debug = !!ui.debugToggle.checked;
    saveBool(STORAGE.DEBUG, SETTINGS.debug);
    applyDebugUI();
    ui.log("Debug " + (SETTINGS.debug ? "enabled" : "disabled"));
  });

  ui.ledToggle.addEventListener("change", () => {
    SETTINGS.ledNext = !!ui.ledToggle.checked;
    saveBool(STORAGE.LED_NEXT, SETTINGS.ledNext);
    ui.log("LED on Next " + (SETTINGS.ledNext ? "enabled" : "disabled"));
  });

  ui.inputSelect.addEventListener("change", () => {
    SETTINGS.inputMode = ui.inputSelect.value || "auto";
    saveStr(STORAGE.INPUT_MODE, SETTINGS.inputMode);
    applyInputModeUI();
    ui.log("Input mode set to: " + SETTINGS.inputMode);
  });

  document.addEventListener("keydown", (e) => {
    const match = (hk) => (!!hk.ctrl === e.ctrlKey) && (!!hk.shift === e.shiftKey) && (hk.code === e.code);
    if (match(CONFIG.hotkeys.overlay)) {
      e.preventDefault();
      setOverlayVisible(!SETTINGS.overlay);
    }
    if (match(CONFIG.hotkeys.debug)) {
      e.preventDefault();
      SETTINGS.debug = !SETTINGS.debug;
      saveBool(STORAGE.DEBUG, SETTINGS.debug);
      applyDebugUI();
      ui.log("Debug " + (SETTINGS.debug ? "enabled" : "disabled"));
    }
  }, true);

  /********************************************************************
   * BLE: notify + LED write characteristic
   ********************************************************************/
  let device = null;
  let server = null;
  let notifyChar = null;
  let ledChar = null;
  let streamBuffer = new Uint8Array(0);

  function setTabBorder() {
    const color = connected ? "rgba(60,220,120,.95)" : "rgba(255,80,80,.95)";
    ui.tab.style.borderColor = color;
    ui.tab.style.boxShadow = connected
      ? "0 0 14px rgba(60,220,120,.35)"
      : "0 0 14px rgba(255,80,80,.35)";
  }

  function setConnectedState(isConnected) {
    connected = !!isConnected;

    const idleLabel = getLastDeviceName() ? "Reconnect" : "Connect";
    ui.connectToggleBtn.textContent = connected ? "Disconnect" : idleLabel;

    ui.connectToggleBtn.style.background = connected ? "rgba(255,90,90,.20)" : "rgba(60,180,110,.22)";
    ui.connectToggleBtn.style.borderColor = connected ? "rgba(255,90,90,.50)" : "rgba(60,180,110,.50)";

    paintStatus();
    setTabBorder();
  }

  function appendToBuffer(u8) {
    const merged = new Uint8Array(streamBuffer.length + u8.length);
    merged.set(streamBuffer, 0);
    merged.set(u8, streamBuffer.length);
    streamBuffer = merged;
  }

  function extractFrames() {
    const frames = [];
    while (true) {
      const idx = streamBuffer.indexOf(0x40); // '@'
      if (idx === -1) break;
      frames.push(streamBuffer.slice(0, idx + 1));
      streamBuffer = streamBuffer.slice(idx + 1);
    }
    return frames;
  }

  function bytesToAsciiVisible(u8) {
    return [...u8].map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".").join("");
  }

  // --- LED helpers ---
  function hexToU8(hex) {
    const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  async function ledWrite(bytes) {
    if (!ledChar) return false;
    try {
      if (ledChar.properties.writeWithoutResponse) {
        await ledChar.writeValueWithoutResponse(bytes);
      } else {
        await ledChar.writeValue(bytes);
      }
      return true;
    } catch (e) {
      ui?.log?.("LED write failed: " + (e?.message || e));
      return false;
    }
  }

  let __ledNextFlashBusy = false;
  async function flashLedOnNext() {
    if (!SETTINGS.ledNext) return;
    if (__ledNextFlashBusy) return;
    if (!ledChar) return;

    __ledNextFlashBusy = true;
    try {
      // 0D 00 00 00 for 1.5s then 01 00 00 00
      await ledWrite(hexToU8("0D 00 00 00"));
      await sleep(1500);
      await ledWrite(hexToU8("01 00 00 00"));
    } finally {
      __ledNextFlashBusy = false;
    }
  }

  /********************************************************************
   * Keyboard / Buttons injection
   ********************************************************************/
  async function clickMiss() { findBtnExact(CONFIG.labels.miss)?.click(); }
  async function click25() { findBtnExact(CONFIG.labels.bull25)?.click(); }

  async function clickBull50OrFallback() {
    const bullBtn = findBtnExact(CONFIG.labels.bull);
    if (isClickableButton(bullBtn)) { bullBtn.click(); return true; }
    const mod = findBtnExact(CONFIG.labels.double);
    if (isClickableButton(mod)) {
      mod.click();
      await sleep(CONFIG.waitAfterModifierMs);
      await click25();
      return true;
    }
    return false;
  }

  async function clickWithModifier(kind, n) {
    const modLabel = (kind === "D") ? CONFIG.labels.double : CONFIG.labels.triple;
    const modBtn = findBtnExact(modLabel);
    if (!isClickableButton(modBtn)) return false;

    modBtn.click();
    await sleep(CONFIG.waitAfterModifierMs);

    const btn = findBtnExact(kind + n);
    if (isClickableButton(btn)) { btn.click(); return true; }
    return false;
  }

  async function clickAction(action) {
    if (action === "NEXT") {
      findNextButton()?.click();
      // fire-and-forget LED
      flashLedOnNext();
      return true;
    }
    if (action === "MISS") { await clickMiss(); return true; }
    if (action === "25") { await click25(); return true; }
    if (action === "BULL") { return await clickBull50OrFallback(); }
    if (action === "HIT") {
      const b = findBtnExact("Hit") || findBtnExact("HIT");
      if (isClickableButton(b)) { b.click(); return true; }
    }

    const direct = findBtnExact(action);
    if (isClickableButton(direct)) { direct.click(); return true; }

    const m = action.match(/^([DT])(\d{1,2})$/);
    if (m) return await clickWithModifier(m[1], m[2]);

    return false;
  }

  function targetToKeyboardAction(target) {
    if (target.ring === "OUT") return "MISS";
    if (target.ring === "SBULL") return "25";
    if (target.ring === "DBULL") return "BULL";
    if (target.ring === "SO" || target.ring === "SI") return "S" + target.n;
    if (target.ring === "D") return "D" + target.n;
    if (target.ring === "T") return "T" + target.n;
    return null;
  }

  function isAllowedForAction(allowed, action) {
    if (!action) return false;
    if (allowed.has(action)) return true;

    if (/^D\d{1,2}$/.test(action) && allowed.has("DOUBLE_MOD")) return true;
    if (/^T\d{1,2}$/.test(action) && allowed.has("TRIPLE_MOD")) return true;

    if (action === "BULL" && allowed.has("DOUBLE_MOD") && allowed.has("25")) return true;
    return false;
  }

  /********************************************************************
   * Autodarts Board-Mode Auto-Switch (best effort)
   ********************************************************************/
  let lastModeSwitchAttemptAt = 0;

  function textOf(el) {
    return (el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || "").trim();
  }

  function findClickableByText(regex) {
    const candidates = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('[role="button"]'),
      ...document.querySelectorAll("a"),
      ...document.querySelectorAll("label")
    ];
    for (const el of candidates) {
      const t = textOf(el);
      if (!t) continue;
      if (!regex.test(t)) continue;

      if (el.tagName === "BUTTON") {
        if (!isClickableButton(el)) continue;
      } else {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.pointerEvents === "none") continue;
      }
      return el;
    }
    return null;
  }

  function boardLooksAvailable() {
    return !!document.querySelector('svg[viewBox="0 0 1000 1000"]');
  }

  async function ensureAutodartsBoardInputModeEnabled() {
    const now = Date.now();
    if (now - lastModeSwitchAttemptAt < 1200) return;
    lastModeSwitchAttemptAt = now;

    if (boardLooksAvailable()) return;

    const direct =
      findClickableByText(/\b(scheibe|dartscheibe|dartboard|board)\b/i) ||
      findClickableByText(/\b(board\s*mode|board\s*input|dartboard\s*input)\b/i);

    if (direct) {
      ui.log('Auto-switch: clicking "' + textOf(direct) + '"');
      try { direct.click(); } catch {}
      await sleep(200);
      return;
    }

    const settingsBtn =
      findClickableByText(/\b(settings|einstellungen)\b/i) ||
      Array.from(document.querySelectorAll("button,[role='button']")).find(el => {
        const t = textOf(el).toLowerCase();
        return t.includes("setting") || t.includes("einstellung") || t.includes("gear") || t.includes("cog");
      });

    if (settingsBtn) {
      ui.log('Auto-switch: opening settings "' + textOf(settingsBtn) + '"');
      try { settingsBtn.click(); } catch {}
      await sleep(200);

      const after =
        findClickableByText(/\b(scheibe|dartscheibe|dartboard|board)\b/i) ||
        findClickableByText(/\b(board\s*mode|board\s*input|dartboard\s*input)\b/i);

      if (after) {
        ui.log('Auto-switch: clicking "' + textOf(after) + '"');
        try { after.click(); } catch {}
        await sleep(200);
        return;
      }
    }

    ui.log("Auto-switch: board mode toggle not found (need selector/text).");
  }

  /********************************************************************
   * Board-click injection (uses your persisted calibration)
   ********************************************************************/
  const BOARD = (() => {
    const DART_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    const VB = { w: 1000, h: 1000, cx: 500, cy: 500 };
    const SBULL_CLICK_R = (15.556 + 37.778) / 2;
    const LS_KEY = "__ad_board_tester_cal_v136__";

    const DEFAULT_CAL = {
      r_dbull: 10,
      r_triple: 228,
      r_double: 365,
      r_single_inner: 200,
      r_single_outer: 300,
      off_x: 0,
      off_y: 1.5,
      sbull_off_x: -20,
      sbull_off_y: 0,
      r_miss_ring: 400,
      miss_angle_deg: 0
    };

    function loadCal() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return { ...DEFAULT_CAL };
        const obj = JSON.parse(raw);
        return { ...DEFAULT_CAL, ...obj };
      } catch {
        return { ...DEFAULT_CAL };
      }
    }

    let CAL = loadCal();
    let pointerSeq = 600;

    function angleForNumber(n) {
      const idx = DART_ORDER.indexOf(n);
      if (idx === -1) return null;
      const deg = -90 + idx * 18;
      return (deg * Math.PI) / 180;
    }

    function pointForKind(kind, n) {
      const cx = VB.cx + CAL.off_x;
      const cy = VB.cy + CAL.off_y;

      if (kind === "DBULL") return { x: cx, y: cy };

      if (kind === "SBULL") {
        const ang = (-90 * Math.PI) / 180;
        const r = SBULL_CLICK_R;
        return {
          x: (cx + CAL.sbull_off_x) + Math.cos(ang) * r,
          y: (cy + CAL.sbull_off_y) + Math.sin(ang) * r
        };
      }

      if (kind === "MISS") {
        const ang = ((CAL.miss_angle_deg || 0) * Math.PI) / 180;
        const r = CAL.r_miss_ring || 400;
        return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
      }

      const theta = angleForNumber(n);
      if (theta == null) return null;

      const ringR =
        kind === "D" ? CAL.r_double :
        kind === "T" ? CAL.r_triple :
        kind === "SI" ? CAL.r_single_inner :
        kind === "SO" ? CAL.r_single_outer :
        CAL.r_single_outer;

      return { x: cx + Math.cos(theta) * ringR, y: cy + Math.sin(theta) * ringR };
    }

    function findBoardSvg() {
      const svgs = Array.from(document.querySelectorAll('svg[viewBox="0 0 1000 1000"]'));
      for (const svg of svgs) {
        const rect = svg.querySelector('g > rect[width="1000"][height="1000"]');
        if (rect) return { svg, rect };
      }
      if (svgs[0]) return { svg: svgs[0], rect: svgs[0] };
      return null;
    }

    function svgPointToClient(svg, pt) {
      const r = svg.getBoundingClientRect();
      const sx = r.width / VB.w;
      const sy = r.height / VB.h;
      return { cx: r.left + pt.x * sx, cy: r.top + pt.y * sy };
    }

    function safeFocus(el) { try { if (el && typeof el.focus === "function") el.focus({ preventScroll: true }); } catch {} }

    function dispatchSequenceToMany(targets, clientX, clientY) {
      pointerSeq += 1;
      const pid = pointerSeq;

      const basePointer = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        pointerId: pid,
        pointerType: "mouse",
        isPrimary: true
      };
      const mouseBase = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

      const emit = (type, makeEv) => {
        for (const t of targets) {
          try { t.dispatchEvent(makeEv(type)); } catch {}
        }
      };

      emit("pointermove", (type) => new PointerEvent(type, { ...basePointer, buttons: 0 }));
      emit("mousemove", (type) => new MouseEvent(type, { ...mouseBase, buttons: 0 }));
      emit("pointerover", (type) => new PointerEvent(type, { ...basePointer, buttons: 0 }));
      emit("pointerenter", (type) => new PointerEvent(type, { ...basePointer, buttons: 0 }));
      emit("mouseover", (type) => new MouseEvent(type, mouseBase));
      emit("pointerdown", (type) => new PointerEvent(type, { ...basePointer, buttons: 1 }));
      emit("mousedown", (type) => new MouseEvent(type, { ...mouseBase, button: 0, buttons: 1 }));
      emit("pointerup", (type) => new PointerEvent(type, { ...basePointer, buttons: 0 }));
      emit("mouseup", (type) => new MouseEvent(type, { ...mouseBase, button: 0, buttons: 0 }));
      emit("click", (type) => new MouseEvent(type, { ...mouseBase, detail: 1 }));
    }

    async function fire(kind, n) {
      CAL = loadCal();

      const board = findBoardSvg();
      if (!board) throw new Error("Board SVG not found (viewBox 0 0 1000 1000).");

      const pt = pointForKind(kind, n);
      if (!pt) throw new Error("No point for kind=" + kind + " n=" + n);

      const client = svgPointToClient(board.svg, pt);
      const rectTarget = board.rect || board.svg;
      const targets = [rectTarget, board.svg, document, window].filter(Boolean);

      safeFocus(window);
      safeFocus(document.body);
      safeFocus(board.svg);
      safeFocus(board.svg.parentElement);
      safeFocus(rectTarget);

      await sleep(10);
      dispatchSequenceToMany(targets, client.cx, client.cy);
      await sleep(35);
      dispatchSequenceToMany(targets, client.cx, client.cy);

      return { vb: pt, client };
    }

    function targetToBoardKind(target) {
      if (target.ring === "OUT") return { kind: "MISS" };
      if (target.ring === "SBULL") return { kind: "SBULL" };
      if (target.ring === "DBULL") return { kind: "DBULL" };
      if (target.ring === "SO") return { kind: "SO", n: target.n };
      if (target.ring === "SI") return { kind: "SI", n: target.n };
      if (target.ring === "D") return { kind: "D", n: target.n };
      if (target.ring === "T") return { kind: "T", n: target.n };
      return null;
    }

    return { fire, targetToBoardKind };
  })();

  /********************************************************************
   * Router + Inject
   ********************************************************************/
  function resolveMode(allowed) {
    if (SETTINGS.inputMode === "keyboard") return "keyboard";
    if (SETTINGS.inputMode === "board") return "board";
    return shouldUseBoardFallbackInAuto(allowed) ? "board" : "keyboard";
  }

  let lastInjectAt = 0;

  async function injectTarget(target, sourceLabel) {
    const now = Date.now();
    if (now - lastInjectAt < CONFIG.minMsBetweenThrows) return;
    lastInjectAt = now;

    const allowed = getAllowedActions(); // runtime updates
    const mode = resolveMode(allowed);

    ui.mode.textContent = formatModeLabel(mode);
    ui.raw.textContent = sourceLabel || "BLE";

    // BTN@ is from GranBoard -> NEXT
    if (target && target.__specialNext) {
      ui.action.textContent = "NEXT";
      await clickAction("NEXT"); // will also flash LED (if enabled)
      return;
    }

    const kbAction = targetToKeyboardAction(target);
    const boardKind = BOARD.targetToBoardKind(target);
    ui.action.textContent = kbAction || (boardKind ? (boardKind.kind + (boardKind.n ? boardKind.n : "")) : "—");

    if (mode === "keyboard") {
      const hasNumbers = allowedHasAnyNumbers(allowed);

      if (!isAllowedForAction(allowed, kbAction)) {
        ui.log(`Not allowed on keypad: ${kbAction} -> MISS`);
        await clickAction("MISS");
        return;
      }

      const ok = await clickAction(kbAction);
      if (ok) return;

      ui.log(`Keyboard click failed: ${kbAction} -> ${hasNumbers ? "MISS" : "board fallback"}`);
      if (hasNumbers) {
        await clickAction("MISS");
        return;
      }
      // else fall through to board as last resort
    }

    // Board mode: try to flip Autodarts into board/scheibe if needed
    if (SETTINGS.inputMode === "auto" && shouldUseBoardFallbackInAuto(allowed)) {
      await ensureAutodartsBoardInputModeEnabled();
    }

    const bk = BOARD.targetToBoardKind(target);
    if (!bk) {
      ui.log("Board: unknown target -> MISS");
      try { await BOARD.fire("MISS", 0); } catch (e) { ui.log("Board MISS error: " + (e?.message || e)); }
      return;
    }

    try {
      const res = await BOARD.fire(bk.kind, bk.n || 0);
      if (SETTINGS.debug) ui.log(`Board fire ${bk.kind}${bk.n ? bk.n : ""} client(${res.client.cx.toFixed(1)},${res.client.cy.toFixed(1)})`);
    } catch (e) {
      ui.log("Board fire error: " + (e?.message || e));
      await clickAction("MISS");
    }
  }

  /********************************************************************
   * BLE notify handler
   ********************************************************************/
  async function handleRawFrame(raw) {
    let cleaned = String(raw || "").trim();

    const idx = cleaned.indexOf(CONFIG.CONNECT_PREFIX);
    if (idx !== -1) {
      const before = cleaned;
      cleaned = cleaned.slice(idx + CONFIG.CONNECT_PREFIX.length);
      if (!cleaned) return;
      if (!cleaned.endsWith("@") && raw.endsWith("@")) cleaned += "@";
      ui.log(`Prefix stripped: "${before}" -> "${cleaned}"`);
    }

    ui.raw.textContent = cleaned;

    if (cleaned === "BTN@") {
      await injectTarget({ __specialNext: true }, "BLE");
      return;
    }

    const target = RAW_TO_TARGET.get(cleaned);
    if (!target) {
      ui.log('Unknown RAW "' + cleaned + '"');
      ui.action.textContent = "—";
      return;
    }

    await injectTarget(target, "BLE");
  }

  function onNotify(event) {
    const u8 = new Uint8Array(event.target.value.buffer);
    appendToBuffer(u8);
    for (const f of extractFrames()) {
      const raw = bytesToAsciiVisible(f);
      handleRawFrame(raw).catch(e => ui.log("handleRawFrame error: " + (e?.message || e)));
    }
  }

  /********************************************************************
   * Connect / Disconnect
   ********************************************************************/
  async function connectGranBoard() {
    if (!navigator.bluetooth) {
      ui.log("WebBluetooth not available.");
      setConnectedState(false);
      return;
    }
    if (connected) return;

    ui.log("Connect…");

    try {
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: CONFIG.namePrefix }],
          optionalServices: [CONFIG.VENDOR_SERVICE, ...CONFIG.extraOptionalServices]
        });
      } catch {
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [CONFIG.VENDOR_SERVICE, ...CONFIG.extraOptionalServices]
        });
      }

      ui.device.textContent = device.name || "(no name)";
      saveLastDeviceName(device.name || "");
      setConnectedState(false);

      device.addEventListener("gattserverdisconnected", () => {
        ui.log("BLE disconnected.");
        server = null;
        notifyChar = null;
        ledChar = null;
        setConnectedState(false);
      }, { once: true });

      server = await device.gatt.connect();

      const service = await server.getPrimaryService(CONFIG.VENDOR_SERVICE);
      const chars = await service.getCharacteristics();

      // Notify/Indicate stream
      const notifyCandidates = chars.filter(c => c.properties.notify || c.properties.indicate);
      if (!notifyCandidates.length) {
        ui.log("No notify/indicate characteristic found.");
        setConnectedState(false);
        return;
      }
      notifyChar = notifyCandidates.find(c => c.properties.notify) || notifyCandidates[0];
      ui.log("Using notify characteristic: " + notifyChar.uuid);

      // LED write characteristic (best effort)
      const writeCandidates = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);
      ledChar = writeCandidates.find(c => c.uuid !== notifyChar.uuid) || writeCandidates[0] || null;
      ui.log("Using LED characteristic: " + (ledChar ? ledChar.uuid : "none"));

      streamBuffer = new Uint8Array(0);
      await notifyChar.startNotifications();
      notifyChar.addEventListener("characteristicvaluechanged", onNotify);

      setConnectedState(true);
      ui.log("Connected.");
    } catch (e) {
      ui.log("Connect error: " + (e?.message || e));
      setConnectedState(false);
    }
  }

  async function disconnectGranBoard() {
    try {
      if (notifyChar) {
        notifyChar.removeEventListener("characteristicvaluechanged", onNotify);
        try { await notifyChar.stopNotifications(); } catch {}
      }
      if (device?.gatt?.connected) device.gatt.disconnect();
    } finally {
      server = null;
      notifyChar = null;
      ledChar = null;
      device = null;
      streamBuffer = new Uint8Array(0);

      ui.device.textContent = "—";
      ui.raw.textContent = "—";
      ui.action.textContent = "—";
      ui.mode.textContent = "—";
      setConnectedState(false);
      ui.log("Disconnected.");
    }
  }

  ui.connectToggleBtn.addEventListener("click", () => {
    if (connected) disconnectGranBoard();
    else connectGranBoard();
  });

  setConnectedState(false);

  /********************************************************************
   * SPA persistence (re-attach overlay)
   ********************************************************************/
  function ensureUIAttached() {
    if (!document.getElementById("__gb_ad_overlay__") || !document.getElementById("__gb_ad_tab__")) {
      ui = createUI();
      setOverlayVisible(SETTINGS.overlay);
      applyDebugUI();
      applyLedUI();
      applyInputModeUI();
      setTabBorder();
      paintStatus();

      ui.hideBtn.addEventListener("click", () => setOverlayVisible(false));
      ui.tab.addEventListener("click", () => setOverlayVisible(true));

      ui.debugToggle.addEventListener("change", () => {
        SETTINGS.debug = !!ui.debugToggle.checked;
        saveBool(STORAGE.DEBUG, SETTINGS.debug);
        applyDebugUI();
      });

      ui.ledToggle.addEventListener("change", () => {
        SETTINGS.ledNext = !!ui.ledToggle.checked;
        saveBool(STORAGE.LED_NEXT, SETTINGS.ledNext);
      });

      ui.inputSelect.addEventListener("change", () => {
        SETTINGS.inputMode = ui.inputSelect.value || "auto";
        saveStr(STORAGE.INPUT_MODE, SETTINGS.inputMode);
        applyInputModeUI();
      });

      ui.connectToggleBtn.addEventListener("click", () => {
        if (connected) disconnectGranBoard();
        else connectGranBoard();
      });
    }
  }

  (function hookHistory() {
    const _push = history.pushState;
    const _replace = history.replaceState;

    history.pushState = function () {
      const r = _push.apply(this, arguments);
      setTimeout(ensureUIAttached, 50);
      return r;
    };

    history.replaceState = function () {
      const r = _replace.apply(this, arguments);
      setTimeout(ensureUIAttached, 50);
      return r;
    };

    window.addEventListener("popstate", () => setTimeout(ensureUIAttached, 50));
  })();

  new MutationObserver(() => ensureUIAttached()).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(ensureUIAttached, 1200);
})();