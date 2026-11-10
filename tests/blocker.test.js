// Selbsttest für die App-Sperre der Android-App (Sperrliste, Texte, Berechtigungen).
// Aufruf: node tests/blocker.test.js
import assert from 'node:assert/strict';
import { selection, blockable, remainText, notificationText, appsText, missingForBlock, PERM_STEPS, DEFAULT_BLOCK, OWN_PACKAGE } from '../js/blocker.js';

const app = (pkg, never = false) => ({ pkg, label: pkg, never });
const installed = [
  app('com.instagram.android'), app('com.ss.android.ugc.trill'), app('com.google.android.youtube'),
  app('com.spotify.music'), app('com.whatsapp'), app('com.google.android.deskclock'),
  app(OWN_PACKAGE), app('com.android.settings'), app('com.sec.android.app.launcher', true), // never vom Plugin
];

// Standard: nur installierte bekannte Social-Media-Apps
assert.deepEqual(selection(installed), ['com.instagram.android', 'com.ss.android.ugc.trill', 'com.google.android.youtube']);
assert.deepEqual(selection([]), []);
assert.ok('com.zhiliaoapp.musically' in DEFAULT_BLOCK && 'com.ss.android.ugc.trill' in DEFAULT_BLOCK, 'beide TikTok-Pakete');

// Gespeicherte Auswahl gewinnt, aber nie sperrbare und nicht installierte fallen raus
assert.deepEqual(selection(installed, ['com.whatsapp', OWN_PACKAGE, 'com.android.settings', 'com.sec.android.app.launcher', 'com.nicht.installiert']), ['com.whatsapp']);
assert.deepEqual(selection(installed, []), [], 'leere Auswahl bleibt leer (nicht Standard)');

// Nie sperrbar: Focus, Einstellungen, Telefon, vom Plugin markierte (Launcher, Standard-Telefon)
for (const p of [OWN_PACKAGE, 'com.android.settings', 'com.google.android.dialer', 'com.android.phone']) assert.equal(blockable(app(p)), false, p);
assert.equal(blockable(app('x.launcher', true)), false);
assert.equal(blockable(app('com.instagram.android')), true);
for (const p of Object.keys(DEFAULT_BLOCK)) assert.ok(blockable(app(p)), `${p} muss sperrbar sein`);

// Restzeit: aufgerundet auf Minuten (gleiche Fälle wie TextsTest.java)
assert.equal(remainText(0), 'gleich vorbei');
assert.equal(remainText(-5), 'gleich vorbei');
assert.equal(remainText(1000), 'noch 1 min');
assert.equal(remainText(60_000), 'noch 1 min');
assert.equal(remainText(22 * 60_000 + 1), 'noch 23 min');
assert.equal(remainText(59 * 60_000), 'noch 59 min');
assert.equal(remainText(60 * 60_000), 'noch 1 h');
assert.equal(remainText(65 * 60_000), 'noch 1 h 5 min');
assert.equal(remainText(120 * 60_000), 'noch 2 h');

assert.equal(notificationText(18, 45, 3), 'Fokus bis 18:45 · 3 Apps gesperrt');
assert.equal(notificationText(9, 5, 1), 'Fokus bis 09:05 · 1 App gesperrt');
assert.equal(notificationText(0, 0, 0), 'Fokus bis 00:00 · keine App gesperrt');
assert.equal(appsText(1), '1 App');
assert.equal(appsText(4), '4 Apps');

// Berechtigungen: Pflicht sind Nutzungszugriff und Overlay
assert.deepEqual(missingForBlock({}), ['usage', 'overlay']);
assert.deepEqual(missingForBlock(undefined), ['usage', 'overlay']);
assert.deepEqual(missingForBlock({ usage: true, overlay: false, camera: false }), ['overlay']);
assert.deepEqual(missingForBlock({ usage: true, overlay: true }), []);
assert.deepEqual(PERM_STEPS.map(s => s.key), ['camera', 'usage', 'overlay', 'notifications', 'battery']);

console.log('OK: App-Sperre (Sperrliste, Texte, Berechtigungen) geprüft');
