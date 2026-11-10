// Kopiert die Web-App nach www/ – das ist der Ordner, den Capacitor in die Android-App packt.
// Aufruf: node scripts/build-web.mjs (oder npm run android:sync)
import { cpSync, rmSync, mkdirSync } from "node:fs";
const FILES = ["index.html", "style.css", "manifest.webmanifest", "sw.js", "js", "icons"];
rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log(`www/ aktualisiert (${FILES.join(", ")})`);
