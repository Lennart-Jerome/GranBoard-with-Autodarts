// ==UserScript==
// @name         GranBoard-with-Autodarts
// @namespace    https://github.com/Lennart-Jerome/GranBoard-with-Autodarts
// @version      3.0.17
// @description  GranBoard → Autodarts connect Granboard to Autodarts over Web Bluetooth
// @author       Lennart-Jerome
// @homepageURL  https://github.com/Lennart-Jerome/GranBoard-with-Autodarts
// @supportURL   https://github.com/Lennart-Jerome/GranBoard-with-Autodarts/issues
// @updateURL    https://raw.githubusercontent.com/Lennart-Jerome/GranBoard-with-Autodarts/main/GranBoard-with-Autodarts.user.js
// @downloadURL  https://raw.githubusercontent.com/Lennart-Jerome/GranBoard-with-Autodarts/main/GranBoard-with-Autodarts.user.js
// @match        https://play.autodarts.io/*
// @match        https://*.autodarts.io/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

/**
 * DE: GranBoard-with-Autodarts Userscript
 * - Liest GranBoard BLE Hits über WebBluetooth (Proxy/Board) und trägt sie in AutoDarts ein.
 * - AutoView: wechselt zwischen Keyboard-View und Board-View nur wenn nötig (mit Cooldown gegen Flattern).
 * - LEDs: pro Aktion frei konfigurierbare Presets (Next/Hit/Miss/Bull/…).
 * - Online: optionales LED-Event "Next (Online Gegner)" wenn der Turn-Counter auf 0 zurückspringt.
 *
 * EN: GranBoard-with-Autodarts userscript
 * - Reads GranBoard BLE hits via WebBluetooth (proxy/board) and enters them into AutoDarts.
 * - AutoView: switches between keyboard view and board view only when needed (with cooldown to prevent flapping).
 * - LEDs: per-action configurable presets (Next/Hit/Miss/Bull/…).
 * - Online: optional LED event "Next (Online opponent)" when the turn counter resets to 0.
 */


