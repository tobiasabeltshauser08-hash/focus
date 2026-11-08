// Reine Hilfsfunktionen ohne DOM, damit sie sich mit Node testen lassen

export const SUBJECTS = ["Höhere Mathematik", "Werkstoffkunde", "Elektrotechnik", "Statik", "Sonstiges"];
export const DURATIONS = [25, 45, 60, 90];
export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Zeitraffer: etwa 1 Minute Video bei 30 Bildern/s, egal wie lang die Session ist
export const TL_FPS = 30;
export function timelapseInterval(minutes) {
  const sec = minutes * 60 / (60 * TL_FPS);
  return Math.min(5, Math.max(0.5, Math.round(sec * 10) / 10));
}

const pad = n => String(n).padStart(2, "0");

export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtBytes(b) {
  if (b < 1e6) return `${Math.max(1, Math.round(b / 1e3))} KB`;
  if (b < 1e9) return `${Math.round(b / 1e6)} MB`;
  return `${(b / 1e9).toFixed(1).replace(".", ",")} GB`;
}

export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; };

// Kennzahlen für die Startseite. Nur Sessions ab 1 Minute zählen.
export function summary(sessions, now = Date.now()) {
  const valid = sessions.filter(s => (s.actualSec || 0) >= 60);
  const perDay = new Map();
  for (const s of valid) perDay.set(dayKey(s.start), (perDay.get(dayKey(s.start)) || 0) + s.actualSec);

  const today = startOfDay(now);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const weekSec = valid.filter(s => s.start >= weekStart.getTime()).reduce((a, s) => a + s.actualSec, 0);

  // Serie: Lerntage am Stück bis heute (oder gestern, wenn heute noch nichts war)
  const d = new Date(today);
  if (!perDay.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (perDay.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const x = new Date(today); x.setDate(today.getDate() - i);
    last7.push({ label: WEEKDAYS[(x.getDay() + 6) % 7], sec: perDay.get(dayKey(x)) || 0, today: i === 0 });
  }

  return { todaySec: perDay.get(dayKey(today)) || 0, weekSec, streak, count: valid.length, last7 };
}
