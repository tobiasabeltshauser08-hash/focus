// Brücke zur Android-App (Capacitor). In der PWA ist isNative() false und nichts davon wird benutzt.
// Capacitor stellt window.Capacitor im WebView bereit, deshalb ist kein Bundler nötig.
const cap = () => globalThis.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();

const call = (method, options = {}) => cap().nativePromise("AppBlocker", method, options);

// Gegenstück: android/app/src/main/java/app/focus/study/blocker/AppBlockerPlugin.java
export const Blocker = {
  permissions: () => call("permissions"),                     // { usage, overlay, notifications, camera, battery }
  request: which => call("request", { which }),               // Systemdialog bzw. Systemseite öffnen
  apps: () => call("apps").then(r => r.apps),                 // [{ pkg, label, icon, never }]
  start: (until, packages) => call("start", { until, packages }), // { started, count, …Berechtigungen }
  stop: () => call("stop"),
  status: () => call("status"),                               // { active, until, abortedAt }
  clearAborted: () => call("clearAborted"),
};
