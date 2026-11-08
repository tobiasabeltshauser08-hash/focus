// Aufnahme und Wiedergabe.
// Zeitraffer: alle paar Sekunden ein JPEG-Bild, abgespielt mit 30 Bildern/s.
// Echtzeit: MediaRecorder, alle 5 s ein Stück in die Datenbank (geht bei Absturz nicht verloren).
import * as db from "./db.js";
import { fmtClock, TL_FPS } from "./stats.js";

export function pickMime(audio) {
  if (typeof MediaRecorder === "undefined") return "";
  const list = [
    `video/mp4;codecs=avc1.42E01E${audio ? ",mp4a.40.2" : ""}`, "video/mp4",
    `video/webm;codecs=vp9${audio ? ",opus" : ""}`, `video/webm;codecs=vp8${audio ? ",opus" : ""}`, "video/webm",
  ];
  return list.find(t => MediaRecorder.isTypeSupported(t)) || "";
}
export const extOf = mime => mime.includes("mp4") ? "mp4" : "webm";

// Größe der Zeitraffer-Bilder: längste Seite 640 px
export function frameSize(video) {
  const w = video.videoWidth || 640, h = video.videoHeight || 480, k = Math.min(1, 640 / Math.max(w, h));
  return { w: Math.round(w * k / 2) * 2, h: Math.round(h * k / 2) * 2 };
}

export class Recorder {
  constructor({ sid, mode, stream, video, interval, label, onError }) {
    Object.assign(this, { sid, mode, stream, video, interval, label, onError });
    this.n = 0; this.bytes = 0; this.queue = Promise.resolve(); this.started = 0; this.failed = false;
  }

  save(blob) {
    if (this.failed || !blob || !blob.size) return;
    const n = this.n++;
    this.bytes += blob.size;
    this.queue = this.queue.then(() => db.put("chunks", { sid: this.sid, n, blob })).catch(err => {
      this.failed = true;
      this.stopNow();
      this.onError?.(err);
    });
  }

  start() {
    this.started = Date.now();
    if (this.mode === "video") {
      this.mime = pickMime(this.stream.getAudioTracks().length > 0);
      this.mr = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 700_000, audioBitsPerSecond: 48_000 });
      this.mime = this.mr.mimeType || this.mime || "video/webm";
      this.mr.ondataavailable = e => this.save(e.data);
      this.mr.start(5000);
    } else if (this.mode === "timelapse") {
      this.mime = "image/jpeg";
      Object.assign(this, frameSize(this.video));
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.w; this.canvas.height = this.h;
      this.ctx = this.canvas.getContext("2d");
      this.capture();
      this.timer = setInterval(() => this.capture(), this.interval * 1000);
    }
  }

  capture() {
    // Im Hintergrund liefert die Kamera auf Android kein Bild
    if (document.hidden || this.video.readyState < 2) return;
    const { ctx, w, h } = this;
    ctx.drawImage(this.video, 0, 0, w, h);
    // Einblendung: vergangene Zeit und Fach
    const t = fmtClock((Date.now() - this.started) / 1000), fs = Math.round(h / 22);
    ctx.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
    const text = `${t}  ${this.label}`, tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(fs * .6, h - fs * 2.2, tw + fs * 1.2, fs * 1.6);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, fs * 1.2, h - fs * .95);
    this.canvas.toBlob(b => this.save(b), "image/jpeg", .62);
  }

  pause() { if (this.mr?.state === "recording") this.mr.pause(); }
  resume() { if (this.mr?.state === "paused") this.mr.resume(); }

  stopNow() {
    clearInterval(this.timer);
    if (this.mr && this.mr.state !== "inactive") { try { this.mr.stop(); } catch (e) {} }
  }

  // Beendet die Aufnahme und wartet, bis alles gespeichert ist
  async stop() {
    clearInterval(this.timer);
    if (this.mr && this.mr.state !== "inactive") {
      await new Promise(res => { this.mr.addEventListener("stop", res, { once: true }); this.mr.stop(); });
    }
    await this.queue;
    return { mime: this.mime, bytes: this.bytes, chunks: this.n, w: this.w, h: this.h };
  }
}

