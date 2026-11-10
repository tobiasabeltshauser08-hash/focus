import * as db from "./db.js";
import { Recorder, FramePlayer, exportTimelapse, thumbnail, extOf } from "./recorder.js";
import { SUBJECTS, DURATIONS, TL_FPS, timelapseInterval, fmtClock, fmtDur, fmtBytes, summary } from "./stats.js";
import { isNative, Blocker } from "./native.js";
import { selection, blockable, appsText, remainText, PERM_STEPS, missingForBlock } from "./blocker.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  flip: svg('<path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2M20 4v4h-4M4 20v-4h4"/>'),
  play: svg('<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>'),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/>'),
  down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  cam: svg('<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 11l5-3v9l-5-3"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
};
const EMBLEM = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>';
const MODES = { timelapse: ["Zeitraffer", "ca. 1 min Video"], video: ["Echtzeit", "volles Video"], none: ["Ohne Kamera", "nur Timer"] };

// ---------- Einstellungen (nur Komfort, darf fehlen) ----------
const PREFS_KEY = "focus-prefs";
const prefs = { min: 45, subject: SUBJECTS[0], mode: "timelapse", audio: false, facing: "user" };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };

// ---------- Android-App: App-Sperre (nur wenn nativ) ----------
const NATIVE = isNative();
const NATIVE_KEY = "focus-native";
const nat = { setupDone: false, blocked: null };  // blocked: gespeicherte Paketliste oder null = Standard
try { Object.assign(nat, JSON.parse(localStorage.getItem(NATIVE_KEY)) || {}); } catch (e) {}
const saveNat = () => { try { localStorage.setItem(NATIVE_KEY, JSON.stringify(nat)); } catch (e) {} };
let nativeApps = null, perms = {};
const loadApps = () => nativeApps ? Promise.resolve(nativeApps) : Blocker.apps().then(a => (nativeApps = a.sort((x, y) => x.label.localeCompare(y.label, "de"))));
const blockedPkgs = () => nativeApps ? selection(nativeApps, nat.blocked) : [];
const refreshPerms = async () => { try { perms = await Blocker.permissions(); } catch (e) { perms = {}; } return perms; };

const VIEWS = ["home", "setup", "session", "summary", "detail", "perms"];
function show(v) { VIEWS.forEach(x => { $("#" + x).hidden = x !== v; }); window.scrollTo(0, 0); }

let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }

// ---------- Kamera ----------
let stream = null;
function stopStream() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
async function getStream() {
  const wantAudio = prefs.mode === "video" && prefs.audio;
  if (stream && stream.getAudioTracks().length > 0 === wantAudio && stream.facing === prefs.facing && stream.active) return stream;
  stopStream();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: prefs.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
    audio: wantAudio,
  });
  stream.facing = prefs.facing;
  return stream;
}
const videoEl = cls => `<video autoplay muted playsinline class="${prefs.facing === "user" ? "mirror" : ""} ${cls || ""}"></video>`;
function videoReady(v) {
  return v.readyState >= 2 ? Promise.resolve() : new Promise(res => { v.addEventListener("loadeddata", res, { once: true }); setTimeout(res, 3000); });
}

// ---------- Ton, Vibration, Bildschirm an ----------
let actx = null, wake = null;
function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} }
function beep(f = 880, d = .2, at = 0) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + at;
    o.frequency.value = f; g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}
const vibrate = p => { try { navigator.vibrate?.(p); } catch (e) {} };
async function requestWake() { try { wake = await navigator.wakeLock?.request("screen"); } catch (e) { wake = null; } }
function releaseWake() { try { wake?.release(); } catch (e) {} wake = null; }

