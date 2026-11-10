package app.focus.study.blocker;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Schnittstelle zur Web-App (js/native.js): Berechtigungen, Liste der Apps, Sperre starten/stoppen.
 * Aufruf aus JS über Capacitor.nativePromise("AppBlocker", methode, optionen).
 */
@CapacitorPlugin(
    name = "AppBlocker",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO }),
    }
)
public class AppBlockerPlugin extends Plugin {

    /** Status aller Berechtigungen, die Focus braucht. */
    @PluginMethod
    public void permissions(PluginCall call) { call.resolve(permissionStatus()); }

    private JSObject permissionStatus() {
        JSObject r = new JSObject();
        r.put("usage", Apps.hasUsageAccess(getContext()));
        r.put("overlay", Apps.hasOverlay(getContext()));
        r.put("notifications", Apps.hasNotifications(getContext()));
        r.put("camera", Apps.hasCamera(getContext()));
        r.put("battery", Apps.ignoresBatteryOptimizations(getContext()));
        return r;
    }

    /**
     * Fragt eine Berechtigung an. Laufzeit-Berechtigungen (Kamera, Benachrichtigungen) über den System-Dialog,
     * Sonderrechte über die passende Systemseite. Den Status prüft die Web-App, wenn sie wieder vorne ist.
     */
    @PluginMethod
    public void request(PluginCall call) {
        String which = call.getString("which", "");
        String pkg = getContext().getPackageName();
        switch (which) {
            case "camera":
                if (getPermissionState("camera") == PermissionState.GRANTED) { call.resolve(permissionStatus()); return; }
                requestPermissionForAlias("camera", call, "permissionResult");
                return;
            case "notifications":
                if (Apps.hasNotifications(getContext())) { call.resolve(permissionStatus()); return; }
                requestPermissionForAlias("notifications", call, "permissionResult");
                return;
            case "usage":
                open(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS), call);
                return;
            case "overlay":
                open(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg)), call);
                return;
            case "battery":
                open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg)), call);
                return;
            case "app":
                open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)), call);
                return;
            default:
                call.reject("Unbekannte Berechtigung: " + which);
        }
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) { call.resolve(permissionStatus()); }

    private void open(Intent i, PluginCall call) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            // manche Hersteller kennen die genaue Seite nicht: dann die App-Infos öffnen
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve(permissionStatus());
    }

    /** Alle Apps mit Symbol auf dem Startbildschirm: { pkg, label, icon (data:-URL), never }. */
    @PluginMethod
    public void apps(PluginCall call) {
        new Thread(() -> {
            PackageManager pm = getContext().getPackageManager();
            Set<String> never = Apps.neverBlocked(getContext());
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            Set<String> seen = new HashSet<>();
            JSArray list = new JSArray();
            for (ResolveInfo r : pm.queryIntentActivities(launcher, 0)) {
                String pkg = r.activityInfo.packageName;
                if (!seen.add(pkg)) continue;
                JSObject a = new JSObject();
                a.put("pkg", pkg);
                a.put("label", r.loadLabel(pm).toString());
                a.put("never", never.contains(pkg));
                a.put("icon", iconData(r.loadIcon(pm)));
                list.put(a);
            }
            JSObject res = new JSObject();
            res.put("apps", list);
            call.resolve(res);
        }).start();
    }

    private String iconData(Drawable d) {
        try {
            int size = 72;
            Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            d.setBounds(0, 0, size, size);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 100, out);
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) { return null; }
    }

    /** Sperre starten: { until: Zeitstempel ms, packages: [paketnamen] }. Ohne Nutzungszugriff/Overlay startet nichts. */
    @PluginMethod
    public void start(PluginCall call) {
        Long until = call.getLong("until");
        JSArray arr = call.getArray("packages", new JSArray());
        List<String> pkgs = new ArrayList<>();
        try { pkgs = arr.toList(); } catch (JSONException ignored) {}
        Set<String> blocked = new HashSet<>(pkgs);
        blocked.removeAll(Apps.neverBlocked(getContext()));
        JSObject res = permissionStatus();
        boolean ok = until != null && until > System.currentTimeMillis() && !blocked.isEmpty()
            && Apps.hasUsageAccess(getContext()) && Apps.hasOverlay(getContext());
        if (ok) {
            new BlockerState(getContext()).start(until, blocked);
            BlockerService.start(getContext());
        }
        res.put("started", ok);
        res.put("count", blocked.size());
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        new BlockerState(getContext()).stop();
        BlockerService.stop(getContext());
        call.resolve();
    }

    /** { active, until, abortedAt } – abortedAt > 0, wenn die Session am Sperrbildschirm abgebrochen wurde. */
    @PluginMethod
    public void status(PluginCall call) {
        BlockerState s = new BlockerState(getContext());
        JSObject r = new JSObject();
        r.put("active", s.active());
        r.put("until", s.until());
        r.put("abortedAt", s.abortedAt());
        call.resolve(r);
    }

    @PluginMethod
    public void clearAborted(PluginCall call) {
        new BlockerState(getContext()).clearAborted();
        call.resolve();
    }
}
