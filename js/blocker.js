// App-Sperre der Android-App: reine Logik ohne DOM, damit sie sich mit Node testen lässt.
// Die Texte entsprechen android/.../blocker/Texts.java (dort mit JUnit getestet).

export const OWN_PACKAGE = "app.focus.study";

// Bekannte Ablenkungs-Apps. Gesperrt wird standardmäßig nur, was davon installiert ist.
export const DEFAULT_BLOCK = {
  "com.instagram.android": "Instagram",
  "com.zhiliaoapp.musically": "TikTok",
  "com.ss.android.ugc.trill": "TikTok",
  "com.google.android.youtube": "YouTube",
  "com.snapchat.android": "Snapchat",
  "com.facebook.katana": "Facebook",
  "com.facebook.lite": "Facebook Lite",
  "com.twitter.android": "X (Twitter)",
  "com.reddit.frontpage": "Reddit",
  "com.instagram.barcelona": "Threads",
  "com.pinterest": "Pinterest",
  "tv.twitch.android.app": "Twitch",
  "com.bereal.ft": "BeReal",
  "com.tumblr": "Tumblr",
  "com.ninegag.android.app": "9GAG",
};

// Nie sperrbar (das native Plugin ergänzt Startbildschirm, Standard-Telefon-App und Einstellungen des Geräts)
export const NEVER_BLOCK = [
  OWN_PACKAGE, "com.android.settings", "com.android.dialer", "com.google.android.dialer",
  "com.samsung.android.dialer", "com.android.phone", "com.android.systemui", "com.android.emergency",
];

/** Darf diese App gesperrt werden? apps-Einträge aus dem Plugin bringen ein eigenes never-Flag mit. */
export const blockable = app => !app.never && !NEVER_BLOCK.includes(app.pkg);

/**
 * Welche der installierten Apps gesperrt werden.
 * saved = vom Nutzer gespeicherte Paketliste oder null (dann die bekannten Social-Media-Apps).
 */
export function selection(apps, saved = null) {
  const ok = apps.filter(blockable).map(a => a.pkg);
  if (Array.isArray(saved)) return ok.filter(p => saved.includes(p));
  return ok.filter(p => p in DEFAULT_BLOCK);
}

/** Restzeit, aufgerundet auf volle Minuten: „noch 23 min“, „noch 1 h 5 min“. */
export function remainText(ms) {
  if (ms <= 0) return "gleich vorbei";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `noch ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `noch ${h} h ${m} min` : `noch ${h} h`;
}

/** „Fokus bis 18:45 · 3 Apps gesperrt“ */
export function notificationText(hour, minute, apps) {
  const pad = n => String(n).padStart(2, "0");
  const count = apps === 0 ? "keine App gesperrt" : apps === 1 ? "1 App gesperrt" : `${apps} Apps gesperrt`;
  return `Fokus bis ${pad(hour)}:${pad(minute)} · ${count}`;
}

export const appsText = n => n === 1 ? "1 App" : `${n} Apps`;

// Schritte des Berechtigungs-Assistenten. need = ohne diese Berechtigung keine App-Sperre.
export const PERM_STEPS = [
  { key: "camera", title: "Kamera und Mikrofon", why: "Für Zeitraffer und Video deiner Session. Ohne Kamera läuft nur der Timer.", btn: "Erlauben", need: false },
  { key: "usage", title: "Nutzungszugriff", why: "Damit Focus erkennt, welche App gerade offen ist. Es wird nichts gespeichert oder gesendet.", btn: "Einstellungen öffnen", how: "Focus in der Liste antippen und „Nutzungszugriff erlauben“ einschalten, dann zurück.", need: true },
  { key: "overlay", title: "Über anderen Apps anzeigen", why: "Damit Focus den Sperrbildschirm über gesperrte Apps legen kann.", btn: "Einstellungen öffnen", how: "Schalter „Über anderen Apps anzeigen“ einschalten, dann zurück.", need: true },
  { key: "notifications", title: "Benachrichtigungen", why: "Zeigt während der Session, bis wann gesperrt ist, und meldet das Ende.", btn: "Erlauben", need: false },
  { key: "battery", title: "Akku-Optimierung ausnehmen", why: "Empfohlen: Manche Handys beenden die Sperre sonst nach einiger Zeit im Hintergrund.", btn: "Ausnehmen", need: false },
];

/** Fehlende Pflicht-Berechtigungen für die Sperre (Schlüssel aus PERM_STEPS). */
export const missingForBlock = perms => PERM_STEPS.filter(s => s.need && !perms?.[s.key]).map(s => s.key);