// ---------- Startseite ----------
let objectUrl = null;
const when = ts => new Date(ts).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function renderHome() {
  show("home");
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  const list = (await db.all("sessions")).sort((a, b) => b.start - a.start);
  const st = summary(list), max = Math.max(1800, ...st.last7.map(d => d.sec));
  const used = list.reduce((a, s) => a + (s.bytes || 0), 0);
  let storage = list.length ? `Aufnahmen belegen ${fmtBytes(used)}` : "";
  try { const e = await navigator.storage?.estimate(); if (e && list.length) storage += ` · noch ca. ${fmtBytes(e.quota - e.usage)} frei`; } catch (e) {}

  $("#home").innerHTML = `
    <header class="top"><div class="emblem" aria-hidden="true">${EMBLEM}</div><div><h1 class="brand">Focus</h1><p class="top-sub">${st.streak ? `${st.streak} ${st.streak === 1 ? "Tag" : "Tage"} in Folge gelernt` : "Lern-Sessions mit Kamera"}</p></div></header>
    <section class="stats" aria-label="Lernzeit">
      <div><small>Heute</small><b>${fmtDur(st.todaySec)}</b></div>
      <div><small>Diese Woche</small><b>${fmtDur(st.weekSec)}</b></div>
      <div><small>Serie</small><b>${st.streak} ${st.streak === 1 ? "Tag" : "Tage"}</b></div>
    </section>
    <section class="week" aria-label="Lernzeit der letzten 7 Tage">
      <div class="bars">${st.last7.map(d => `<div class="${d.today ? "today" : ""}" title="${fmtDur(d.sec)}"><i class="${d.sec ? "" : "zero"}" style="height:${d.sec ? Math.max(6, d.sec / max * 100) : 4}%"></i><span>${d.label}</span></div>`).join("")}</div>
      <div class="bars-cap"><span>Letzte 7 Tage</span><span>${fmtDur(st.last7.reduce((a, d) => a + d.sec, 0))}</span></div>
    </section>
    <button type="button" class="btn-big" data-a="setup"><span class="dot"></span>Focus-Session starten</button>
    ${NATIVE ? blockCard("Während der Session gesperrt") : `<button type="button" class="pin-card" data-a="pin"><span class="ic">${ICON.lock}</span><span><b>Handy während der Session sperren</b><small>Mit „App anheften“ kommst du nur mit deiner PIN raus</small></span></button>`}
    <section>
      <div class="sec-h"><h2>Deine Sessions</h2><span>${st.count} gesamt</span></div>
      ${list.length ? `<div class="list">${list.map(sessionCard).join("")}</div>` : `<div class="empty">Noch keine Session. Starte deine erste, dann erscheint sie hier mit Aufnahme.</div>`}
      ${storage ? `<p class="hint" style="margin-top:10px">${storage}</p>` : ""}
    </section>`;
}

function sessionCard(s) {
  const tags = [MODES[s.mode][0]];
  return `<button type="button" class="s-card" data-open="${s.id}">
    <span class="thumb" style="${s.thumb ? `background-image:url(${s.thumb})` : ""}">${s.thumb ? "" : s.mode === "none" ? ICON.timer : ICON.cam}</span>
    <span><b>${esc(s.subject)}</b><small>${when(s.start)}</small>
      <span>${tags.map(t => `<span class="tag">${t}</span>`).join("")}${s.status === "early" ? '<span class="tag warn">vorzeitig beendet</span>' : ""}${s.distractions ? `<span class="tag">${s.distractions}× abgelenkt</span>` : ""}</span></span>
    <span class="dur">${fmtClock(s.actualSec)}</span>
  </button>`;
}

$("#home").addEventListener("click", e => {
  const b = e.target.closest("[data-a],[data-open]");
  if (!b) return;
  if (b.dataset.open) return openDetail(b.dataset.open);
  if (b.dataset.a === "setup") openSetup();
  if (b.dataset.a === "pin") openPinGuide();
  if (b.dataset.a === "block") openBlockList();
  if (b.dataset.a === "perms") renderPerms();
});

// ---------- App-Sperre (Android): Karte, Sperrliste, Berechtigungs-Assistent ----------
function blockCard(title) {
  const missing = missingForBlock(perms);
  const sub = missing.length ? "Berechtigung fehlt – tippen zum Einrichten"
    : nativeApps ? `${appsText(blockedPkgs().length)}: ${blockedNames()}` : "Apps werden geladen …";
  return `<button type="button" class="pin-card${missing.length ? " warn" : ""}" data-a="${missing.length ? "perms" : "block"}" id="block-card"><span class="ic">${ICON.lock}</span><span><b>${title}</b><small>${esc(sub)}</small></span></button>`;
}
function blockedNames() {
  const sel = blockedPkgs(), names = nativeApps.filter(a => sel.includes(a.pkg)).map(a => a.label);
  if (!names.length) return "keine – tippen zum Auswählen";
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} …` : names.join(", ");
}
const updateBlockCard = () => { const c = $("#block-card"); if (c) c.outerHTML = blockCard(c.querySelector("b").textContent); };

async function openBlockList() {
  $("#sheet").innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="Gesperrte Apps"><div class="grab"></div>
    <h2>Während der Session gesperrt</h2>
    <p class="hint">Gesperrte Apps zeigen während der Session einen Sperrbildschirm. Alles andere bleibt nutzbar: Telefon, Wecker, Musik, Nachrichten.</p>
    <div class="app-list" id="app-list"><p class="hint">Apps werden geladen …</p></div>
    <div class="btns"><button type="button" class="btn sec" data-a="block-default">Standard</button><button type="button" class="btn sec" data-a="perms">Berechtigungen</button></div>
    <button type="button" class="btn block" data-a="close">Fertig</button></div>`;
  $("#sheet").hidden = false;
  try { await loadApps(); } catch (e) { $("#app-list").innerHTML = `<p class="hint">Die App-Liste konnte nicht geladen werden.</p>`; return; }
  renderAppList();
}
function renderAppList() {
  const el = $("#app-list");
  if (!el) return;
  const sel = blockedPkgs();
  const row = a => `<label class="app-row${blockable(a) ? "" : " never"}">${a.icon ? `<img src="${a.icon}" alt="">` : "<span></span>"}<span>${esc(a.label)}${blockable(a) ? "" : "<small>nie gesperrt</small>"}</span>
    <input type="checkbox" data-pkg="${esc(a.pkg)}"${sel.includes(a.pkg) ? " checked" : ""}${blockable(a) ? "" : " disabled"} aria-label="${esc(a.label)} sperren"></label>`;
  // gesperrte zuerst, dann alphabetisch; nie sperrbare ans Ende
  const order = a => (blockable(a) ? 0 : 2) + (sel.includes(a.pkg) ? 0 : 1);
  el.innerHTML = [...nativeApps].sort((x, y) => order(x) - order(y)).map(row).join("");
}
$("#sheet").addEventListener("change", e => {
  const pkg = e.target.dataset?.pkg;
  if (!pkg) return;
  const sel = new Set(blockedPkgs());
  e.target.checked ? sel.add(pkg) : sel.delete(pkg);
  nat.blocked = [...sel]; saveNat(); updateBlockCard();
});
$("#sheet").addEventListener("click", e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (a === "block-default") { nat.blocked = null; saveNat(); renderAppList(); updateBlockCard(); }
  if (a === "perms") { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; renderPerms(); }
});

