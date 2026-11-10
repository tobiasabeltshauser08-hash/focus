package app.focus.study.blocker;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.telecom.TelecomManager;

import androidx.core.content.ContextCompat;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Welche Apps es gibt, welche nie gesperrt werden dürfen, welche Berechtigungen fehlen. */
public final class Apps {
    private Apps() {}

    /** Bekannte Telefon- und Einstellungs-Pakete; dazu kommen die zur Laufzeit ermittelten. */
    private static final Set<String> NEVER = new HashSet<>(Arrays.asList(
        "com.android.settings", "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer",
        "com.android.phone", "com.android.server.telecom", "com.android.systemui", "com.android.emergency"
    ));

    /** Focus selbst, Telefon, Startbildschirme und Einstellungen: diese Apps sperrt Focus nie. */
    public static Set<String> neverBlocked(Context ctx) {
        Set<String> s = new HashSet<>(NEVER);
        s.add(ctx.getPackageName());
        PackageManager pm = ctx.getPackageManager();
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo r : pm.queryIntentActivities(home, 0)) s.add(r.activityInfo.packageName);
        ResolveInfo settings = pm.resolveActivity(new Intent(Settings.ACTION_SETTINGS), 0);
        if (settings != null) s.add(settings.activityInfo.packageName);
        try {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage());
        } catch (Exception ignored) {}
        return s;
    }

    public static boolean hasUsageAccess(Context ctx) {
        AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
        int mode = Build.VERSION.SDK_INT >= 29
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
        if (mode == AppOpsManager.MODE_DEFAULT)
            return ctx.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED;
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    public static boolean hasOverlay(Context ctx) { return Settings.canDrawOverlays(ctx); }

    public static boolean hasNotifications(Context ctx) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean hasCamera(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean ignoresBatteryOptimizations(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }
}