(function () {
  "use strict";
let __lastUndoAt = 0; // timestamp of last UNDO (ms)
  if (window.__GB_AD_STEP3_V307_INIT__) return;
  window.__GB_AD_STEP3_V307_INIT__ = true;

  /********************************************************************
   * Storage
   ********************************************************************/
  const STORAGE = {
    OVERLAY: "gb_overlay_visible",
    LAST_DEVICE_NAME: "gb_last_device_name",

    INPUT_MODE: "gb_input_mode_v307",         // auto | keyboard | board
    AUTO_NEXT_MODE: "gb_auto_next_mode_v308", // off | on
    AUTO_NEXT_DELAY_MS: "gb_auto_next_delay_ms_v308", // 500..10000
    LOG_LEVEL: "gb_log_level_v307",           // off | basic | adv

    // Board settings
    BS_REPLY_INTERVAL: "gb_bs_reply_interval", // 0..255 (byte0) ..45
    BS_OUT_SENS: "gb_bs_out_sens",             // 0..15  (byte0) ..67
    BS_TARGET_SET: "gb_bs_target_set",         // set1..set4  ..3A3B

    // LED per reaction settings
    LED_REACTION_PREFIX: "gb_led_rxn_",        // + reactionId -> JSON
  };


  /********************************************************************
   * First-install defaults
   * - Only set when keys are missing (never overwrite user changes).
   ********************************************************************/
  const DEFAULT_INIT_MARK = "gb_defaults_applied_v3011";

  function setIfMissing(key, val) {
    try {
      if (localStorage.getItem(key) == null) localStorage.setItem(key, String(val));
    } catch {}
  }
  function setJsonIfMissing(key, obj) {
    try {
      if (localStorage.getItem(key) == null) localStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  }

  (function applyFirstInstallDefaults() {
    try {
      if (localStorage.getItem(DEFAULT_INIT_MARK) === "1") return;

      // Core defaults
      setIfMissing(STORAGE.OVERLAY, "1");
      setIfMissing(STORAGE.INPUT_MODE, "auto");
      setIfMissing(STORAGE.AUTO_NEXT_MODE, "on");
      setIfMissing(STORAGE.AUTO_NEXT_DELAY_MS, "3000");
      setIfMissing(STORAGE.LOG_LEVEL, "off");

      // Board defaults
      setIfMissing(STORAGE.BS_REPLY_INTERVAL, "12");
      setIfMissing(STORAGE.BS_OUT_SENS, "4");
      setIfMissing(STORAGE.BS_TARGET_SET, "set2");

      // LED reaction defaults (from your exported localStorage values)
      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "connect", {
        enabled:true, presetKey:"classic_connect", speed:10,
        colorA:"#2bff00", colorB:"#45e21d", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "next", {
        enabled:true, presetKey:"classic_next", speed:0,
        colorA:"#66ff00", colorB:"#05ebd0", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "next_online", {
        enabled:true, presetKey:"classic_next", speed:7,
        colorA:"#287ff0", colorB:"#0afe06", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "bust", {
        enabled:true, presetKey:"op18", speed:20,
        colorA:"#ff0000", colorB:"#00ffff", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "miss", {
        enabled:true, presetKey:"op18", speed:15,
        colorA:"#5b057a", colorB:"#0011ff", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "hit_single", {
        enabled:true, presetKey:"classic_hit_single", speed:17,
        colorA:"#ff0000", colorB:"#f2d95f", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "hit_double", {
        enabled:true, presetKey:"classic_hit_double", speed:20,
        colorA:"#ff0000", colorB:"#f5cc00", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "hit_triple", {
        enabled:true, presetKey:"classic_hit_triple", speed:20,
        colorA:"#ff0000", colorB:"#ffc800", colorC:"#00ffff"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "bull_single", {
        enabled:true, presetKey:"op1f", speed:17,
        colorA:"#2a00fa", colorB:"#0f4fe6", colorC:"#14a0db"
      });

      setJsonIfMissing(STORAGE.LED_REACTION_PREFIX + "bull_double", {
        enabled:true, presetKey:"op1f", speed:16,
        colorA:"#ff2600", colorB:"#f90101", colorC:"#aeff00"
      });

      // Mark as applied (so we never re-run on updates)
      localStorage.setItem(DEFAULT_INIT_MARK, "1");
    } catch {}
  })();

  const DEFAULTS = {
    overlay: localStorage.getItem(STORAGE.OVERLAY) !== "0",
    inputMode: (localStorage.getItem(STORAGE.INPUT_MODE) || "auto"),
    autoNextMode: (localStorage.getItem(STORAGE.AUTO_NEXT_MODE) || "on"),
    autoNextDelayMs: clamp(parseInt(localStorage.getItem(STORAGE.AUTO_NEXT_DELAY_MS) || "3000", 10) || 3000, 500, 10000),
    logLevel: (localStorage.getItem(STORAGE.LOG_LEVEL) || "off"),
    boardReplyInterval: +(localStorage.getItem(STORAGE.BS_REPLY_INTERVAL) || "12"),
    boardOutSens: +(localStorage.getItem(STORAGE.BS_OUT_SENS) || "4"),
    boardTargetSet: (localStorage.getItem(STORAGE.BS_TARGET_SET) || "set2"),
  };

  function saveStr(key, val) { try { localStorage.setItem(key, String(val ?? "")); } catch {} }
  function saveNum(key, val) { try { localStorage.setItem(key, String(+val)); } catch {} }
  function saveBool(key, val) { try { localStorage.setItem(key, val ? "1" : "0"); } catch {} }

  function saveLastDeviceName(name) { try { localStorage.setItem(STORAGE.LAST_DEVICE_NAME, name || ""); } catch {} }
  function getLastDeviceName() { try { return (localStorage.getItem(STORAGE.LAST_DEVICE_NAME) || "").trim(); } catch { return ""; } }

  /********************************************************************
   * i18n (Next/Undo labels should follow AD language)
   ********************************************************************/
  function getUILang() {
    const lang = (document.documentElement.getAttribute("lang") || navigator.language || "en").toLowerCase();
    if (lang.startsWith("de")) return "de";
    if (lang.startsWith("nl")) return "nl";
    return "en";
  }

  const I18N = {
    en: { next: "Next", undo: "Undo", settings: "Settings", hide: "Hide", connect: "Connect", disconnect: "Disconnect", auto: "Auto", keyboard:"Keyboard", board:"Board" },
    de: { next: "Nächster", undo: "Rückgängig", settings: "Settings", hide: "Hide", connect: "Connect", disconnect: "Disconnect", auto: "Auto", keyboard:"Keyboard", board:"Board" },
    nl: { next: "Volgende", undo: "Ongedaan maken", settings: "Settings", hide: "Hide", connect: "Connect", disconnect: "Disconnect", auto: "Auto", keyboard:"Keyboard", board:"Board" },
  };

  function t(key) {
    const lang = getUILang();
    return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  }

  /********************************************************************
   * Config
   ********************************************************************/
  const CONFIG = {
    VENDOR_SERVICE: "442f1570-8a00-9a28-cbe1-e1d4212d53eb",
    extraOptionalServices: [
      "0000180f-0000-1000-8000-00805f9b34fb",
      "0000180a-0000-1000-8000-00805f9b34fb"
    ],
    namePrefix: "GRAN",
    CONNECT_PREFIX: "GB8;102",

    uiSwitchWaitMs: 180,
    uiSwitchRetryMs: 900,
    uiSwitchCooldownMs: 2500, // DE: Cooldown gegen View-Flattern | EN: cooldown to prevent view flapping
    minMsBetweenThrows: 250,
  };

  /********************************************************************
   * Helpers
   ********************************************************************/
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toUpperCase();

  function ts() {
    // HH:MM:SS
    return new Date().toLocaleTimeString();
  }

  function isClickableButton(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    const aria = btn.getAttribute("aria-disabled");
    if (aria && aria.toLowerCase() === "true") return false;
    const style = getComputedStyle(btn);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
    return true;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.pointerEvents === "none") return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  }

  function u8ToHex(u8) {
    return Array.from(u8).map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  }

  function bytesToAsciiVisible(u8) {
    return [...u8].map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".").join("");
  }

  function hexToU8(hex) {
    const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function parseHexColor(hex) {
    let h = String(hex || "").trim();
    if (!h) return { r:255, g:0, b:0 };
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 3) h = h.split("").map(x=>x+x).join("");
    if (h.length !== 6) return { r:255, g:0, b:0 };
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return { r, g, b };
  }

  /********************************************************************
   * Autodarts keypad labels (Next/Undo localized)
   ********************************************************************/
  function findBtnByExactTextAny(labels) {
    const wanted = labels.map(norm);
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find(b => wanted.includes(norm(b.textContent))) || null;
  }

  function findNextButton() {
    // Next is localized; fallback: contains NEXT in any language list
    const nextLabels = [t("next"), "NEXT", "VOLGENDE", "NÄCHSTER"];
    return findBtnByExactTextAny(nextLabels);
  }

  function findUndoButton() {
    const undoLabels = [t("undo"), "UNDO", "RÜCKGÄNGIG", "ONGEDAAN MAKEN"];
    return findBtnByExactTextAny(undoLabels);
  }

  function normalizeActionFromButtonText(tText) {
    const u = norm(tText);
    if (!u) return null;

    // Keep these stable: Autodarts uses English for these even in other locales (as you said)
    if (u === "MISS") return "MISS";
    if (u === "DOUBLE") return "DOUBLE_MOD";
    if (u === "TRIPLE") return "TRIPLE_MOD";
    if (u === "BULL") return "BULL";
    if (u === "25") return "25";

    // localized Next / Undo
    if (u === norm(t("next")) || u === "NEXT" || u === "VOLGENDE" || u === "NÄCHSTER") return "NEXT";
    if (u === norm(t("undo")) || u === "UNDO" || u === "RÜCKGÄNGIG" || u === "ONGEDAAN MAKEN") return "UNDO";

    const m = u.match(/^([SDT])\s*(\d{1,2})$/);
    if (m) {
      const n = parseInt(m[2], 10);
      if (n >= 0 && n <= 20) return m[1] + String(n);
    }
    return null;
  }
  // --- Undo handling: keep dartCount in sync when user corrects throws ---
  function handleUndo(reason) {
    const allowed = getAllowedActions();
    if (isOpponentTurnKeyboardNoButtons(allowed)) return;

    __lastUndoAt = Date.now();

    // cancel pending AutoNext if any
    if (__autoNextTimer) {
      try { clearTimeout(__autoNextTimer); } catch {}
      __autoNextTimer = null;
      ui?.logAdv?.("AutoNext canceled due to UNDO");
    }

    const before = STATE.dartCount;
    STATE.dartCount = clamp((STATE.dartCount || 0) - 1, 0, 99);
    ui?.logAdv?.(`UNDO detected -> dartCount ${before} -> ${STATE.dartCount} (${reason || "click"})`);
  }

  // capture Undo button clicks anywhere in the app (SPA-safe)
  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button");
    if (!btn) return;

    const action = normalizeActionFromButtonText(btn.textContent || "");
    if (action === "UNDO") {
      handleUndo("button");
    }
  }, true);



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

  
  function isKeyboardViewActive() {
    const seg = findSegmentsButton();
    return !!seg && isActiveModeButton(seg);
  }

  // DE: Wenn Keyboard-View aktiv ist, aber KEINE Eingabe-Buttons vorhanden sind,
  // dann ist sehr wahrscheinlich der Gegner am Zug (X01 online). In dem Fall:
  // Eingaben ignorieren, KEIN View-Switch, KEIN Board-Fallback.
  // EN: If keyboard view is active but there are no input buttons, it's likely opponent's turn (online).
  function isOpponentTurnKeyboardNoButtons(allowed) {
    if (!isKeyboardViewActive()) return false;

    // No numbers AND no action buttons => opponent turn UI
    const hasAnyInput =
      allowedHasAnyNumbers(allowed) ||
      allowed.has("MISS") || allowed.has("DOUBLE_MOD") || allowed.has("TRIPLE_MOD") ||
      allowed.has("UNDO") || allowed.has("NEXT") || allowed.has("25") || allowed.has("BULL");

    return !hasAnyInput;
  }
/********************************************************************
   * AutoView: Keyboard/Segments icon & Boardview icon detection
   ********************************************************************/
  function looksLikeSegmentsButton(btn) {
    if (!btn || btn.tagName !== "BUTTON") return false;
    if (!isElementVisible(btn)) return false;
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    const svg = btn.querySelector("svg[viewBox='0 0 24 24']");
    if (!svg) return false;
    const paths = Array.from(svg.querySelectorAll("path")).map(p => p.getAttribute("d") || "");
    const hasPath = paths.some(d => d.includes("M20 5H4c-1.1"));
    return aria.includes("segments") || hasPath;
  }

  function looksLikeBoardViewButton(btn) {
    if (!btn || btn.tagName !== "BUTTON") return false;
    if (!isElementVisible(btn)) return false;
    const svg = btn.querySelector("svg[viewBox='0 0 24 24']");
    if (!svg) return false;
    const paths = Array.from(svg.querySelectorAll("path")).map(p => p.getAttribute("d") || "");
    return paths.some(d => d.includes("M12 2C6.49 2"));
  }

  function isActiveModeButton(btn) {
    return !!btn && (btn.hasAttribute("data-active") || btn.getAttribute("data-active") === "");
  }

  function findSegmentsButton() {
    return Array.from(document.querySelectorAll("button")).find(looksLikeSegmentsButton) || null;
  }

  function findBoardViewButton() {
    return Array.from(document.querySelectorAll("button")).find(looksLikeBoardViewButton) || null;
  }

  let __lastUiSwitchAttemptAt = 0;
  let __lastUiSwitchAt = 0; // DE: Zeitpunkt des letzten echten View-Switches | EN: timestamp of last actual view switch
  let __localNextAt = 0;    // DE: Zeitpunkt wenn WIR Next gedrückt haben | EN: timestamp when WE pressed Next
  let __lastLocalThrowAt = 0; // DE: Zeitpunkt der letzten lokalen Eingabe | EN: timestamp of last local throw entry
  let __lastBustAt = 0;       // DE/EN: debounce for bust detection
  let __autoNextTimer = null; // DE: Timer für AutoNext | EN: timer handle for AutoNext


  async function ensureKeyboardView(logAdv) {
    const now = Date.now();
    if (now - __lastUiSwitchAttemptAt < CONFIG.uiSwitchRetryMs) return false;
    __lastUiSwitchAttemptAt = now;

    // DE: Cooldown gegen View-Flattern (z.B. Leg-Wechsel)
    // EN: Cooldown to prevent view flapping (e.g., leg transitions)
    if (now - __lastUiSwitchAt < CONFIG.uiSwitchCooldownMs) return false;

    const seg = findSegmentsButton();
    if (!seg) return false;
    if (isActiveModeButton(seg)) return true;

    if (isClickableButton(seg)) {
      logAdv?.("AutoView: switching to Keyboard");
      seg.click();
      __lastUiSwitchAt = now;
      await sleep(CONFIG.uiSwitchWaitMs);
      return true;
    }
    return false;
  }

  async function ensureBoardView(logAdv) {
    const now = Date.now();
    if (now - __lastUiSwitchAttemptAt < CONFIG.uiSwitchRetryMs) return false;
    __lastUiSwitchAttemptAt = now;

    // DE: Cooldown gegen View-Flattern (z.B. Leg-Wechsel)
    // EN: Cooldown to prevent view flapping (e.g., leg transitions)
    if (now - __lastUiSwitchAt < CONFIG.uiSwitchCooldownMs) return false;

    const bv = findBoardViewButton();
    if (!bv) return false;
    if (isActiveModeButton(bv)) return true;

    if (isClickableButton(bv)) {
      logAdv?.("AutoView: switching to Board");
      bv.click();
      __lastUiSwitchAt = now;
      await sleep(CONFIG.uiSwitchWaitMs);
      return true;
    }
    return false;
  }

  // AutoView: on "New game / Start" actions, prefer Keyboard view as the default.
  // We do this with a small retry loop because the Segments button may appear a moment later.
  function scheduleKeyboardOnNewGame(reason) {
    // Reset local dart counter when a new game/match is started
    resetDartCounter("NEW_GAME");

    if (STATE.inputMode !== "auto") return;
    let tries = 0;
    const maxTries = 8;
    const t = setInterval(async () => {
      tries++;
      const ok = await ensureKeyboardView(ui?.logAdv).catch(()=>false);
      if (ok || tries >= maxTries) clearInterval(t);
    }, 350);
    ui?.logAdv?.(`AutoView: new game -> try Keyboard (${reason || "signal"})`);
  }

  // Capture clicks on likely "start/new game" buttons (German + English).
  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button");
    if (!btn) return;
    const txt = (btn.textContent || "").trim().toLowerCase();
    const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
    const hay = (txt + " " + aria).replace(/\s+/g, " ");
    if (/(new game|start game|start match|new match|neues spiel|spiel starten|starten|neue partie)/i.test(hay)) {
      scheduleKeyboardOnNewGame(hay);
    }
  }, true);


  /********************************************************************
   * RAW -> target mapping (from your existing mapping)
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
    ["4.0@", { ring: "DBULL", n: 50 }],
  ]);

  function targetToKeyboardAction(target) {
    if (target.ring === "OUT") return "MISS";
    if (target.ring === "SBULL") return "25";
    if (target.ring === "DBULL") return "BULL";
    if (target.ring === "SO" || target.ring === "SI") return "S" + target.n;
    if (target.ring === "D") return "D" + target.n;
    if (target.ring === "T") return "T" + target.n;
    return null;
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

    let pointerSeq = 600;

    function angleForNumber(n) {
      const idx = DART_ORDER.indexOf(n);
      if (idx === -1) return null;
      const deg = -90 + idx * 18;
      return (deg * Math.PI) / 180;
    }

    function pointForKind(kind, n) {
      const CAL = loadCal();
      const cx = VB.cx + CAL.off_x;
      const cy = VB.cy + CAL.off_y;

      if (kind === "DBULL") return { x: cx, y: cy };

      if (kind === "SBULL") {
        const ang = (-90 * Math.PI) / 180;
        return {
          x: (cx + CAL.sbull_off_x) + Math.cos(ang) * SBULL_CLICK_R,
          y: (cy + CAL.sbull_off_y) + Math.sin(ang) * SBULL_CLICK_R
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
        bubbles: true, cancelable: true, composed: true,
        clientX, clientY, pointerId: pid, pointerType: "mouse", isPrimary: true
      };
      const mouseBase = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

      const emit = (type, makeEv) => {
        for (const t of targets) { try { t.dispatchEvent(makeEv(type)); } catch {} }
      };

      emit("pointermove", (t) => new PointerEvent(t, { ...basePointer, buttons: 0 }));
      emit("mousemove", (t) => new MouseEvent(t, { ...mouseBase, buttons: 0 }));
      emit("pointerover", (t) => new PointerEvent(t, { ...basePointer, buttons: 0 }));
      emit("pointerenter", (t) => new PointerEvent(t, { ...basePointer, buttons: 0 }));
      emit("mouseover", (t) => new MouseEvent(t, mouseBase));
      emit("pointerdown", (t) => new PointerEvent(t, { ...basePointer, buttons: 1 }));
      emit("mousedown", (t) => new MouseEvent(t, { ...mouseBase, button: 0, buttons: 1 }));
      emit("pointerup", (t) => new PointerEvent(t, { ...basePointer, buttons: 0 }));
      emit("mouseup", (t) => new MouseEvent(t, { ...mouseBase, button: 0, buttons: 0 }));
      emit("click", (t) => new MouseEvent(t, { ...mouseBase, detail: 1 }));
    }

    async function fire(kind, n) {
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
   * UI (Overlay + Settings drawer with Tabs: LED | Board | Logs)
   ********************************************************************/
  const STATE = {
    overlayVisible: DEFAULTS.overlay,
    settingsOpen: false,
    inputMode: DEFAULTS.inputMode,
    autoNextMode: DEFAULTS.autoNextMode,
    autoNextDelayMs: DEFAULTS.autoNextDelayMs,
    logLevel: DEFAULTS.logLevel,

    boardReplyInterval: clamp(DEFAULTS.boardReplyInterval, 0, 255),
    boardOutSens: clamp(DEFAULTS.boardOutSens, 0, 15),
    boardTargetSet: DEFAULTS.boardTargetSet,

    connected: false,
    lastBoardConfirm: "",

    // dart counter (for ignoring miss after 3 darts)
    dartCount: 0,

    // DE: letzter ermittelter View-Mode für Statusanzeige
    // EN: last resolved view mode for status display
    lastMode: "keyboard",
  };

  function createUI() {
    try { document.getElementById("__gb_overlay__")?.remove(); } catch {}
    try { document.getElementById("__gb_tab__")?.remove(); } catch {}

    const root = document.createElement("div");
    root.id = "__gb_overlay__";
    root.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "background:rgba(8,10,14,.30);backdrop-filter: blur(7px);-webkit-backdrop-filter: blur(7px);" +
      "color:#fff;padding:10px 12px;border-radius:14px;" +
      "font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "width:430px;max-width:calc(100vw - 24px);" +
      "box-shadow:0 10px 35px rgba(0,0,0,.30);" +
      "border:1px solid rgba(255,255,255,.14);";

    const tab = document.createElement("button");
    tab.id="__gb_tab__";
    tab.textContent="GB";
    tab.title="GranBoard overlay";
    tab.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "width:44px;height:44px;aspect-ratio:1/1;" +
      "padding:0;border-radius:50%;" +
      "display:none;align-items:center;justify-content:center;" +
      "border:2px solid rgba(255,80,80,.95);" +
      "background:rgba(8,10,14,.35);backdrop-filter: blur(7px);-webkit-backdrop-filter: blur(7px);" +
      "color:#fff;cursor:pointer;font:12px system-ui;" +
      "box-shadow:0 0 14px rgba(255,80,80,.35);";

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <div style="font-weight:700;font-size:14px;">GranBoard → Autodarts</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="gb-btn-settings" title="${t("settings")}" style="
            padding:6px 10px;height:28px;border-radius:10px;
            border:1px solid rgba(255,255,255,.16);
            background:rgba(255,255,255,.10);
            color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
            font-size:12px;font-weight:700;line-height:1;
          ">${t("settings")}</button>
          <button id="gb-btn-hide" title="${t("hide")}" style="
            padding:6px 10px;height:28px;border-radius:10px;
            border:1px solid rgba(255,255,255,.16);
            background:rgba(255,255,255,.10);
            color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
            font-size:12px;font-weight:700;line-height:1;
          ">${t("hide")}</button>
        </div>
      </div>

      <div style="margin-top:10px;opacity:.92;font-size:11px;">
        <div>Status: <span id="gb-status" style="font-weight:700;">disconnected</span></div>
        <div>Device: <span id="gb-device">—</span></div>
        <div>Mode: <span id="gb-mode">—</span></div>
        <div>Auto player next: <span id="gb-autonext">—</span></div>
        <div>RAW: <span id="gb-raw">—</span></div>
        <div>Action: <span id="gb-action">—</span></div>
      </div>

      <div style="margin-top:12px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
        <button id="gb-connect" style="
          padding:6px 12px;border-radius:12px;border:1px solid rgba(60,180,110,.50);
          cursor:pointer;background:rgba(60,180,110,.22);color:#fff;font-weight:700;
          font-size:12px;line-height:1.2;display:inline-block;min-width:132px;
        ">${t("connect")}</button>
</div>

      <div id="gb-settings" style="display:none;margin-top:12px;">
        
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <button class="gb-tab" data-tab="control" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-weight:700;cursor:pointer;font-size:12px;min-height:28px;">Control</button>
          <button class="gb-tab" data-tab="led" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-weight:700;cursor:pointer;font-size:12px;min-height:28px;">LED</button>
          <button class="gb-tab" data-tab="board" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-weight:700;cursor:pointer;font-size:12px;min-height:28px;">Board</button>
          <button class="gb-tab" data-tab="logs" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-weight:700;cursor:pointer;font-size:12px;min-height:28px;">Logs</button>
        </div>

        <div id="gb-tab-control" class="gb-tabpane" style="display:none;"></div>
        <div id="gb-tab-led" class="gb-tabpane" style="display:none;max-height:240px;overflow:auto;padding-right:6px;"></div>
        <div id="gb-tab-board" class="gb-tabpane" style="display:none;"></div>
        <div id="gb-tab-logs" class="gb-tabpane" style="display:none;"></div>
      </div>

      <div id="gb-log-wrap" style="margin-top:12px;max-height:200px;overflow:auto;font-size:11px;opacity:.92;display:none;">
        <div style="font-weight:700;margin-bottom:6px;">Log</div>
        <div id="gb-log"></div>
      </div>
    `;

    document.documentElement.appendChild(root);
    document.documentElement.appendChild(tab);

    const $ = (sel) => root.querySelector(sel);

    const logEl = $("#gb-log");
    function logLine(level, msg) {
      // level: "basic" | "adv"
      const ll = STATE.logLevel;
      if (ll === "off") return;
      if (ll === "basic" && level === "adv") return;

      $("#gb-log-wrap").style.display = (ll === "off") ? "none" : "block";

      const div = document.createElement("div");
      div.textContent = `[${ts()}] ${msg}`;
      logEl.prepend(div);
    }

    return {
      root,
      tab,
      btnHide: $("#gb-btn-hide"),
      btnSettings: $("#gb-btn-settings"),
      settingsWrap: $("#gb-settings"),
      connectBtn: $("#gb-connect"),
      status: $("#gb-status"),
      device: $("#gb-device"),
      mode: $("#gb-mode"),
      autonext: $("#gb-autonext"),
      raw: $("#gb-raw"),
      action: $("#gb-action"),

      tabButtons: Array.from(root.querySelectorAll(".gb-tab")),
      paneControl: $("#gb-tab-control"),
      paneLed: $("#gb-tab-led"),
      paneBoard: $("#gb-tab-board"),
      paneLogs: $("#gb-tab-logs"),

      logBasic: (m) => logLine("basic", m),
      logAdv: (m) => logLine("adv", m),
    };
  }

  let ui = createUI();

  function setOverlayVisible(v) {
    STATE.overlayVisible = !!v;
    saveBool(STORAGE.OVERLAY, STATE.overlayVisible);
    ui.root.style.display = STATE.overlayVisible ? "block" : "none";
    ui.tab.style.display = STATE.overlayVisible ? "none" : "flex";
    updateGbTabPosition();
  }

  function setSettingsOpen(v) {
    STATE.settingsOpen = !!v;
    ui.settingsWrap.style.display = STATE.settingsOpen ? "block" : "none";
    if (STATE.settingsOpen) activateSettingsTab("led");
  }

  function paintStatus() {
    ui.status.style.fontWeight = "900";
    if (STATE.connected) {
      ui.status.style.color = "rgba(60,220,120,.98)";
      ui.status.textContent = "connected";
    } else {
      ui.status.style.color = "rgba(255,80,80,.98)";
      ui.status.textContent = "disconnected";
    }
    ui.connectBtn.textContent = STATE.connected ? t("disconnect") : t("connect");
    ui.connectBtn.style.background = STATE.connected ? "rgba(255,90,90,.20)" : "rgba(60,180,110,.22)";
    ui.connectBtn.style.borderColor = STATE.connected ? "rgba(255,90,90,.50)" : "rgba(60,180,110,.50)";
    ui.tab.style.borderColor = STATE.connected ? "rgba(60,220,120,.95)" : "rgba(255,80,80,.95)";
    ui.tab.style.boxShadow = STATE.connected ? "0 0 14px rgba(60,220,120,.35)" : "0 0 14px rgba(255,80,80,.35)";
  }

  function activateSettingsTab(tabKey) {
    for (const b of ui.tabButtons) {
      const active = b.getAttribute("data-tab") === tabKey;
      b.style.background = active ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.08)";
      b.style.borderColor = active ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.16)";
    }
    ui.paneControl.style.display = (tabKey === "control") ? "block" : "none";
    ui.paneLed.style.display = (tabKey === "led") ? "block" : "none";
    ui.paneBoard.style.display = (tabKey === "board") ? "block" : "none";
    ui.paneLogs.style.display = (tabKey === "logs") ? "block" : "none";
  }

  ui.tabButtons.forEach(btn => btn.addEventListener("click", () => activateSettingsTab(btn.getAttribute("data-tab"))));

  ui.btnHide.addEventListener("click", () => setOverlayVisible(false));
  ui.tab.addEventListener("click", () => setOverlayVisible(true));
  ui.btnSettings.addEventListener("click", () => setSettingsOpen(!STATE.settingsOpen));
setOverlayVisible(STATE.overlayVisible);
  paintStatus();
  setAutoNextLabel();

  /********************************************************************
   * Hide-mode tab positioning vs Autodarts chat icon
   ********************************************************************/
  function isNearBottomRight(rect) {
    return (innerWidth - rect.right) < 140 && (innerHeight - rect.bottom) < 140;
  }

  function looksLikeChatIconButton(btn) {
    if (!btn || btn.tagName !== "BUTTON") return false;
    if (!isElementVisible(btn)) return false;
    const svg = btn.querySelector("svg[viewBox='0 0 24 24']");
    if (!svg) return false;
    const paths = Array.from(svg.querySelectorAll("path")).map(p => p.getAttribute("d") || "");
    return paths.some(d => d.includes("M20 2H4c-1.1"));
  }

  function findChatButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const b of buttons) {
      if (!looksLikeChatIconButton(b)) continue;
      const r = b.getBoundingClientRect();
      if (!isNearBottomRight(r)) continue;
      return b;
    }
    return null;
  }

  function resetGbTabToCorner() {
    ui.tab.style.left = "";
    ui.tab.style.top = "";
    ui.tab.style.right = "12px";
    ui.tab.style.bottom = "12px";
  }

  function anchorGbTabLeftOfChat(chatBtn) {
    const chatRect = chatBtn.getBoundingClientRect();
    const tabRect = ui.tab.getBoundingClientRect();
    const gap = 10;
    const x = Math.max(12, Math.round(chatRect.left - tabRect.width - gap));
    const y = Math.max(12, Math.round(chatRect.top + (chatRect.height - tabRect.height) / 2));
    ui.tab.style.right = "";
    ui.tab.style.bottom = "";
    ui.tab.style.left = x + "px";
    ui.tab.style.top = y + "px";
  }

  function updateGbTabPosition() {
    if (!ui?.tab) return;
    if (STATE.overlayVisible) {
      resetGbTabToCorner();
      return;
    }
    if (ui.tab.style.display === "none") return;

    const chatBtn = findChatButton();
    if (chatBtn) anchorGbTabLeftOfChat(chatBtn);
    else resetGbTabToCorner();
  }

  window.addEventListener("resize", () => setTimeout(updateGbTabPosition, 50), { passive: true });
  setInterval(updateGbTabPosition, 700);

  /********************************************************************
   * LED Presets (compatible to your HTML approach)
   ********************************************************************/
  function frame16(op){
    const u8 = new Uint8Array(16);
    u8[0]=op & 0xFF;
    u8[15]=0x01;
    return u8;
  }

  // Built-in “classic” frames you gave (connect/next/hit/miss)
  const PRESETS = [
    {
      key:"classic_connect",
      name:"Connect (Classic)",
      tag:"OP1D · 1 color (Color A)",
      colors:1,
      defaultSpeed:10,
      build:(speed, a)=>{
        // DE: Connect Classic erlaubt Color A (RGB in Bytes 1..3). Speed bleibt wie original.
        // EN: Connect classic supports Color A (RGB in bytes 1..3). Speed remains as in original frame.
        const u8 = hexToU8("1D 4D FF 00 00 00 00 00 00 00 00 00 0A 00 00 01");
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        return u8;
      }
    },
    {
      key:"classic_next",
      name:"Next (Classic)",
      tag:"OP11 · 2 colors + speed",
      colors:2,
      defaultSpeed:5,
      speedMax:35,
      build:(speed, a, b)=>{
        const u8 = frame16(0x11);
        // Color A
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        // Color B (fix: correct bytes so Color B works on board)
        u8[4]=b.r; u8[5]=b.g; u8[6]=b.b;
        // mode bytes
        u8[10]=0x10; u8[11]=0x00;
        // speed byte (0..35)
        u8[12]=clamp(speed,0,35) & 0xFF;
        return u8;
      }
    },
{
      key:"classic_hit_single",
      name:"Hit Single (Classic)",
      tag:"01 ... (color+speed fixed) · (dynamic target hit)",
      colors:2,
      defaultSpeed:20,
      build:(speed, a, b)=>{
        return hexToU8("01 FF 00 00 FF 95 00 00 00 00 1C 00 14 00 00 01");
      }
    },
    {
      key:"classic_hit_triple",
      name:"Hit Triple (Classic)",
      tag:"03 ... (corrected: triple) · (dynamic target hit)",
      colors:2,
      defaultSpeed:20,
      build:(speed, a, b)=>{
        return hexToU8("03 FF 00 00 FF 95 00 00 00 00 1C 00 14 00 00 01");
      }
},
    {
      key:"classic_hit_double",
      name:"Hit Double (Classic)",
      tag:"02 ... (corrected: double) · (dynamic target hit)",
      colors:2,
      defaultSpeed:20,
      build:(speed, a, b)=>{
        return hexToU8("02 FF 00 00 FF 95 00 00 00 00 1C 00 14 00 00 01");
      }
},
    {
      key:"classic_miss",
      name:"Miss (Classic Blink)",
      tag:"17 ... (blink) · color + speed",
      colors:1,
      defaultSpeed:4,
      build:(speed, a)=>{
        const u8 = frame16(0x17);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=clamp(speed,0,255);
        return u8;
      }
    },

    // ===== Presets from your HTML style (color+speed options) =====
    // Preset-Speed: 35 (slow) .. 0 (fast)  -> UI slider maps to this range
    {
      key:"op0c",
      name:"Touch Rainbow",
      tag:"OP0C · color + speed (board may ignore color)",
      colors:0,
      defaultSpeed:5,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x0C);
        u8[1]=0x00; u8[2]=0x00; u8[3]=0x00;
        u8[12]=clamp(speed,0,255);
        return u8;
      }
    },
    {
      key:"op0f",
      name:"Rainbow Rotate (3 Segments)",
      tag:"OP0F · color + speed",
      colors:0,
      defaultSpeed:5,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x0F);
        u8[1]=0x00; u8[2]=0x00; u8[3]=0x00;
        u8[12]=clamp(speed,0,255);
        return u8;
      }
    },
    {
      key:"op10",
      name:"Split Rainbow",
      tag:"OP10 · color + speed",
      colors:0,
      defaultSpeed:5,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x10);
        u8[1]=0x00; u8[2]=0x00; u8[3]=0x00;
        u8[12]=clamp(speed,0,255);
        return u8;
      }
    },
    {
      key:"op0d",
      name:"Rainbow Touch + Flicker",
      tag:"OP0D · rainbow + speed",
      colors:0,
      defaultSpeed:20,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x0D);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[11]=0x02;
        u8[12]=speed & 0xFF;
        u8[13]=0x02;
        return u8;
      }
    },
    {
      key:"op14",
      name:"Pulse",
      tag:"OP14 · color + speed",
      colors:1,
      defaultSpeed:20,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x14);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[4]=0x7D;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op15",
      name:"Dark Solid (Low Brightness)",
      tag:"OP15 · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x15);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op16",
      name:"Color Cycle",
      tag:"OP16 · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x16);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op17",
      name:"Flash / Blink",
      tag:"OP17 · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x17);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op18",
      name:"Flicker",
      tag:"OP18 · color + speed",
      colors:1,
      defaultSpeed:20,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x18);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op19",
      name:"Hunt Flicker",
      tag:"OP19 · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x19);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        // pattern/mode bytes like the working HTML version
        u8[11]=0x02;
        u8[12]=speed & 0xFF;
        u8[13]=0x02;
        return u8;
      }
    },
    {
      key:"op1b",
      name:"Shake",
      tag:"OP1B · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x1B);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op1d",
      name:"Fade / Sweep + Fade",
      tag:"OP1D · color + speed",
      colors:1,
      defaultSpeed:10,
      speedMax:35,
      build:(speed, a)=>{
        const u8 = frame16(0x1D);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    },
    {
      key:"op1f",
      name:"Bull Multicolor Fade (Classic)",
      tag:"OP1F · 3 colors + speed",
      colors:3,
      defaultSpeed:12,
      speedMax:35,
      build:(speed, a, b, c)=>{
        const u8 = frame16(0x1F);
        u8[1]=a.r; u8[2]=a.g; u8[3]=a.b;
        u8[4]=b.r; u8[5]=b.g; u8[6]=b.b;
        u8[7]=c.r; u8[8]=c.g; u8[9]=c.b;
        u8[12]=speed & 0xFF;
        return u8;
      }
    }
  ];

  function getPresetByKey(key) {
    return PRESETS.find(p => p.key === key) || PRESETS[0];
  }

  const REACTIONS = [
    { id:"connect",      label:"Connect" },
    { id:"next",         label:"Next" },
    { id:"next_online",  label:"Next (Online Player)" }, // DE/EN: opponent turn starts indicator
    { id:"bust",         label:"Bust" },

    { id:"hit_single",   label:"Hit Single" },
    { id:"hit_double",   label:"Hit Double" },
    { id:"hit_triple",   label:"Hit Triple" },
    { id:"miss",         label:"Miss" },
    { id:"bull_single",  label:"Single Bull" },
    { id:"bull_double",  label:"Double Bull" },
  ];

  
  function defaultReactionConfig(id) {
    // Defaults (aligned to your exported localStorage values)
    if (id === "connect") return { enabled:true, presetKey:"classic_connect", speed:10, colorA:"#2bff00", colorB:"#45e21d", colorC:"#00ffff" };
    if (id === "next") return { enabled:true, presetKey:"classic_next", speed:0, colorA:"#66ff00", colorB:"#05ebd0", colorC:"#00ffff" };
    if (id === "next_online") return { enabled:true, presetKey:"classic_next", speed:7, colorA:"#287ff0", colorB:"#0afe06", colorC:"#00ffff" };
    if (id === "bust") return { enabled:true, presetKey:"op18", speed:20, colorA:"#ff0000", colorB:"#00ffff", colorC:"#00ffff" };

    if (id === "hit_single") return { enabled:true, presetKey:"classic_hit_single", speed:17, colorA:"#ff0000", colorB:"#f2d95f", colorC:"#00ffff" };
    if (id === "hit_double") return { enabled:true, presetKey:"classic_hit_double", speed:20, colorA:"#ff0000", colorB:"#f5cc00", colorC:"#00ffff" };
    if (id === "hit_triple") return { enabled:true, presetKey:"classic_hit_triple", speed:20, colorA:"#ff0000", colorB:"#ffc800", colorC:"#00ffff" };

    if (id === "miss") return { enabled:true, presetKey:"op18", speed:15, colorA:"#5b057a", colorB:"#0011ff", colorC:"#00ffff" };
    if (id === "bull_single") return { enabled:true, presetKey:"op1f", speed:17, colorA:"#2a00fa", colorB:"#0f4fe6", colorC:"#14a0db" };
    if (id === "bull_double") return { enabled:true, presetKey:"op1f", speed:16, colorA:"#ff2600", colorB:"#f90101", colorC:"#aeff00" };

    return { enabled:false, presetKey:PRESETS[0].key, speed:10, colorA:"#ff0000", colorB:"#00ffff", colorC:"#00ffff" };
  }


  function loadReactionConfig(id) {
    try {
      const raw = localStorage.getItem(STORAGE.LED_REACTION_PREFIX + id);
      if (!raw) return defaultReactionConfig(id);
      const obj = JSON.parse(raw);
      const cfg = { ...defaultReactionConfig(id), ...obj };
      // migration: removed "Next (2-Segment)" preset -> map to classic_next
      if (cfg.presetKey === "op11_next") cfg.presetKey = "classic_next";
      return cfg;
    } catch {
      return defaultReactionConfig(id);
    }
  }

  function saveReactionConfig(id, cfg) {
    try { localStorage.setItem(STORAGE.LED_REACTION_PREFIX + id, JSON.stringify(cfg)); } catch {}
  }

  function buildLedFrameFromConfig(cfg) {
    const preset = getPresetByKey(cfg.presetKey);

    const a = parseHexColor(cfg.colorA);
    const b = parseHexColor(cfg.colorB);
    const c = parseHexColor(cfg.colorC);

    const max = (typeof preset.speedMax === "number") ? preset.speedMax : 255;
    const speed = clamp((cfg.speed ?? preset.defaultSpeed ?? 0), 0, max);

    // preset.colors: 0,1,2,3 ...
    if (preset.colors >= 3) return preset.build(speed, a, b, c);
    if (preset.colors >= 2) return preset.build(speed, a, b);
    if (preset.colors >= 1) return preset.build(speed, a);
    return preset.build(speed, a, b, c);
  }

  /********************************************************************
   * BLE
   ********************************************************************/
  let device = null;
  let server = null;
  let notifyChar = null;
  let writeChar = null;

  let streamBuffer = new Uint8Array(0);

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

  async function bleWrite(u8, tag) {
    if (!writeChar) return false;
    try {
      ui.logAdv(`TX (${tag||"write"}) HEX=${u8ToHex(u8)}`);
      if (writeChar.properties.writeWithoutResponse) await writeChar.writeValueWithoutResponse(u8);
      else await writeChar.writeValue(u8);
      return true;
    } catch (e) {
      ui.logAdv("TX failed: " + (e?.message || e));
      return false;
    }
  }

  async function dispatchLed(reactionId, reason, target) {
    if (!STATE.connected || !writeChar) return;

    const cfg = loadReactionConfig(reactionId);
    if (!cfg.enabled) return;

    const preset = getPresetByKey(cfg.presetKey);

    // Dynamic "Target Hit" frames (fix: was always lighting segment 1)
    // Mapping taken from the working LED Control HTML (S1..S20 -> target id).
    const SEG_TARGET_ID = {
      1:  0x001C,  2:  0x0031,  3:  0x0037,  4:  0x0022,  5:  0x0016,
      6:  0x0028,  7:  0x0001,  8:  0x0007,  9:  0x0010,  10: 0x002B,
      11: 0x000A, 12: 0x0013, 13: 0x0025, 14: 0x000D, 15: 0x002E,
      16: 0x0004, 17: 0x0034, 18: 0x001F, 19: 0x003A, 20: 0x0019,
    };

    function buildHitFrame(hitType, segN, colorA, colorB, speedByte) {
      const tid = SEG_TARGET_ID[segN] ?? 0x0000;
      const u8 = new Uint8Array(16);
      u8[0] = hitType & 0xFF;
      u8[1] = colorA.r; u8[2] = colorA.g; u8[3] = colorA.b;
      u8[4] = colorB.r; u8[5] = colorB.g; u8[6] = colorB.b;
      u8[10] = tid & 0xFF;
      u8[11] = (tid >> 8) & 0xFF;
      u8[12] = clamp(speedByte|0, 0, 255);
      u8[15] = 0x01;
      return u8;
    }

    let frame = null;

    // If the user kept the "classic hit" presets, we turn them into proper target-hit frames.
    if (preset.key && preset.key.startsWith("classic_hit_") && target && target.n >= 1 && target.n <= 20) {
      const a = parseHexColor(cfg.colorA || "#FF0000");
      const b = parseHexColor(cfg.colorB || "#FF7A00");
      const speed = clamp(cfg.speed ?? 20, 0, 255);

      if (reactionId === "hit_double") frame = buildHitFrame(0x02, target.n, a, b, speed);
      else if (reactionId === "hit_triple") frame = buildHitFrame(0x03, target.n, a, b, speed);
      else frame = buildHitFrame(0x01, target.n, a, b, speed);
    } else {
      frame = buildLedFrameFromConfig(cfg);
    }

    await bleWrite(frame, `LED:${reactionId}:${preset.key}`);
    if (reason) ui.logAdv(`LED ${reactionId} (${preset.key}) via ${reason}`);
  }

  /********************************************************************
   * Board Settings (BLE write frames)
   ********************************************************************/
  function buildReplyIntervalFrame(val) {
    // ends with ASCII "45" -> 0x34 0x35
    const u8 = new Uint8Array(12);
    u8[0]=clamp(val,0,255);
    u8[10]=0x34; u8[11]=0x35;
    return u8;
  }

  function buildOutSensFrame(val) {
    // ends with ASCII "67" -> 0x36 0x37
    const u8 = new Uint8Array(12);
    u8[0]=clamp(val,0,15);
    u8[10]=0x36; u8[11]=0x37;
    return u8;
  }

  const TARGET_SETS = {
    set1: hexToU8("00 00 00 4B 04 05 00 00 00 00 3A 3B"),
    set2: hexToU8("00 00 00 73 02 05 00 00 00 00 3A 3B"),
    set3: hexToU8("00 00 00 96 02 05 00 00 00 00 3A 3B"),
    set4: hexToU8("00 00 00 96 00 0A 00 00 00 00 3A 3B"),
  };

  async function applyBoardSetting(kind) {
    if (!STATE.connected || !writeChar) return false;

    if (kind === "reply") {
      const u8 = buildReplyIntervalFrame(STATE.boardReplyInterval);
      const ok = await bleWrite(u8, "Board:replyInterval");
      return ok;
    }
    if (kind === "out") {
      const u8 = buildOutSensFrame(STATE.boardOutSens);
      const ok = await bleWrite(u8, "Board:outSens");
      return ok;
    }
    if (kind === "set") {
      const u8 = TARGET_SETS[STATE.boardTargetSet] || TARGET_SETS.set2;
      const ok = await bleWrite(u8, "Board:targetSet");
      return ok;
    }
    return false;
  }

  /********************************************************************
   * UI: LED Tab + Board Tab + Logs Tab render
   ********************************************************************/
  function renderLogsTab() {
    ui.paneLogs.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;flex-direction:column;gap:6px;font-weight:800;">
          Log level
          <select id="gb-loglevel" style="padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-weight:700;">
            <option value="off">Off</option>
            <option value="basic">Basic</option>
            <option value="adv">Advanced</option>
          </select>
        </label>
      </div>
      `;
    const sel = ui.paneLogs.querySelector("#gb-loglevel");
    sel.value = STATE.logLevel;
    sel.addEventListener("change", () => {
      STATE.logLevel = sel.value || "basic";
      saveStr(STORAGE.LOG_LEVEL, STATE.logLevel);
      const lw = document.querySelector("#gb-log-wrap");
      if (lw) lw.style.display = (STATE.logLevel === "off") ? "none" : "block";
      ui.logAdv("LogLevel = " + STATE.logLevel);
    });
  }

  
  function renderControlTab() {
    ui.paneControl.innerHTML = `
      <div style="display:grid;gap:10px;">

        <div style="padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);">
          <div style="font-weight:900;margin-bottom:6px;">View mode automation</div>
          <div style="opacity:.85;font-size:11px;line-height:1.35;margin-bottom:10px;">
            <b>Auto</b> = Script decides automatically based on the current game / UI (Keyboard or Board).<br/>
            <b>Keyboard</b> = always stay in Keyboard view (number buttons).<br/>
            <b>Board</b> = always stay in Board view (segments).
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <select id="gb-control-inputmode" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-weight:700;min-width:160px;font-size:12px;min-height:28px;">
              <option value="auto">${t("auto")}</option>
              <option value="keyboard">${t("keyboard")}</option>
              <option value="board">${t("board")}</option>
            </select>
          </div>
        </div>

        <div style="padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);">
          <div style="font-weight:900;margin-bottom:6px;">Auto player change</div>
          <div style="opacity:.85;font-size:11px;line-height:1.35;margin-bottom:10px;">
            Automatically presses <b>NEXT</b> after your <b>3rd dart</b> was entered.<br/>
            Does <b>not</b> trigger for your online opponent.
          </div>

          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <select id="gb-control-autonext" style="padding:6px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-weight:700;min-width:160px;font-size:12px;min-height:28px;">
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>

            <div style="display:flex;gap:8px;align-items:center;flex:1;min-width:220px;">
              <input id="gb-control-autonext-delay" type="range" min="500" max="10000" step="500" value="${STATE.autoNextDelayMs}" style="flex:1;">
              <div id="gb-control-autonext-delay-val" style="min-width:64px;text-align:center;font-weight:700;opacity:.9;">${(STATE.autoNextDelayMs/1000).toFixed(1)}s</div>
            </div>
          </div>
        </div>

      </div>
    `;

    const sel = ui.paneControl.querySelector("#gb-control-inputmode");
    const autoSel = ui.paneControl.querySelector("#gb-control-autonext");
    const delayEl = ui.paneControl.querySelector("#gb-control-autonext-delay");
    const delayVal = ui.paneControl.querySelector("#gb-control-autonext-delay-val");

    if (sel) {
      sel.value = STATE.inputMode;
      sel.addEventListener("change", () => {
        STATE.inputMode = sel.value || "auto";
        saveStr(STORAGE.INPUT_MODE, STATE.inputMode);
        ui.logAdv("InputMode = " + STATE.inputMode);
      });
    }

    if (autoSel) {
      autoSel.value = STATE.autoNextMode || "off";
      autoSel.addEventListener("change", () => {
        STATE.autoNextMode = autoSel.value || "off";
        saveStr(STORAGE.AUTO_NEXT_MODE, STATE.autoNextMode);
        ui.logAdv("AutoNextMode = " + STATE.autoNextMode);
        setModeLabel(STATE.lastMode || "keyboard");
        setAutoNextLabel(); // refresh status lines
      });
    }

    if (delayEl && delayVal) {
      delayEl.value = String(STATE.autoNextDelayMs || 1500);
      delayVal.textContent = ((parseInt(delayEl.value,10)||1500)/1000).toFixed(1) + "s";

      delayEl.addEventListener("input", () => {
        const ms = clamp(parseInt(delayEl.value,10) || 1500, 500, 10000);
        STATE.autoNextDelayMs = ms;
        delayVal.textContent = (ms/1000).toFixed(1) + "s";
        saveStr(STORAGE.AUTO_NEXT_DELAY_MS, String(ms));
        setModeLabel(STATE.lastMode || "keyboard");
        setAutoNextLabel(); // refresh status lines
      });
    }
  }


function renderBoardTab() {
    ui.paneBoard.innerHTML = `
      <div style="display:grid;gap:10px;">
        <div style="padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);">
          <div style="font-weight:700;margin-bottom:6px;">Reply interval</div>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="gb-reply" type="range" min="0" max="12" value="${STATE.boardReplyInterval}" style="flex:1;">
            <div id="gb-reply-val" style="min-width:44px;text-align:center;font-weight:700;opacity:.9;">${STATE.boardReplyInterval}</div>
            <button id="gb-reply-apply" style="padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.10);color:#fff;font-weight:700;cursor:pointer;">Apply</button>
          </div>
          <div id="gb-reply-confirm" style="margin-top:6px;font-size:11px;opacity:.85;">Last confirm: <span id="gb-reply-confirm-txt">—</span></div>
        </div>

        <div style="padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);">
          <div style="font-weight:700;margin-bottom:6px;">Out sensitivity</div>
          <div style="display:flex;gap:10px;align-items:center;">
            <input id="gb-out" type="range" min="0" max="15" value="${STATE.boardOutSens}" style="flex:1;">
            <div id="gb-out-val" style="min-width:44px;text-align:center;font-weight:700;opacity:.9;">${STATE.boardOutSens}</div>
            <button id="gb-out-apply" style="padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.10);color:#fff;font-weight:700;cursor:pointer;">Apply</button>
          </div>
          <div id="gb-out-confirm" style="margin-top:6px;font-size:11px;opacity:.85;">Last confirm: <span id="gb-out-confirm-txt">—</span></div>
        </div>

        <div style="padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);">
          <div style="font-weight:700;margin-bottom:6px;">Target sensitivity (SET1–SET4)</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <select id="gb-set" style="padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-weight:700;min-width:132px;">
              <option value="set1">SET1</option>
              <option value="set2">SET2</option>
              <option value="set3">SET3</option>
              <option value="set4">SET4</option>
            </select>
            <button id="gb-set-apply" style="padding:8px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.10);color:#fff;font-weight:700;cursor:pointer;">Apply</button>
          </div>
</div>
      </div>
    `;

    const reply = ui.paneBoard.querySelector("#gb-reply");
    const replyVal = ui.paneBoard.querySelector("#gb-reply-val");
    const replyApply = ui.paneBoard.querySelector("#gb-reply-apply");
    const replyConfirmTxt = ui.paneBoard.querySelector("#gb-reply-confirm-txt");

    const out = ui.paneBoard.querySelector("#gb-out");
    const outVal = ui.paneBoard.querySelector("#gb-out-val");
    const outApply = ui.paneBoard.querySelector("#gb-out-apply");
    const outConfirmTxt = ui.paneBoard.querySelector("#gb-out-confirm-txt");

    const setSel = ui.paneBoard.querySelector("#gb-set");
    const setApply = ui.paneBoard.querySelector("#gb-set-apply");

    setSel.value = STATE.boardTargetSet;

    replyConfirmTxt.textContent = STATE.lastBoardConfirm || "—";
    outConfirmTxt.textContent = STATE.lastBoardConfirm || "—";

    reply.addEventListener("input", () => {
      STATE.boardReplyInterval = +reply.value;
      replyVal.textContent = String(STATE.boardReplyInterval);
      saveNum(STORAGE.BS_REPLY_INTERVAL, STATE.boardReplyInterval);
    });

    out.addEventListener("input", () => {
      STATE.boardOutSens = +out.value;
      outVal.textContent = String(STATE.boardOutSens);
      saveNum(STORAGE.BS_OUT_SENS, STATE.boardOutSens);
    });

    setSel.addEventListener("change", () => {
      STATE.boardTargetSet = setSel.value || "set2";
      saveStr(STORAGE.BS_TARGET_SET, STATE.boardTargetSet);
    });

    replyApply.addEventListener("click", async () => {
      const ok = await applyBoardSetting("reply");
      if (ok) replyConfirmTxt.textContent = ts();
      if (!ok) ui.logAdv("Board reply apply failed");
    });

    outApply.addEventListener("click", async () => {
      const ok = await applyBoardSetting("out");
      if (ok) outConfirmTxt.textContent = ts();
      if (!ok) ui.logAdv("Board out apply failed");
    });

    setApply.addEventListener("click", async () => {
      const ok = await applyBoardSetting("set");
      if (!ok) ui.logAdv("Board set apply failed");
    });
  }


  function renderLedTab() {
    // Helpers copied from the working GranBoard LED Control HTML
    function speedToHex(n){ return "0x" + (clamp(n|0,0,255)).toString(16).padStart(2,"0").toUpperCase(); }

    // Preset-Speed: 35 (slow) .. 0 (fast)  -> Slider left slow, right fast
    function presetSliderToSpeed(v0_100){
      const t = Math.min(100, Math.max(0, Number(v0_100))) / 100;
      const slow = 35, fast = 0;
      return Math.round(slow + (fast - slow) * t); // 35..0
    }
    function setPresetSliderDefault(sliderEl, defaultByte){
      defaultByte = clamp(defaultByte|0, 0, 35);
      let best=0, bestDiff=999;
      for(let i=0;i<=100;i++){
        const s=presetSliderToSpeed(i);
        const d=Math.abs(s-defaultByte);
        if(d<bestDiff){bestDiff=d;best=i;}
      }
      sliderEl.value = String(best);
    }

    const presetOptions = PRESETS.map(p => `<option value="${p.key}">${p.name}</option>`).join("");

    function reactionCard(r) {
      const cfg = loadReactionConfig(r.id);
      const preset = getPresetByKey(cfg.presetKey);

      const cA = cfg.colorA || "#FF0000";
      const cB = cfg.colorB || "#FF7A00";
      const cC = cfg.colorC || "#00FFFF";

      // For HTML-style presets we use 0..35 and map from 0..100.
      // For others, still show the same slider (sends 0..35), because most effects only use low bytes anyway.
      const spd = clamp(cfg.speed ?? preset.defaultSpeed ?? 10, 0, 35);

      const showA = (preset.colors || 0) >= 1;
      const showB = (preset.colors || 0) >= 2;
      const showC = (preset.colors || 0) >= 3;

      return `
        <div style="border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:12px;padding:10px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="font-weight:800;font-size:12px;">${r.label}</div>
            <label style="display:flex;gap:6px;align-items:center;font-weight:700;font-size:12px;cursor:pointer;">
              <input type="checkbox" data-led-enabled="${r.id}" ${cfg.enabled ? "checked":""}/>
              Enabled
            </label>
          </div>

          <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            <label style="display:flex;flex-direction:column;gap:6px;font-weight:700;font-size:12px;">
              Preset
              <select data-led-preset="${r.id}" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-weight:700;min-width:220px;">
                ${presetOptions}
              </select>
            </label>

            <label style="display:flex;flex-direction:column;gap:6px;font-weight:700;font-size:12px;">
              Speed
              <div style="display:flex;gap:8px;align-items:center;">
                <input data-led-speed="${r.id}" type="range" min="0" max="100" value="50" style="width:170px;">
                <div data-led-speedhex="${r.id}" style="min-width:54px;text-align:center;font-size:11px;opacity:.85;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 8px;background:rgba(0,0,0,.20);">${speedToHex(spd)}</div>
              </div>
            </label>

            <label data-led-wrap-cola="${r.id}" style="display:${showA ? "flex":"none"};flex-direction:column;gap:6px;font-weight:700;font-size:12px;">
              Color A
              <input data-led-cola="${r.id}" type="color" value="${cA}" style="width:40px;height:30px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;">
            </label>

            <label data-led-wrap-colb="${r.id}" style="display:${showB ? "flex":"none"};flex-direction:column;gap:6px;font-weight:700;font-size:12px;">
              Color B
              <input data-led-colb="${r.id}" type="color" value="${cB}" style="width:40px;height:30px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;">
            </label>

            <label data-led-wrap-colc="${r.id}" style="display:${showC ? "flex":"none"};flex-direction:column;gap:6px;font-weight:700;font-size:12px;">
              Color C
              <input data-led-colc="${r.id}" type="color" value="${cC}" style="width:40px;height:30px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:transparent;">
            </label>

            <button data-led-test="${r.id}" style="
              padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.16);
              background:rgba(255,255,255,.10);color:#fff;font-weight:700;font-size:12px;cursor:pointer;
              ${STATE.connected ? "" : "opacity:.45;pointer-events:none;"}
            ">Test</button>
          </div>

          <div data-led-hint="${r.id}" style="margin-top:8px;font-size:11px;opacity:.78;">—</div>
        </div>
      `;
    }

    ui.paneLed.innerHTML = REACTIONS.map(reactionCard).join("");

    // Bind UI
    for (const r of REACTIONS) {
      const enabledEl = ui.paneLed.querySelector(`[data-led-enabled="${r.id}"]`);
      const presetEl = ui.paneLed.querySelector(`[data-led-preset="${r.id}"]`);
      const speedEl = ui.paneLed.querySelector(`[data-led-speed="${r.id}"]`);
      const speedHexEl = ui.paneLed.querySelector(`[data-led-speedhex="${r.id}"]`);
      const colAEl = ui.paneLed.querySelector(`[data-led-cola="${r.id}"]`);
      const colBEl = ui.paneLed.querySelector(`[data-led-colb="${r.id}"]`);
      const colCEl = ui.paneLed.querySelector(`[data-led-colc="${r.id}"]`);
      const testEl = ui.paneLed.querySelector(`[data-led-test="${r.id}"]`);
      const hintEl = ui.paneLed.querySelector(`[data-led-hint="${r.id}"]`);

      const cfg = loadReactionConfig(r.id);
      presetEl.value = cfg.presetKey;

      // init slider based on saved speed byte (0..35)
      setPresetSliderDefault(speedEl, clamp(cfg.speed ?? 10, 0, 35));
      speedHexEl.textContent = speedToHex(presetSliderToSpeed(speedEl.value));

      function saveFromUi() {
        const c = loadReactionConfig(r.id);
        c.enabled = !!enabledEl.checked;
        c.presetKey = presetEl.value;
        c.speed = presetSliderToSpeed(speedEl.value); // store byte 35..0
        if (colAEl) c.colorA = colAEl.value;
        if (colBEl) c.colorB = colBEl.value;
        if (colCEl) c.colorC = colCEl.value;
        saveReactionConfig(r.id, c);
      }

      function refreshHint() {
        const c = loadReactionConfig(r.id);
        const preset = getPresetByKey(c.presetKey);
        hintEl.textContent = `${preset.name} — ${preset.tag || ""}`.trim();
      }
      refreshHint();

      enabledEl.addEventListener("change", () => { saveFromUi(); });
      presetEl.addEventListener("change", () => { saveFromUi(); renderLedTab(); });
      speedEl.addEventListener("input", () => { speedHexEl.textContent = speedToHex(presetSliderToSpeed(speedEl.value)); saveFromUi(); });
      colAEl?.addEventListener("input", saveFromUi);
      colBEl?.addEventListener("input", saveFromUi);
      colCEl?.addEventListener("input", saveFromUi);

      testEl.addEventListener("click", async () => {
        saveFromUi();

        // For Hit-Single/Double/Triple tests we always use Segment 1,
        // but still respect the chosen Color A / Color B (and speed).
        const testTarget = (r.id === "hit_single" || r.id === "hit_double" || r.id === "hit_triple")
          ? { n: 1 }
          : null;

        await dispatchLed(r.id, "test", testTarget);
      });
    }
  }


  function renderAllSettingsTabs() {
    renderControlTab();
    renderLedTab();
    renderBoardTab();
    renderLogsTab();
  }

  renderAllSettingsTabs();

  /********************************************************************
   * Online Gegner: Turn-Counter ("turn-points") beobachten
   * DE: Wenn der Counter von >0 auf 0 springt, war sehr wahrscheinlich der Gegner "Next".
   *     Optionales LED-Event: next_online
   * EN: When the counter transitions from >0 to 0, opponent likely pressed "Next".
   *     Optional LED event: next_online
   ********************************************************************/
  (function watchTurnPointsForOpponentNext() {
    let lastVal = null;
    let lastZeroAt = 0;
    let lastOpponentBustAt = 0; // timestamp of last opponent BUST seen (ms)

    function readTurnPointsEl() {
      // DE: robust gegen wechselnde CSS-Hashes, sucht nach class-Teilstring
      // EN: robust against changing CSS hashes, searches by class substring
      const els = Array.from(document.querySelectorAll("p.chakra-text"));
      return els.find(el => (el.className || "").includes("ad-ext-turn-points")) || null;
    }

    function readTurnText(el) {
      return String(el?.textContent || "").trim();
    }

    function isBustText(txt) {
      const u = (txt || "").trim().toUpperCase();
      return (u === "BUST" || u === "BUSTED" || u.includes("BUST"));
    }

    function parseValFromText(txt) {
      const n = parseInt(String(txt || "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    }

    function tick() {
      const el = readTurnPointsEl();
      if (!el) return;

      const txt = readTurnText(el);
      const now = Date.now();

            const undoWindowMs = 1200;
      const wasUndo = (now - (__lastUndoAt || 0)) < undoWindowMs;

// 2) Bust detection (local) + optional LED + AutoNext
      if (isBustText(txt)) {
        const localWindowMs = 1500; // must be close to our last local throw
        const debounceMs = 900;

        const isLocal = (now - (__lastLocalThrowAt || 0)) < localWindowMs;
        const debounced = (now - (__lastBustAt || 0)) < debounceMs;

        // If it's NOT local, remember it as an opponent bust so we can trigger next_online
        // even if the counter resets to 0 without a >0 -> 0 transition.
        if (!isLocal) {
          const oppDebounceMs = 800;
          if ((now - (lastOpponentBustAt || 0)) > oppDebounceMs) {
            lastOpponentBustAt = now;
          }
        }

        if (isLocal && !debounced) {
          __lastBustAt = now;

          // optional LED event (default: disabled)
          dispatchLed("bust", "bust").catch(()=>{});

          // Bust ends the turn immediately
          resetDartCounter("BUST");

          // AutoNext should also run on bust if enabled
          scheduleAutoNext("bust");
          try { ui?.logAdv?.("BUST detected (local) -> optional LED bust + AutoNext"); } catch(e) {}
        }
        return; // do not treat bust as opponent-next signal
      }

      const v = parseValFromText(txt);
      if (v == null) return;

      if (lastVal == null) lastVal = v;

      const localWindowMs = 1200; // DE: Fenster in dem wir "Next" selbst waren | EN: window where we consider it local next
      const debounceMs = 800;     // DE/EN: verhindert Spam

      const becameZero = (v === 0 && lastVal > 0);
      const wasLocal = (now - __localNextAt) < localWindowMs;
      const debounced = (now - lastZeroAt) < debounceMs;

      const oppBustWindowMs = 2500;
      const bustToZero = (v === 0 && (now - (lastOpponentBustAt || 0)) < oppBustWindowMs);

      if ((becameZero || bustToZero) && !wasLocal && !debounced && !wasUndo) {
        lastZeroAt = now;
        if (bustToZero) lastOpponentBustAt = 0;

        // DE: nur ausführen, wenn User es in LEDs aktiviert hat (default: off)
        // EN: only fires if user enabled it in LEDs (default: off)
        dispatchLed("next_online", "opponent_next").catch(()=>{});
        try { ui?.logAdv?.("Opponent next detected via turn counter reset -> LED next_online"); } catch(e) {}
      }

      lastVal = v;
    }

    // DE: Polling ist in SPAs am zuverlässigsten; Observer macht es schneller
    // EN: polling is most reliable in SPAs; observer speeds it up
    setInterval(tick, 250);

    const obs = new MutationObserver(() => tick());
    obs.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  })();

  /********************************************************************
   * New game detection (fallback)
   * DE: Manche Game-Starts werden nicht über Button-Clicks erkannt (SPA / quick restart).
   *     Wenn die Round-Anzeige wieder auf R1/x springt, resetten wir dartCount.
   * EN: Some game starts are not captured by button clicks (SPA / quick restart).
   *     If the round indicator jumps back to R1/x, reset dartCount.
   ********************************************************************/
  (function watchRoundIndicatorForNewGame() {
    let lastR = null;
    let lastResetAt = 0;

    function readRoundText() {
      // Typical indicator looks like: "R1/8" (sometimes with spaces).
      const re = /\bR\s*\d+\s*\/\s*\d+\b/i;
      // Prefer small text nodes (Chakra) first to keep scanning cheap.
      const candidates = Array.from(document.querySelectorAll('p,span,div,button')).slice(0, 400);
      for (const el of candidates) {
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        if (!re.test(txt)) continue;
        // Reduce false-positives by requiring visibility (header only).
        if (!isElementVisible(el)) continue;
        const m = txt.match(re);
        if (m) return m[0].replace(/\s+/g, '');
      }
      return null;
    }

    function tick() {
      const now = Date.now();
      const r = readRoundText();
      if (!r) return;

      // When it jumps to R1/... after being something else -> new game / leg restart.
      const isR1 = /^R1\//i.test(r);
      const wasDifferent = (lastR != null && lastR !== r);
      const debounce = (now - lastResetAt) < 1500;

      if (isR1 && wasDifferent && !debounce) {
        lastResetAt = now;
        resetDartCounter('ROUND_RESET');
        ui?.logAdv?.('Round indicator reset -> DartCounter reset');
      }

      lastR = r;
    }

    setInterval(tick, 600);
    const obs = new MutationObserver(() => tick());
    obs.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  })();



  /********************************************************************
   * Click injection (Keyboard)
   ********************************************************************/
  async function clickMiss() {
    const btn = findBtnByExactTextAny(["Miss"]);
    if (isClickableButton(btn)) btn.click();
  }
  async function click25() {
    const btn = findBtnByExactTextAny(["25"]);
    if (isClickableButton(btn)) btn.click();
  }

  async function clickBull50OrFallback(preferDouble25 = true) {
    // Some keypad variants require: DOUBLE -> 25 for DBull (50).
    // Others have a direct "Bull" button. We try the safest option first.

    const dbl = findBtnByExactTextAny(["Double"]);
    const b25 = findBtnByExactTextAny(["25"]);
    const bullBtn = findBtnByExactTextAny(["Bull"]);

    // Preferred path (works on keypads where Bull is NOT a direct 50 input)
    if (preferDouble25 && isClickableButton(dbl) && isClickableButton(b25)) {
      dbl.click();
      await sleep(200);
      b25.click();
      return true;
    }

    // Direct Bull button (some keypads use this for 50)
    if (isClickableButton(bullBtn)) {
      bullBtn.click();
      return true;
    }

    // Fallback: DOUBLE -> 25 if available
    if (isClickableButton(dbl) && isClickableButton(b25)) {
      dbl.click();
      await sleep(200);
      b25.click();
      return true;
    }

    return false;
  }


  async function clickWithModifier(kind, n) {
    const modLabel = (kind === "D") ? "Double" : "Triple";
    const modBtn = findBtnByExactTextAny([modLabel]);
    if (!isClickableButton(modBtn)) return false;

    modBtn.click();
    await sleep(200);

    const btn = findBtnByExactTextAny([kind + n]);
    if (isClickableButton(btn)) { btn.click(); return true; }
    return false;
  }

  function isAllowedForAction(allowed, action) {
    if (!action) return false;
    if (allowed.has(action)) return true;

    if (/^D\d{1,2}$/.test(action) && allowed.has("DOUBLE_MOD")) return true;
    if (/^T\d{1,2}$/.test(action) && allowed.has("TRIPLE_MOD")) return true;

    if (action === "BULL" && allowed.has("DOUBLE_MOD") && allowed.has("25")) return true;
    return false;
  }

  async function clickAction(action) {
    if (action === "NEXT") {
      const btn = findNextButton();
      if (isClickableButton(btn)) btn.click();
      return true;
    }
    if (action === "MISS") { await clickMiss(); return true; }
    if (action === "25") { await click25(); return true; }
    if (action === "BULL") { return await clickBull50OrFallback(true); }

    const direct = findBtnByExactTextAny([action]);
    if (isClickableButton(direct)) { direct.click(); return true; }

    const m = action.match(/^([DT])(\d{1,2})$/);
    if (m) return await clickWithModifier(m[1], m[2]);

    return false;
  }

  /********************************************************************
   * Mode resolve + injection pipeline (AutoView included)
   ********************************************************************/
  function resolveMode(allowed) {
    if (STATE.inputMode === "keyboard") return "keyboard";
    if (STATE.inputMode === "board") return "board";
    // auto:
    return allowedHasAnyNumbers(allowed) ? "keyboard" : "board";
  }

  let lastInjectAt = 0;

  function setModeLabel(mode) {
    // DE: Nur den aktuellen View-Mode anzeigen (Keyboard/Board).
    // EN: Show only the current view mode (keyboard/board).
    const base = (mode === "board") ? "Boardview" : "Keyboardview";
    STATE.lastMode = mode;
    ui.mode.textContent = base;
  }

  function setAutoNextLabel() {
    // DE: Auto Player Next separat anzeigen (On/Off + Sekunden).
    // EN: Show auto player next separately (on/off + seconds).
    if (!ui.autonext) return;
    if (STATE.autoNextMode === "on") {
      const s = (clamp(STATE.autoNextDelayMs || 1500, 500, 10000) / 1000).toFixed(1);
      ui.autonext.textContent = `On (${s}s)`;
    } else {
      ui.autonext.textContent = "Off";
    }
  }

  function resetDartCounter(reason) {
    STATE.dartCount = 0;
    // DE: Falls AutoNext geplant war, abbrechen
    // EN: Cancel any pending AutoNext
    if (__autoNextTimer) { try { clearTimeout(__autoNextTimer); } catch {} __autoNextTimer = null; }
    ui.logAdv("DartCounter reset (" + reason + ")");
  }

  function incDartCounter() {
    STATE.dartCount = clamp(STATE.dartCount + 1, 0, 99);
  }


function scheduleAutoNext(reason) {
  // DE/EN: Generic AutoNext scheduler (used for 3rd dart and for BUST)
  if (STATE.autoNextMode !== "on") return;
  if (__autoNextTimer) return; // already scheduled

  const delay = clamp(STATE.autoNextDelayMs || 1500, 500, 10000);
  ui.logAdv(`AutoNext scheduled in ${delay}ms (${reason || "signal"})`);

  __autoNextTimer = setTimeout(async () => {
    __autoNextTimer = null;

    try {
      ui.action.textContent = "NEXT";
      // DE: LED priorisieren.
      // EN: Prioritize LED.
      dispatchLed("next", "auto_next").catch(()=>{});
      await sleep(0);

      const ok = await clickAction("NEXT");
      if (ok) {
        __localNextAt = Date.now(); // treat as local NEXT
        resetDartCounter("AUTO_NEXT");
      }
    } catch (e) {
      ui.logAdv("AutoNext error: " + (e?.message || e));
    }
  }, delay);
}

function maybeScheduleAutoNextAfterThirdDart() {
  // DE: Auto Player Change = nach 3 Darts automatisch NEXT drücken (nur lokale Eingabe)
  // EN: Auto player change = press NEXT automatically after 3 darts (local input only)
  if (STATE.dartCount !== 3) return;
  scheduleAutoNext("third_dart");
}


  async function injectTarget(target, sourceLabel) {
    const now = Date.now();
    if (now - lastInjectAt < CONFIG.minMsBetweenThrows) return;
    lastInjectAt = now;

    const allowed = getAllowedActions();

    // 1) Opponent-turn detection (Keyboardview without keypad/buttons)
    if (isOpponentTurnKeyboardNoButtons(allowed)) {
      ui.logAdv("Opponent turn detected (keyboard view without input buttons) -> ignore input");
      ui.action.textContent = "—";
      ui.raw.textContent = sourceLabel || "BLE";
      return;
    }

    const mode = resolveMode(allowed);
    setModeLabel(mode);
    setAutoNextLabel();

    ui.raw.textContent = sourceLabel || "BLE";

    // special: Next button
    if (target && target.__specialNext) {
      ui.action.textContent = "NEXT";
      // DE: LED priorisieren (nicht auf DOM-Click warten).
      // EN: Prioritize LED (do not wait for DOM click).
      dispatchLed("next", "next", target).catch(()=>{});
      await sleep(0);
      const ok = await clickAction("NEXT");
      if (ok) {
        __localNextAt = Date.now(); // DE: wir haben Next gedrückt | EN: we pressed Next
        resetDartCounter("NEXT");
      }
      return;
    }

    // ignore miss after 3 darts (your request)
    if (target.ring === "OUT" && STATE.dartCount >= 3) {
      ui.logAdv("MISS ignored (dartCount >= 3)");
      return;
    }

    // always count darts for hit/bull/miss once processed (not for ignored)
    incDartCounter();
    __lastLocalThrowAt = Date.now();

    // LED hit dispatch (before UI click, but same outcome for preview)
    // DE: LED soll "sofort" raus — nicht auf Autodarts DOM/Clicks warten.
    // EN: Send LED "immediately" — do not block on Autodarts DOM/click work.
    if (target.ring === "SBULL") dispatchLed("bull_single", "hit", target).catch(()=>{});
    else if (target.ring === "DBULL") dispatchLed("bull_double", "hit", target).catch(()=>{});
    else if (target.ring === "OUT") dispatchLed("miss", "hit", target).catch(()=>{});
    else if (target.ring === "D") dispatchLed("hit_double", "hit", target).catch(()=>{});
    else if (target.ring === "T") dispatchLed("hit_triple", "hit", target).catch(()=>{});
    else dispatchLed("hit_single", "hit", target).catch(()=>{});
    await sleep(0);

    const kbAction = targetToKeyboardAction(target);
    ui.action.textContent = kbAction || "—";

    if (mode === "keyboard") {
      // AutoView: ensure keyboard
      await ensureKeyboardView(ui.logAdv).catch(() => {});
      const hasNumbers = allowedHasAnyNumbers(allowed);

      // Box27: no keypad numbers -> switch to board and fire there
      if (!hasNumbers) {
        ui.logAdv("AutoView: no keypad numbers -> switch to Board view");
        await ensureBoardView(ui.logAdv).catch(() => {});
        await sleep(CONFIG.uiSwitchWaitMs);

        const bk = BOARD.targetToBoardKind(target);
        if (bk) {
          try { await BOARD.fire(bk.kind, bk.n || 0); } catch (e) { ui.logAdv("Board fire error: " + (e?.message || e)); }
        }
        return;
      }

      if (!isAllowedForAction(allowed, kbAction)) {
        ui.logAdv("Not allowed on keypad: " + kbAction + " -> MISS");
        await clickAction("MISS");
        return;
      }

      const ok = await clickAction(kbAction);
      if (!ok) {
        ui.logAdv("Keyboard click failed: " + kbAction + " -> MISS");
        await clickAction("MISS");
      }

      // DE/EN: after local 3rd dart entry we can auto-press NEXT
      maybeScheduleAutoNextAfterThirdDart();
      return;
    }

    // mode === board
    await ensureBoardView(ui.logAdv).catch(() => {});
    const bk = BOARD.targetToBoardKind(target);
    if (!bk) {
      ui.logAdv("Board: unknown -> MISS");
      try { await BOARD.fire("MISS", 0); } catch {}
      return;
    }
    try {
      await BOARD.fire(bk.kind, bk.n || 0);
      // DE/EN: after local 3rd dart entry we can auto-press NEXT
      maybeScheduleAutoNextAfterThirdDart();
    } catch (e) {
      ui.logAdv("Board fire error: " + (e?.message || e));
      await clickAction("MISS");
    }
  }

  /********************************************************************
   * BLE notify handler
   ********************************************************************/
  function onNotify(event) {
    const u8 = new Uint8Array(event.target.value.buffer);
    appendToBuffer(u8);

    // Advanced: show notify chunks
    ui.logAdv("RX (notify chunk) HEX=" + u8ToHex(u8) + " ASCII=" + bytesToAsciiVisible(u8));

    for (const f of extractFrames()) {
      const raw = bytesToAsciiVisible(f);
      // Basic: show frames with timestamp
      ui.logBasic("RX " + raw + "  (HEX " + u8ToHex(f) + ")");

      (async () => {
        let cleaned = String(raw || "").trim();

        // strip prefix if it exists
        const idx = cleaned.indexOf(CONFIG.CONNECT_PREFIX);
        if (idx !== -1) {
          const before = cleaned;
          cleaned = cleaned.slice(idx + CONFIG.CONNECT_PREFIX.length);
          if (!cleaned) return;
          if (!cleaned.endsWith("@") && raw.endsWith("@")) cleaned += "@";
          ui.logAdv(`Prefix stripped: "${before}" -> "${cleaned}"`);
        }

        ui.raw.textContent = cleaned;

        // Board confirm: "write OK"
        if (cleaned.toUpperCase().includes("WRITE OK")) {
          // only use this for slider settings visually (we keep single store, UI shows it on sliders)
          STATE.lastBoardConfirm = ts() + " · write OK";
          ui.logBasic("Board confirm: write OK");
          // refresh board tab if open (to update confirm text)
          if (STATE.settingsOpen) renderBoardTab();
          return;
        }

        // Next button on board
        if (cleaned === "BTN@") {
          await injectTarget({ __specialNext: true }, "BLE");
          return;
        }

        const target = RAW_TO_TARGET.get(cleaned);
        if (!target) {
          ui.logAdv('Unknown RAW "' + cleaned + '"');
          ui.action.textContent = "—";
          return;
        }

        await injectTarget(target, "BLE");
      })().catch(e => ui.logAdv("handleRawFrame error: " + (e?.message || e)));
    }
  }

  /********************************************************************
   * Connect / Disconnect
   ********************************************************************/
  async function connectGranBoard() {
    if (!navigator.bluetooth) {
      ui.logAdv("WebBluetooth not available.");
      return;
    }
    if (STATE.connected) return;

    ui.logBasic("Connect… (opening BLE pairing)");

    try {
      // request device (prefer namePrefix)
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

      device.addEventListener("gattserverdisconnected", () => {
        ui.logBasic("BLE disconnected.");
        server = null;
        notifyChar = null;
        writeChar = null;
        STATE.connected = false;
        paintStatus();
        renderLedTab();
      }, { once: true });

      server = await device.gatt.connect();
      const service = await server.getPrimaryService(CONFIG.VENDOR_SERVICE);
      const chars = await service.getCharacteristics();

      const notifyCandidates = chars.filter(c => c.properties.notify || c.properties.indicate);
      if (!notifyCandidates.length) throw new Error("No notify characteristic found.");
      notifyChar = notifyCandidates.find(c => c.properties.notify) || notifyCandidates[0];

      const writeCandidates = chars.filter(c => c.properties.write || c.properties.writeWithoutResponse);
      writeChar = writeCandidates.find(c => c.uuid !== notifyChar.uuid) || writeCandidates[0] || null;

      streamBuffer = new Uint8Array(0);

      await notifyChar.startNotifications();
      notifyChar.addEventListener("characteristicvaluechanged", onNotify);

      STATE.connected = true;
      paintStatus();
      ui.logBasic("Connected.");

      // AutoView: ensure keyboard after connect
      await ensureKeyboardView(ui.logAdv).catch(()=>{});

      // LED connect effect
      await dispatchLed("connect", "connect");

      // Re-render LED tab to enable Test buttons
      renderLedTab();
    } catch (e) {
      ui.logBasic("Connect error: " + (e?.message || e));
      STATE.connected = false;
      paintStatus();
      renderLedTab();
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
      writeChar = null;
      device = null;
      streamBuffer = new Uint8Array(0);

      ui.device.textContent = "—";
      ui.raw.textContent = "—";
      ui.action.textContent = "—";
      ui.mode.textContent = "—";

      STATE.connected = false;
      paintStatus();
      renderLedTab();
      ui.logBasic("Disconnected.");
    }
  }

  ui.connectBtn.addEventListener("click", () => {
    if (STATE.connected) disconnectGranBoard();
    else connectGranBoard();
  });

  /********************************************************************
   * SPA persistence (Autodarts navigation)
   ********************************************************************/
  function ensureUIAttached() {
    if (!document.getElementById("__gb_overlay__") || !document.getElementById("__gb_tab__")) {
      ui = createUI();
      setOverlayVisible(STATE.overlayVisible);
      paintStatus();
      renderAllSettingsTabs();

      ui.btnHide.addEventListener("click", () => setOverlayVisible(false));
      ui.tab.addEventListener("click", () => setOverlayVisible(true));
      ui.btnSettings.addEventListener("click", () => setSettingsOpen(!STATE.settingsOpen));
ui.connectBtn.addEventListener("click", () => {
        if (STATE.connected) disconnectGranBoard();
        else connectGranBoard();
      });

      ui.tabButtons.forEach(btn => btn.addEventListener("click", () => activateSettingsTab(btn.getAttribute("data-tab"))));

      setTimeout(updateGbTabPosition, 80);
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