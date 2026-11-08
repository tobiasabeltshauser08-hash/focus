# Focus

Lern-App für konzentrierte Sessions (PWA): Timer stellen, Handy weglegen, die Kamera filmt dich beim Lernen.
Sie lässt sich auf dem Handy installieren und läuft danach auch offline.

- **Session einstellen:** Dauer (25/45/60/90 min oder eigene), Fach, Aufnahmeart
- **Zeitraffer:** alle 0,5–5 s ein Bild, daraus wird ein Video von ca. 1 Minute, egal wie lang die Session ist. Mit eingeblendeter Zeit und Fach.
- **Echtzeit-Video:** die ganze Session als Video, optional mit Ton (braucht viel Speicher)
- **Während der Session:** großer Countdown, Bildschirm bleibt an, Beenden nur durch Gedrückthalten.
  Wer die App verlässt, bekommt eine Ablenkung angerechnet.
- **Handy sperren:** Anleitung für Androids „App anheften“ (Lösen nur mit PIN)
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

## Test

```bash
node tests/test.js
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/app.js` | Oberfläche: Start, Einstellungen, laufende Session, Abschluss, Wiedergabe |
| `js/recorder.js` | Aufnahme (Zeitraffer und Video), Zeitraffer-Player, Export als Videodatei |
| `js/db.js` | Speicher im Browser (IndexedDB) |
| `js/stats.js` | Zeitformat, Zeitraffer-Abstand, Statistik |
| `sw.js` | Service Worker für den Offline-Betrieb |
