# Focus

Lern-App für konzentrierte Sessions (PWA): Timer stellen, Handy weglegen, die Kamera filmt dich beim Lernen.
Sie lässt sich auf dem Handy installieren und läuft danach auch offline.

- **Session einstellen:** Dauer (25/45/60/90 min oder eigene), Fach, Aufnahmeart
- **Zeitraffer:** alle 0,5–5 s ein Bild, daraus wird ein Video von ca. 1 Minute, egal wie lang die Session ist. Mit eingeblendeter Zeit und Fach.
- **Echtzeit-Video:** die ganze Session als Video, optional mit Ton (braucht viel Speicher)
- **Während der Session:** großer Countdown, Bildschirm bleibt an, Beenden nur durch Gedrückthalten.
  Wer die App verlässt, bekommt eine Ablenkung angerechnet.
- **Handy sperren:** in der Android-App sperrt Focus während der Session nur die Ablenkungs-Apps (siehe unten); in der Web-App gibt es eine Anleitung für Androids „App anheften“
- **Gespeicherte Sessions:** abspielen, als Video in die Galerie teilen oder herunterladen, löschen
- **Statistik:** heute, diese Woche, Serie an Lerntagen, letzte 7 Tage

Alle Aufnahmen bleiben auf dem Gerät (IndexedDB im Browser). Nichts wird hochgeladen.

## Starten

```bash
cd focus-app
python3 -m http.server 8000
```

Dann im Browser **http://localhost:8000** öffnen. Die Kamera funktioniert nur über `localhost` oder HTTPS.

## Als App installieren

Die App liegt auf GitHub Pages (HTTPS):

- **Android (Chrome):** Seite öffnen → Menü ⋮ → „App installieren“
- **PC (Chrome/Edge):** In der Adressleiste auf das Installieren-Symbol klicken

Wenn du später Dateien änderst, erhöhe in `sw.js` die Versionsnummer (z. B. `focus-v1` → `focus-v2`).
Sonst zeigen bereits installierte Apps weiter die alte Version.

## Android-App (mit App-Sperre)

Die gleiche App gibt es als Android-App (APK zum Selbst-Installieren, nicht im Play Store). Zusätzlich zur Web-App
**sperrt sie während einer Session nur die Ablenkungs-Apps** – Telefon, Wecker, Musik, Nachrichten und alles andere bleiben nutzbar.

- **Sperrliste:** Standard sind die installierten bekannten Social-Media-Apps (Instagram, TikTok, YouTube, Snapchat, Facebook, X, Reddit,
  Threads, Pinterest, Twitch, BeReal, Tumblr, 9GAG). Ändern: Startseite → „Während der Session gesperrt“ → Schalter je App.
  Nie gesperrt werden Focus selbst, Telefon, Startbildschirm und Einstellungen.
- **Während der Session:** Benachrichtigung „Fokus bis 18:45 · 3 Apps gesperrt“. Öffnest du eine gesperrte App, erscheint ein
  Sperrbildschirm „Gesperrt – noch 23 min“ mit „Zurück zu Focus“. Not-Ausgang: „Session beenden“ 3 Sekunden gedrückt halten –
  das zählt als vorzeitig beendete Session. Die Sperre läuft weiter, auch wenn du Focus aus der App-Übersicht wegwischst;
  beim nächsten Öffnen geht die Session (ohne Kamera) weiter.

### Installieren

1. `dist/focus-debug.apk` aufs Handy kopieren (USB, Cloud oder Mail) und antippen.
2. Android fragt einmal, ob die App (z. B. „Dateien“ oder Chrome) **unbekannte Apps installieren** darf → erlauben.
3. Focus öffnen. Beim ersten Start führt ein Assistent einmalig durch die Berechtigungen:

