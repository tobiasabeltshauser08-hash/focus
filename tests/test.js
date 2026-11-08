// Selbsttest für Zeitberechnung und Statistik.
// Aufruf: node tests/test.js
import assert from 'node:assert/strict';
import { timelapseInterval, fmtClock, fmtDur, fmtBytes, summary, TL_FPS } from '../js/stats.js';

// Zeitraffer ergibt rund 1 Minute Video, Abstand zwischen 0,5 und 5 s
for (const min of [5, 25, 45, 60, 90, 120, 240]) {
  const iv = timelapseInterval(min);
  assert.ok(iv >= 0.5 && iv <= 5, `${min} min: ${iv}`);
  const videoSec = min * 60 / iv / TL_FPS;
  if (min >= 15 && min <= 150) assert.ok(videoSec > 50 && videoSec < 70, `${min} min → ${videoSec} s Video`);
}
assert.equal(timelapseInterval(60), 2);

assert.equal(fmtClock(0), '00:00');
assert.equal(fmtClock(59.2), '01:00');
assert.equal(fmtClock(45 * 60), '45:00');
assert.equal(fmtClock(3600 + 61), '1:01:01');
assert.equal(fmtDur(45 * 60), '45 min');
assert.equal(fmtDur(90 * 60), '1 h 30 min');
assert.equal(fmtDur(120 * 60), '2 h');
assert.equal(fmtBytes(2_500_000), '3 MB');
assert.equal(fmtBytes(1_250_000_000), '1,3 GB');

// Statistik: Mittwoch, 12. November 2025, 18 Uhr
const now = new Date(2025, 10, 12, 18).getTime();
const at = (d, h, min) => ({ start: new Date(2025, 10, d, h).getTime(), actualSec: min * 60 });
const S = [
  at(12, 9, 45), at(12, 14, 25),   // heute
  at(11, 10, 60),                  // gestern
  at(10, 10, 30),                  // Montag
  at(8, 10, 90),                   // Samstag letzte Woche (Serie unterbrochen am 9.)
  { ...at(12, 16, 0), actualSec: 30 }, // unter 1 Minute zählt nicht
];
const st = summary(S, now);
assert.equal(st.todaySec, 70 * 60);
assert.equal(st.weekSec, (70 + 60 + 30) * 60);
assert.equal(st.streak, 3);
assert.equal(st.count, 5);
assert.equal(st.last7.length, 7);
assert.equal(st.last7[6].label, 'Mi');
assert.ok(st.last7[6].today);
assert.equal(st.last7[2].sec, 90 * 60); // Samstag

// Serie zählt ab gestern, wenn heute noch nichts gelernt wurde
assert.equal(summary(S.filter(s => s.start < new Date(2025, 10, 12).getTime()), now).streak, 2);
assert.equal(summary([], now).streak, 0);

console.log('OK: Zeitraffer, Formatierung und Statistik geprüft');