// Kleines Vorschaubild als data:-URL
export function thumbnail(video, size = 200) {
  if (!video || video.readyState < 2) return null;
  const k = size / Math.max(video.videoWidth, video.videoHeight);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", .7);
}

// Abspielen eines Zeitraffers auf einem Canvas
export class FramePlayer {
  constructor(canvas, blobs, onTime) {
    Object.assign(this, { canvas, blobs, onTime });
    this.ctx = canvas.getContext("2d");
    this.cache = new Map(); this.loading = new Set();
    this.i = 0; this.playing = false; this.raf = 0;
  }
  get duration() { return this.blobs.length / TL_FPS; }
  load(i) {
    if (i < 0 || i >= this.blobs.length || this.cache.has(i) || this.loading.has(i)) return;
    this.loading.add(i);
    createImageBitmap(this.blobs[i]).then(b => { this.loading.delete(i); this.cache.set(i, b); if (!this.playing && i === this.i) this.draw(i); });
  }
  draw(i) {
    const b = this.cache.get(i);
    if (!b) return false;
    if (this.canvas.width !== b.width) { this.canvas.width = b.width; this.canvas.height = b.height; }
    this.ctx.drawImage(b, 0, 0);
    for (const [k, bm] of this.cache) if (k < i - 3 || k > i + 40) { bm.close(); this.cache.delete(k); }
    return true;
  }
  seek(i) { this.i = Math.max(0, Math.min(this.blobs.length - 1, i)); for (let k = 0; k < 20; k++) this.load(this.i + k); this.draw(this.i); this.onTime?.(this.i); }
  play() {
    if (this.i >= this.blobs.length - 1) this.i = 0;
    this.playing = true;
    const t0 = performance.now(), i0 = this.i;
    const step = now => {
      if (!this.playing) return;
      const target = Math.min(this.blobs.length - 1, i0 + Math.floor((now - t0) / 1000 * TL_FPS));
      for (let k = 0; k < 20; k++) this.load(target + k);
      // neuestes fertig geladenes Bild bis zur Zielposition zeigen
      for (let k = target; k >= this.i; k--) if (this.draw(k)) { this.i = k; break; }
      this.onTime?.(this.i);
      if (target >= this.blobs.length - 1 && this.i >= this.blobs.length - 1) { this.playing = false; this.onTime?.(this.i, true); return; }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); }
  destroy() { this.pause(); for (const b of this.cache.values()) b.close(); this.cache.clear(); }
}

// Zeitraffer als Videodatei erzeugen (läuft in Echtzeit, ca. 1 Minute)
export async function exportTimelapse(blobs, onProgress) {
  const first = await createImageBitmap(blobs[0]);
  const c = document.createElement("canvas");
  c.width = first.width; c.height = first.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(first, 0, 0); first.close();
  const stream = c.captureStream(TL_FPS);
  const mime = pickMime(false);
  const mr = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 2_500_000 });
  const parts = [];
  mr.ondataavailable = e => e.data.size && parts.push(e.data);
  const done = new Promise(res => mr.addEventListener("stop", res, { once: true }));
  mr.start(1000);
  const t0 = performance.now();
  let next = createImageBitmap(blobs[0]);
  for (let i = 0; i < blobs.length; i++) {
    const bmp = await next;
    if (i + 1 < blobs.length) next = createImageBitmap(blobs[i + 1]);
    const wait = t0 + i * 1000 / TL_FPS - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    ctx.drawImage(bmp, 0, 0); bmp.close();
    onProgress?.((i + 1) / blobs.length);
  }
  await new Promise(r => setTimeout(r, 300));
  mr.stop();
  await done;
  stream.getTracks().forEach(t => t.stop());
  const type = mr.mimeType || mime || "video/webm";
  return new Blob(parts, { type });
}