| Berechtigung | Wofür | Pflicht für die Sperre |
|---|---|---|
| Kamera und Mikrofon | Zeitraffer/Video | nein |
| Nutzungszugriff | erkennen, welche App vorne ist | ja |
| Über anderen Apps anzeigen | Sperrbildschirm über gesperrten Apps | ja |
| Benachrichtigungen | Restzeit-Hinweis und „Session geschafft“ | nein |
| Akku-Optimierung ausnehmen | damit Hersteller die Sperre nicht beenden | nein, empfohlen |

Danach fragt Focus nicht mehr von selbst. Fehlt später eine Berechtigung, zeigt die Startseite „Berechtigung fehlt – tippen zum Einrichten“.

**Android 13+:** Bei einer per Datei installierten App sind „Nutzungszugriff“ und „Über anderen Apps anzeigen“ zuerst
ausgegraut („Eingeschränkte Einstellung“). Dann: Einstellungen → Apps → Focus → Menü ⋮ oben rechts →
**„Eingeschränkte Einstellungen zulassen“**, danach die Schalter einschalten.

### Grenzen

- Die Sperre ist eine Selbstverpflichtung, kein Kinderschutz: Wer Focus deinstalliert, die Berechtigungen entzieht oder das Handy
  neu startet, ist frei (nach einem Neustart läuft die Sperre nicht weiter).
- Gesperrt wird auf App-Ebene. Social Media im Browser (z. B. instagram.com in Chrome) sperrt Focus nicht – Chrome bei Bedarf selbst
  auf die Sperrliste setzen.
- Die gesperrte App wird kurz sichtbar, bevor der Sperrbildschirm erscheint (bis ca. 0,5 s).
- Manche Hersteller (Xiaomi, Huawei, Samsung mit Energiesparmodus) beenden Hintergrund-Dienste aggressiv; dafür die
  Akku-Optimierung ausnehmen.
- Die Debug-APK ist mit einem Entwicklungsschlüssel signiert. Updates installieren nur, wenn sie auf demselben Rechner gebaut wurden.

### Selbst bauen

Voraussetzungen (benutzerlokal, ohne Root): JDK 21 und Android-SDK (Commandline-Tools) mit `platforms;android-36`,
`build-tools;36.0.0` und `platform-tools`. Die SDK-Lizenzen einmal selbst annehmen: `sdkmanager --licenses`.

```bash
cd focus-app
npm install                 # Capacitor (nur lokal, devDependencies)
export JAVA_HOME=~/jdk ANDROID_HOME=~/android-sdk
npm run android:build       # kopiert die Web-App nach www/, synchronisiert, baut dist/focus-debug.apk
```

Die Web-App bleibt **eine Codebasis**: `js/native.js` spricht nur dann mit Android, wenn Focus als App läuft
(`Capacitor.isNativePlatform()`). Das native Plugin liegt in `android/app/src/main/java/app/focus/study/blocker/`.
Nach Änderungen an HTML/CSS/JS reicht `npm run android:sync` und ein neuer Build.

## Test

```bash
npm test                    # Web: Statistik, Zeitraffer, Sperrliste und Texte der App-Sperre
cd android && ./gradlew testDebugUnitTest   # Android: Texte (JUnit)
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/app.js` | Oberfläche: Start, Einstellungen, laufende Session, Abschluss, Wiedergabe |
| `js/recorder.js` | Aufnahme (Zeitraffer und Video), Zeitraffer-Player, Export als Videodatei |
| `js/db.js` | Speicher im Browser (IndexedDB) |
| `js/stats.js` | Zeitformat, Zeitraffer-Abstand, Statistik |
| `js/native.js` | Brücke zur Android-App (nur aktiv in der App) |
| `js/blocker.js` | Sperrliste, Restzeit-Texte, Berechtigungs-Schritte (ohne DOM, getestet) |
| `android/` | Android-Projekt (Capacitor) mit dem Plugin `AppBlocker` und dem Sperr-Dienst |
| `scripts/build-web.mjs` | kopiert die Web-App nach `www/` für Capacitor |
| `sw.js` | Service Worker für den Offline-Betrieb |