// Einmaliger, geführter Berechtigungs-Assistent (danach nur über die Sperr-Karte erreichbar)
async function renderPerms() {
  show("perms");
  await refreshPerms();
  const first = PERM_STEPS.find(s => !perms[s.key]);
  $("#perms").innerHTML = `
    <div class="top">${nat.setupDone ? `<button type="button" class="icon-btn" data-a="perm-done" aria-label="Zurück">${ICON.back}</button>` : ""}<div><h1 class="h-title">Einrichten</h1><p class="top-sub">Einmalig, dann nie wieder</p></div></div>
    <p class="hint">Focus sperrt während einer Session nur die Apps, die dich ablenken. Dafür braucht die App ein paar Berechtigungen. Tippe der Reihe nach auf die Knöpfe und komm danach hierher zurück.</p>
    <ol class="perm-list">${PERM_STEPS.map(s => {
      const ok = !!perms[s.key], cur = s === first;
      return `<li class="perm${ok ? " ok" : ""}${cur ? " cur" : ""}"><span class="mark" aria-hidden="true">${ok ? "✓" : ""}</span><div>
        <b>${s.title}${s.need ? "" : ' <small class="opt">optional</small>'}</b><p class="hint">${s.why}</p>
        ${ok ? '<p class="state">Erlaubt</p>' : `${cur && s.how ? `<p class="how">${s.how}</p>` : ""}<button type="button" class="btn${cur ? "" : " sec"}" data-perm="${s.key}">${s.btn}</button>`}</div></li>`;
    }).join("")}</ol>
    ${missingForBlock(perms).length ? '<p class="note">Ohne Nutzungszugriff und „Über anderen Apps anzeigen“ kann Focus keine Apps sperren. Timer und Kamera funktionieren trotzdem.</p>' : '<p class="note">Alles bereit: Während einer Session sind deine Ablenkungs-Apps gesperrt.</p>'}
    <button type="button" class="btn-big" data-a="perm-done">${missingForBlock(perms).length ? "Später" : "Fertig"}</button>`;
}
$("#perms").addEventListener("click", async e => {
  const key = e.target.closest("[data-perm]")?.dataset.perm;
  if (key) {
    try { await Blocker.request(key); } catch (err) { toast("Die Einstellung ließ sich nicht öffnen."); }
    // Laufzeit-Dialoge (Kamera, Benachrichtigungen) sind hier schon beantwortet; Systemseiten prüfen wir beim Zurückkommen
    if (key === "camera" || key === "notifications") renderPerms();
    return;
  }
  if (e.target.closest("[data-a=perm-done]")) { nat.setupDone = true; saveNat(); renderHome(); }
});

// ---------- Anleitung: App anheften (Android) ----------
function openPinGuide() {
  $("#sheet").innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="Handy sperren"><div class="grab"></div>
    <h2>Handy sperren mit „App anheften“</h2>
    <p class="hint">Android hält dich damit in Focus fest. Andere Apps, Benachrichtigungen und der Startbildschirm sind gesperrt, bis du deine PIN eingibst.</p>
    <ol class="steps">
      <li><span><b>Einmalig einschalten:</b> Einstellungen → Sicherheit (bei Samsung „Sicherheit und Datenschutz“) → Weitere Sicherheitseinstellungen → <b>App anheften</b>. Dort auch <b>„Vor dem Loslösen nach PIN fragen“</b> einschalten.</span></li>
      <li><span>In Focus die Session starten.</span></li>
      <li><span>Die <b>Übersicht der offenen Apps</b> öffnen: von unten nach oben wischen und kurz halten, oder die Quadrat-Taste.</span></li>
      <li><span>Oben auf das <b>Focus-Symbol</b> über dem App-Fenster tippen → <b>„Anheften“</b>.</span></li>
      <li><span><b>Lösen nach der Session:</b> Zurück und Übersicht gleichzeitig gedrückt halten (bei Gestensteuerung: von unten wischen und halten), dann PIN eingeben.</span></li>
    </ol>
    <p class="note">Android kennt beim Anheften keine Zeitsperre: Mit deiner PIN kommst du jederzeit raus. Focus misst die Zeit und meldet sich mit Ton und Vibration, wenn die Session vorbei ist. Verlässt du Focus vorher, zählt das als Ablenkung.</p>
    <button type="button" class="btn block" data-a="close">Verstanden</button></div>`;
  $("#sheet").hidden = false;
  $("#sheet [data-a=close]").focus({ preventScroll: true });
}
$("#sheet").addEventListener("click", e => { if (e.target === $("#sheet") || e.target.closest("[data-a=close]")) { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) { $("#sheet").hidden = true; $("#sheet").innerHTML = ""; } });

// ---------- Session einstellen ----------
async function openSetup() { show("setup"); renderSetup(); await startPreview(); }

function modeInfo() {
  if (prefs.mode === "timelapse") return `Alle ${String(timelapseInterval(prefs.min)).replace(".", ",")} s ein Bild. Daraus wird ein Video von ca. 1 Minute, etwa ${fmtBytes(prefs.min * 60 / timelapseInterval(prefs.min) * 25e3)}.`;
  if (prefs.mode === "video") return `Ganze Session als Video, etwa ${fmtBytes(prefs.min * 60 * (prefs.audio ? 750e3 : 700e3) / 8)}. Braucht viel Speicher.`;
  return "Keine Aufnahme. Timer, Ablenkungen und Statistik laufen trotzdem.";
}

function renderSetup() {
  const r = (name, v, label, extra = "") => `<label class="chip"><input type="radio" name="${name}" id="${name}-${v}" value="${v}"${String(prefs[name]) === String(v) ? " checked" : ""}><span>${label}${extra}</span></label>`;
  $("#setup").innerHTML = `
    <div class="top"><button type="button" class="icon-btn" data-a="home" aria-label="Zurück">${ICON.back}</button><h1 class="h-title">Neue Session</h1></div>
    <div class="preview" id="pv"><p>${prefs.mode === "none" ? "Ohne Kamera" : "Kamera wird gestartet …"}</p></div>
    <div class="field"><span>Dauer</span>
      <div class="chips">${DURATIONS.map(m => r("min", m, `${m} min`)).join("")}</div>
      <div class="dur-row"><button type="button" class="icon-btn" data-a="minus" aria-label="5 Minuten weniger">−</button><output id="dur" class="num">${fmtClock(prefs.min * 60)}</output><button type="button" class="icon-btn" data-a="plus" aria-label="5 Minuten mehr">+</button></div>
    </div>
    <div class="field"><span>Fach</span><div class="chips">${SUBJECTS.map(s => r("subject", s, esc(s))).join("")}</div></div>
    <div class="field"><span>Aufnahme</span><div class="seg">${Object.entries(MODES).map(([k, [t, d]]) => r("mode", k, t, `<small>${d}</small>`)).join("")}</div>
      <p class="hint" id="mode-info">${modeInfo()}</p></div>
    ${prefs.mode === "video" ? `<label class="switch" for="audio"><span>Ton mit aufnehmen</span><input type="checkbox" id="audio"${prefs.audio ? " checked" : ""}></label>` : ""}
    ${NATIVE ? blockCard("Diese Apps werden gesperrt") : `<button type="button" class="pin-card" data-a="pin"><span class="ic">${ICON.lock}</span><span><b>Vorher: Handy sperren</b><small>Nach dem Start Focus anheften, so geht's</small></span></button>`}
    <div class="sticky-go"><button type="button" class="btn-big" data-a="start"><span class="dot"></span>Session starten · ${fmtDur(prefs.min * 60)}</button></div>`;
}

async function startPreview() {
  const pv = $("#pv");
  if (!pv) return;
  if (prefs.mode === "none") { stopStream(); pv.innerHTML = `<p>Ohne Kamera: nur Timer und Statistik.</p>`; return; }
  if (!navigator.mediaDevices?.getUserMedia) { pv.innerHTML = `<p>Dieser Browser kann nicht auf die Kamera zugreifen. Öffne Focus in Chrome.</p>`; return; }
  try {
    await getStream();
    if ($("#setup").hidden) return;
    pv.innerHTML = `${videoEl()}<button type="button" class="icon-btn flip" data-a="flip" aria-label="Kamera wechseln">${ICON.flip}</button>`;
    pv.querySelector("video").srcObject = stream;
  } catch (e) {
    pv.innerHTML = `<p>Kein Zugriff auf die Kamera. Erlaube sie in Chrome unter Website-Einstellungen → Kamera, oder wähle „Ohne Kamera“.</p>`;
  }
}

$("#setup").addEventListener("change", e => {
  const t = e.target;
  if (t.name === "min") prefs.min = +t.value;
  if (t.name === "subject") prefs.subject = t.value;
  if (t.name === "mode") prefs.mode = t.value;
  if (t.id === "audio") prefs.audio = t.checked;
  savePrefs();
  if (t.name === "mode" || t.id === "audio") { renderSetup(); startPreview(); return; }
  renderSetup(); reattachPreview();
});
function reattachPreview() {
  if (!stream || prefs.mode === "none") return startPreview();
  const pv = $("#pv");
  pv.innerHTML = `${videoEl()}<button type="button" class="icon-btn flip" data-a="flip" aria-label="Kamera wechseln">${ICON.flip}</button>`;
  pv.querySelector("video").srcObject = stream;
}
$("#setup").addEventListener("click", e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (!a) return;
  if (a === "home") { stopStream(); renderHome(); }
  if (a === "pin") openPinGuide();
  if (a === "block") openBlockList();
  if (a === "perms") { stopStream(); renderPerms(); }
  if (a === "minus" || a === "plus") {
    prefs.min = Math.min(240, Math.max(5, prefs.min + (a === "plus" ? 5 : -5))); savePrefs(); renderSetup(); reattachPreview();
  }
  if (a === "flip") { prefs.facing = prefs.facing === "user" ? "environment" : "user"; savePrefs(); startPreview(); }
  if (a === "start") startSession();
});

// ---------- Laufende Session ----------
let RS = null;

async function startSession() {
  unlockAudio();
  if (prefs.mode !== "none") {
    try { await getStream(); }
    catch (e) { toast("Kamera nicht verfügbar. Wähle „Ohne Kamera“ oder erlaube den Zugriff."); return; }
  } else stopStream();

  // 3-2-1
  const c = document.createElement("div");
  c.className = "count"; c.setAttribute("aria-live", "assertive");
  document.body.append(c);
  for (const n of [3, 2, 1]) { c.textContent = n; beep(520, .08); await new Promise(r => setTimeout(r, 800)); }
  c.remove();

  const now = Date.now(), interval = timelapseInterval(prefs.min);
  const s = { id: now.toString(36), start: now, plannedSec: prefs.min * 60, actualSec: 0, subject: prefs.subject, mode: prefs.mode, status: "running", distractions: 0, awaySec: 0, bytes: 0, chunks: 0, interval, note: "", thumb: null };
  await db.put("sessions", s);
  try { await navigator.storage?.persist?.(); } catch (e) {}

  RS = { s, recOn: prefs.mode !== "none", ended: false, hiddenAt: 0, lastSave: 0, blocked: 0 };
  if (NATIVE) await startBlocking(s);
  show("session");
  renderSession();
  const v = $("#session video");
  if (v) { v.srcObject = stream; await videoReady(v); }
  if (prefs.mode !== "none") {
    RS.rec = new Recorder({
      sid: s.id, mode: prefs.mode, stream, video: v, interval, label: s.subject,
      onError: () => { RS.recOn = false; updateRecDot(); toast("Speicher voll: Die Aufnahme wurde gestoppt, der Timer läuft weiter."); },
    });
    try { RS.rec.start(); } catch (e) { RS.rec = null; RS.recOn = false; updateRecDot(); toast("Aufnahme nicht möglich, der Timer läuft trotzdem."); }
    setTimeout(async () => { if (RS && !RS.ended && v) { s.thumb = thumbnail(v); await db.put("sessions", s); } }, 1500);
  }
  requestWake();
  RS.timer = setInterval(tick, 500);
  tick();
}

// Android: Sperre für die Dauer der Session starten. Fehlen Berechtigungen, läuft die Session ohne Sperre.
async function startBlocking(s) {
  try {
    await loadApps();
    const pkgs = blockedPkgs();
    if (!pkgs.length) return;
    const r = await Blocker.start(s.start + s.plannedSec * 1000, pkgs);
    perms = r;
    if (r.started) RS.blocked = r.count;
    else toast("App-Sperre aus: Berechtigung fehlt. Einrichten über „Während der Session gesperrt“.");
  } catch (e) { toast("App-Sperre konnte nicht gestartet werden, der Timer läuft trotzdem."); }
}
const stopBlocking = () => { if (NATIVE) Blocker.stop().catch(() => {}); };

function renderSession() {
  const { s } = RS;
  const lockInfo = NATIVE
    ? `<span class="lock-info">${RS.blocked ? `${ICON.lock}${appsText(RS.blocked)} gesperrt` : "Keine App gesperrt"}</span>`
    : '<button type="button" data-a="pin">Handy sperren</button>';
  $("#session").innerHTML = `
    <div class="ss-top">
      <span class="recdot${RS.recOn ? "" : " off"}" id="recdot"><i></i>${s.mode === "none" ? "Ohne Kamera" : MODES[s.mode][0]}</span>
      <span id="distr">${s.distractions ? `${s.distractions}× abgelenkt` : "Bleib dran"}</span>
    </div>
    <p class="ss-subject">${esc(s.subject)}</p>
    <div class="ss-mid">
      <svg class="ring" viewBox="0 0 120 120" role="timer" aria-label="Restzeit">
        <circle class="bg" cx="60" cy="60" r="56"/>
        <circle class="fg" id="ring" cx="60" cy="60" r="56" stroke-dasharray="351.9" stroke-dashoffset="0"/>
        <text x="60" y="58" class="t" id="left">${fmtClock(s.plannedSec)}</text>
        <text x="60" y="76" class="s">verbleibend</text>
      </svg>
      ${s.mode !== "none" && !RS.resumed ? `<div class="cam" id="cam">${videoEl()}</div>` : ""}
      <div class="away" id="away" hidden></div>
    </div>
    <div class="ss-bottom">
      <div class="ss-links">${s.mode !== "none" && !RS.resumed ? '<button type="button" data-a="cam">Vorschau ausblenden</button>' : ""}${lockInfo}</div>
      <button type="button" class="hold" id="hold"><i></i><span>Gedrückt halten zum Beenden</span></button>
    </div>`;
}
const updateRecDot = () => $("#recdot")?.classList.toggle("off", !RS.recOn);

function tick() {
  if (!RS || RS.ended) return;
  const s = RS.s, elapsed = (Date.now() - s.start) / 1000, left = s.plannedSec - elapsed;
  $("#left").textContent = fmtClock(left);
  $("#ring").style.strokeDashoffset = String(351.9 * Math.min(1, elapsed / s.plannedSec));
  if (left <= 0) return finishSession(true);
  if (Date.now() - RS.lastSave > 15000) {
    RS.lastSave = Date.now();
    s.actualSec = Math.round(elapsed);
    if (RS.rec) { s.bytes = RS.rec.bytes; s.chunks = RS.rec.n; }
    db.put("sessions", s);
  }
}

async function finishSession(completed) {
  if (!RS || RS.ended) return;
  RS.ended = true;
  clearInterval(RS.timer);
  const s = RS.s;
  s.actualSec = Math.min(s.plannedSec, Math.round((Date.now() - s.start) / 1000));
  s.status = completed ? "done" : "early";
  if (RS.rec) {
    const info = await RS.rec.stop();
    Object.assign(s, { bytes: info.bytes, chunks: info.chunks, mime: info.mime, w: info.w, h: info.h });
  }
  await db.put("sessions", s);
  stopStream();
  releaseWake();
  stopBlocking();
  if (completed) { [0, .35, .7].forEach(t => beep(990, .25, t)); vibrate([300, 150, 300, 150, 300]); }
  const done = RS.s;
  RS = null;
  renderSummary(done);
}

// Gedrückt halten zum Beenden (1,5 s)
let holdT = 0, holdStart = 0;
function holdDown(e) {
  if (!e.target.closest("#hold") || holdStart) return;
  e.preventDefault();
  holdStart = performance.now();
  const fill = $("#hold i");
  const step = () => {
    if (!holdStart) return;
    const p = Math.min(1, (performance.now() - holdStart) / 1500);
    fill.style.width = p * 100 + "%";
    if (p >= 1) { holdStart = 0; vibrate(60); finishSession(false); return; }
    holdT = requestAnimationFrame(step);
  };
  holdT = requestAnimationFrame(step);
}
function holdUp() {
  if (!holdStart) return;
  holdStart = 0; cancelAnimationFrame(holdT);
  const fill = $("#hold i"); if (fill) fill.style.width = "0";
}
$("#session").addEventListener("pointerdown", holdDown);
["pointerup", "pointercancel", "pointerleave"].forEach(ev => $("#session").addEventListener(ev, holdUp));
$("#session").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && !e.repeat && e.target.id === "hold") holdDown(e); });
$("#session").addEventListener("keyup", e => { if (e.key === "Enter" || e.key === " ") holdUp(); });
$("#session").addEventListener("contextmenu", e => e.preventDefault());
$("#session").addEventListener("click", e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (a === "pin") openPinGuide();
  if (a === "cam") { const c = $("#cam"); c.hidden = !c.hidden; e.target.textContent = c.hidden ? "Vorschau zeigen" : "Vorschau ausblenden"; }
});

// App verlassen = Ablenkung
document.addEventListener("visibilitychange", async () => {
  // Android: nach Rückkehr aus den Systemeinstellungen den Assistenten aktualisieren
  if (NATIVE && !document.hidden && !$("#perms").hidden) return renderPerms();
  if (NATIVE && !document.hidden && !$("#home").hidden) { await refreshPerms(); updateBlockCard(); }
  if (!RS || RS.ended) return;
  if (document.hidden) { RS.hiddenAt = Date.now(); RS.rec?.pause(); return; }
  // Android: Session wurde am Sperrbildschirm per „Session beenden“ abgebrochen
  if (NATIVE) {
    try {
      const st = await Blocker.status();
      if (st.abortedAt) { await Blocker.clearAborted(); return finishSession(false); }
    } catch (e) {}
  }
  const away = RS.hiddenAt ? (Date.now() - RS.hiddenAt) / 1000 : 0;
  RS.hiddenAt = 0;
  RS.rec?.resume();
  requestWake();
  if (away > 2) {
    RS.s.distractions++; RS.s.awaySec += Math.round(away);
    $("#distr").textContent = `${RS.s.distractions}× abgelenkt`;
    const el = $("#away"); el.textContent = `Du warst ${fmtClock(away)} weg`; el.hidden = false;
    setTimeout(() => { if (el.isConnected) el.hidden = true; }, 4000);
  }
  tick();
});

// ---------- Abschluss ----------
function recLabel(s) {
  if (s.mode === "none") return "keine";
  if (!s.chunks) return "keine Bilder";
  return s.mode === "timelapse" ? `Zeitraffer ${fmtClock(s.chunks / TL_FPS)} · ${fmtBytes(s.bytes)}` : `Video · ${fmtBytes(s.bytes)}`;
}

function renderSummary(s) {
  show("summary");
  const done = s.status === "done";
  $("#summary").innerHTML = `
    <div class="done-hero"><p>${done ? "Session geschafft" : "Session beendet"}</p><span class="big">${fmtClock(s.actualSec)}</span><p>${esc(s.subject)}${done ? "" : ` · geplant waren ${fmtDur(s.plannedSec)}`}</p></div>
    <div class="kv">
      <div><small>Gelernt</small><b>${fmtDur(s.actualSec)}</b></div>
      <div><small>Ablenkungen</small><b>${s.distractions ? `${s.distractions}× · ${fmtClock(s.awaySec)} weg` : "keine"}</b></div>
      <div><small>Aufnahme</small><b>${recLabel(s)}</b></div>
      <div><small>Beginn</small><b>${when(s.start)}</b></div>
    </div>
    <label class="field" for="note"><span>Was hast du geschafft?</span><textarea id="note" placeholder="z. B. Übungsblatt 4 Statik, Aufgabe 1–3">${esc(s.note)}</textarea></label>
    <div class="btns">
      ${s.chunks ? `<button type="button" class="btn sec" data-a="view">${ICON.play}Aufnahme ansehen</button>` : ""}
      <button type="button" class="btn" data-a="save">Speichern</button>
    </div>`;
  $("#summary").dataset.id = s.id;
}
$("#summary").addEventListener("click", async e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (!a) return;
  const s = await db.get("sessions", $("#summary").dataset.id);
  s.note = $("#note").value.trim();
  await db.put("sessions", s);
  if (a === "view") openDetail(s.id);
  else { toast("Session gespeichert"); renderHome(); }
});

// ---------- Detailansicht mit Wiedergabe ----------
let player = null, exported = null;

async function openDetail(id) {
  player?.destroy(); player = null; exported = null;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  const s = await db.get("sessions", id);
  if (!s) return renderHome();
  show("detail");
  const hasRec = s.mode !== "none" && s.chunks > 0;
  $("#detail").dataset.id = id;
  $("#detail").innerHTML = `
    <div class="top"><button type="button" class="icon-btn" data-a="home" aria-label="Zurück">${ICON.back}</button><div><h1 class="h-title">${esc(s.subject)}</h1><p class="top-sub">${when(s.start)}</p></div></div>
    ${hasRec ? `<div class="player" id="player">${s.mode === "timelapse" ? '<canvas id="tl" aria-label="Zeitraffer"></canvas>' : '<video id="vid" controls playsinline></video>'}</div>` : ""}
    ${hasRec && s.mode === "timelapse" ? `<div class="ctrl"><button type="button" class="icon-btn" data-a="tl-play" id="tl-play" aria-label="Abspielen">${ICON.play}</button><input type="range" id="tl-seek" min="0" max="${s.chunks - 1}" value="0" aria-label="Position"><span class="num" id="tl-time">0:00</span></div>` : ""}
    <div class="kv">
      <div><small>Gelernt</small><b>${fmtDur(s.actualSec)}${s.status === "early" ? ` von ${fmtDur(s.plannedSec)}` : ""}</b></div>
      <div><small>Ablenkungen</small><b>${s.distractions ? `${s.distractions}× · ${fmtClock(s.awaySec)} weg` : "keine"}</b></div>
      <div><small>Aufnahme</small><b>${recLabel(s)}</b></div>
      <div><small>Status</small><b>${s.status === "done" ? "Geschafft" : s.status === "early" ? "Vorzeitig beendet" : "Unterbrochen"}</b></div>
    </div>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    ${hasRec ? `<div class="btns"><button type="button" class="btn" data-a="share">${ICON.share}In Galerie / teilen</button><button type="button" class="btn sec" data-a="download">${ICON.down}Herunterladen</button></div>
      <div id="export" hidden><p class="hint" id="export-t">Video wird erstellt …</p><div class="prog"><i id="export-p"></i></div></div>` : ""}
    <div id="del-box"><button type="button" class="btn sec block" data-a="del">Session löschen</button></div>`;

  if (!hasRec) return;
  const parts = (await db.chunks(id)).map(c => c.blob);
  if (s.mode === "video") {
    const v = $("#vid");
    objectUrl = URL.createObjectURL(new Blob(parts, { type: s.mime || "video/webm" }));
    v.src = objectUrl;
  } else {
    const time = $("#tl-time"), seek = $("#tl-seek"), btn = $("#tl-play");
    player = new FramePlayer($("#tl"), parts, (i, ended) => {
      seek.value = i;
      time.textContent = `${fmtClock(i / TL_FPS)} · ${fmtClock(i * s.interval)}`;
      if (ended) btn.innerHTML = ICON.play;
    });
    time.title = "Zeitraffer · echte Zeit";
    player.seek(0);
    seek.addEventListener("input", () => { player.pause(); btn.innerHTML = ICON.play; player.seek(+seek.value); });
  }
}

const fileName = (s, ext) => `Focus_${s.subject.replace(/[^\wäöüÄÖÜß-]+/g, "-")}_${new Date(s.start).toISOString().slice(0, 16).replace(/[T:]/g, "-")}.${ext}`;

async function sessionVideo(s) {
  if (s.mode === "video") return new Blob((await db.chunks(s.id)).map(c => c.blob), { type: s.mime || "video/webm" });
  if (exported) return exported;
  const box = $("#export");
  box.hidden = false;
  $("#export-t").textContent = "Video wird erstellt, das dauert so lange wie der Zeitraffer …";
  player?.pause();
  const parts = (await db.chunks(s.id)).map(c => c.blob);
  exported = await exportTimelapse(parts, p => { const el = $("#export-p"); if (el) el.style.width = p * 100 + "%"; });
  if ($("#export-t")) $("#export-t").textContent = `Video fertig (${fmtBytes(exported.size)}).`;
  return exported;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast("Gespeichert im Ordner „Download“");
}

$("#detail").addEventListener("click", async e => {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (!a) return;
  const id = $("#detail").dataset.id;
  if (a === "home") { player?.destroy(); player = null; return renderHome(); }
  if (a === "tl-play") {
    if (player.playing) { player.pause(); e.target.closest("button").innerHTML = ICON.play; }
    else { player.play(); e.target.closest("button").innerHTML = ICON.pause; }
    return;
  }
  if (a === "share" || a === "download") {
    const s = await db.get("sessions", id), btns = document.querySelectorAll("#detail [data-a=share], #detail [data-a=download]");
    btns.forEach(b => { b.disabled = true; });
    try {
      const blob = await sessionVideo(s), name = fileName(s, extOf(blob.type));
      if (a === "share") {
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: "Focus-Session" }); }
          catch (err) { if (err.name !== "AbortError") download(blob, name); }
        } else download(blob, name);
      } else download(blob, name);
    } catch (err) { toast("Das Video konnte nicht erstellt werden."); }
    btns.forEach(b => { b.disabled = false; });
  }
  if (a === "del") $("#del-box").innerHTML = `<div class="confirm"><p>Session und Aufnahme endgültig löschen?</p><div class="btns"><button type="button" class="btn warn" data-a="del-yes">Löschen</button><button type="button" class="btn sec" data-a="del-no">Abbrechen</button></div></div>`;
  if (a === "del-no") $("#del-box").innerHTML = `<button type="button" class="btn sec block" data-a="del">Session löschen</button>`;
  if (a === "del-yes") { player?.destroy(); player = null; await db.delChunks(id); await db.del("sessions", id); toast("Session gelöscht"); renderHome(); }
});

// ---------- Start ----------
// Sessions, die durch Absturz oder Schließen nicht beendet wurden, als unterbrochen markieren
// Android: Lief die Sperre noch (Focus wurde weggewischt), geht die Session ohne Kamera weiter.
(async () => {
  let st = null;
  if (NATIVE) { try { st = await Blocker.status(); } catch (e) {} }
  for (const s of await db.all("sessions")) {
    if (s.status !== "running") continue;
    const end = s.start + s.plannedSec * 1000;
    if (st?.active && Math.abs(st.until - end) < 5000 && end > Date.now()) { resumeSession(s); continue; }
    if (st?.abortedAt) await Blocker.clearAborted().catch(() => {});
    s.status = "early";
    s.actualSec = Math.min(s.plannedSec, Math.max(s.actualSec || 0, Math.round(((st?.abortedAt || 0) - s.start) / 1000)));
    await db.put("sessions", s);
  }
  if (RS) return;
  if (NATIVE) {
    await refreshPerms();
    loadApps().then(updateBlockCard).catch(() => {});
    if (!nat.setupDone) return renderPerms();
  }
  renderHome();
})();

function resumeSession(s) {
  RS = { s, recOn: false, ended: false, hiddenAt: 0, lastSave: 0, resumed: true, blocked: 0 };
  show("session");
  renderSession();
  $("#recdot").lastChild.textContent = "Aufnahme beendet";
  loadApps().then(() => { RS && (RS.blocked = blockedPkgs().length); const li = $(".lock-info"); if (li && RS) li.innerHTML = `${ICON.lock}${appsText(RS.blocked)} gesperrt`; }).catch(() => {});
  requestWake();
  RS.timer = setInterval(tick, 500);
  tick();
}
