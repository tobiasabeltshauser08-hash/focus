package app.focus.study.blocker;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.util.Calendar;
import java.util.Set;

/**
 * Läuft während einer Focus-Session im Vordergrund. Prüft etwa alle 500 ms, welche App vorne ist,
 * und legt über gesperrte Apps einen Vollbild-Sperrbildschirm. Endet von selbst zur Session-Endzeit.
 */
public class BlockerService extends Service {
    private static final String CH_RUN = "focus_block", CH_DONE = "focus_done";
    private static final int NID = 4711, NID_DONE = 4712;
    private static final long POLL_MS = 500, HOLD_MS = 3000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private BlockerState state;
    private Set<String> blocked, never;
    private long until, lastQuery;
    private String foreground;
    private boolean running;

    private WindowManager wm;
    private View overlay;
    private TextView overlayApp, overlayLeft, holdLabel;
    private long holdStart;

    public static void start(Context ctx) {
        androidx.core.content.ContextCompat.startForegroundService(ctx, new Intent(ctx, BlockerService.class));
    }

    public static void stop(Context ctx) { ctx.stopService(new Intent(ctx, BlockerService.class)); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        state = new BlockerState(this);
        until = state.until();
        blocked = state.packages();
        never = Apps.neverBlocked(this);
        blocked.removeAll(never);
        createChannels();
        // startForeground muss auch dann aufgerufen werden, wenn wir gleich wieder aufhören
        ServiceCompat.startForeground(this, NID, buildNotification(), Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
        if (!state.active()) { finish(false); return START_NOT_STICKY; }
        if (!running) { running = true; lastQuery = System.currentTimeMillis() - 60_000; handler.post(loop); }
        return START_STICKY; // überlebt das Wegwischen von Focus; Zustand kommt aus BlockerState
    }

    private final Runnable loop = new Runnable() {
        @Override public void run() {
            if (!running) return;
            long now = System.currentTimeMillis();
            if (now >= until) { finish(true); return; }
            updateForeground(now);
            if (foreground != null && blocked.contains(foreground)) showOverlay(foreground); else hideOverlay();
            if (overlayLeft != null) overlayLeft.setText(Texts.remain(until - now));
            handler.postDelayed(this, POLL_MS);
        }
    };

    /** Letzte App, die laut Nutzungsstatistik in den Vordergrund kam. */
    private void updateForeground(long now) {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return;
        // kleines Überlappen, weil Ereignisse manchmal verspätet eintragen werden
        UsageEvents events = usm.queryEvents(lastQuery - 2_000, now);
        lastQuery = now;
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            // ACTIVITY_RESUMED (Android 10+) hat denselben Wert wie das ältere MOVE_TO_FOREGROUND
            if (e.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) foreground = e.getPackageName();
        }
    }

    // ---------- Sperrbildschirm ----------

    @SuppressLint("ClickableViewAccessibility")
    private void showOverlay(String pkg) {
        if (!Apps.hasOverlay(this)) return;
        if (overlay == null) {
            wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            overlay = buildOverlay();
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.OPAQUE);
            lp.gravity = Gravity.CENTER;
            try { wm.addView(overlay, lp); } catch (Exception ex) { overlay = null; return; }
        }
        overlayApp.setText(label(pkg) + " ist während deiner Focus-Session gesperrt.");
    }

    private void hideOverlay() {
        if (overlay == null) return;
        resetHold();
        try { wm.removeView(overlay); } catch (Exception ignored) {}
        overlay = null; overlayApp = null; overlayLeft = null; holdLabel = null;
    }

    @SuppressLint("ClickableViewAccessibility")
    private View buildOverlay() {
        FrameLayout root = new FrameLayout(this) {
            // Zurück-Taste schluckt der Sperrbildschirm
            @Override public boolean dispatchKeyEvent(KeyEvent event) {
                if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) return true;
                return super.dispatchKeyEvent(event);
            }
        };
        root.setBackgroundColor(Color.BLACK);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(28);
        col.setPadding(pad, pad, pad, pad);
        root.addView(col, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        TextView title = text("Gesperrt", 34, Color.WHITE, true);
        overlayLeft = text(Texts.remain(until - System.currentTimeMillis()), 20, 0xFF7CF29C, true);
        overlayApp = text("", 16, 0xFFB8B8B8, false);
        col.addView(title);
        col.addView(overlayLeft, margins(dp(8), 0));
        col.addView(overlayApp, margins(dp(16), dp(40)));

        TextView back = button("Zurück zu Focus", Color.WHITE, Color.BLACK, Color.WHITE);
        back.setOnClickListener(v -> openFocus());
        col.addView(back, margins(0, dp(14)));

        holdLabel = button("Session beenden · 3 s halten", Color.TRANSPARENT, Color.WHITE, 0xFF5A5A5A);
        holdLabel.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == MotionEvent.ACTION_DOWN) { holdStart = System.currentTimeMillis(); handler.post(hold); return true; }
            if (ev.getAction() == MotionEvent.ACTION_UP || ev.getAction() == MotionEvent.ACTION_CANCEL) { resetHold(); return true; }
            return true;
        });
        col.addView(holdLabel, margins(0, 0));
        TextView note = text("Not-Ausgang: zählt als Abbruch der Session.", 13, 0xFF8A8A8A, false);
        col.addView(note, margins(dp(10), 0));
        return root;
    }

    /** Gedrückt halten: Fortschritt zählt hoch, nach 3 s wird die Session abgebrochen. */
    private final Runnable hold = new Runnable() {
        @Override public void run() {
            if (holdStart == 0 || holdLabel == null) return;
            long held = System.currentTimeMillis() - holdStart;
            if (held >= HOLD_MS) { holdStart = 0; abortSession(); return; }
            long rest = (HOLD_MS - held + 999) / 1000;
            holdLabel.setText("Weiter halten … " + rest);
            handler.postDelayed(this, 50);
        }
    };

    private void resetHold() {
        holdStart = 0;
        handler.removeCallbacks(hold);
        if (holdLabel != null) holdLabel.setText("Session beenden · 3 s halten");
    }

    private void abortSession() {
        state.abort();      // Focus liest das beim nächsten Öffnen und beendet die Session als „vorzeitig“
        openFocus();
        finish(false);
    }

    private void openFocus() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { startActivity(i); } catch (Exception ignored) {}
        hideOverlay();
        foreground = getPackageName();
    }

    private String label(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (Exception e) { return "Diese App"; }
    }

    // ---------- Benachrichtigungen ----------

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel run = new NotificationChannel(CH_RUN, "Laufende Session", NotificationManager.IMPORTANCE_LOW);
        run.setDescription("Zeigt, bis wann Apps gesperrt sind");
        NotificationChannel done = new NotificationChannel(CH_DONE, "Session vorbei", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("Meldet, wenn eine Focus-Session zu Ende ist");
        nm.createNotificationChannel(run);
        nm.createNotificationChannel(done);
    }

    private PendingIntent openFocusIntent() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent();
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(until);
        return new NotificationCompat.Builder(this, CH_RUN)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("Focus-Session läuft")
            .setContentText(Texts.notification(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), blocked == null ? 0 : blocked.size()))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openFocusIntent())
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void finish(boolean completed) {
        running = false;
        handler.removeCallbacksAndMessages(null);
        hideOverlay();
        if (completed) {
            state.stop();
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (Apps.hasNotifications(this)) nm.notify(NID_DONE, new NotificationCompat.Builder(this, CH_DONE)
                .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
                .setContentTitle("Session geschafft")
                .setContentText("Deine Apps sind wieder frei. Öffne Focus für die Auswertung.")
                .setAutoCancel(true)
                .setContentIntent(openFocusIntent())
                .build());
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        hideOverlay();
        super.onDestroy();
    }

    // ---------- kleine View-Helfer ----------

    private int dp(int v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView button(String s, int bg, int fg, int stroke) {
        TextView b = text(s, 17, fg, true);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(14));
        d.setStroke(dp(2), stroke);
        b.setBackground(d);
        b.setPadding(dp(16), dp(16), dp(16), dp(16));
        b.setClickable(true);
        b.setFocusable(true);
        return b;
    }

    private LinearLayout.LayoutParams margins(int top, int bottom) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        lp.bottomMargin = bottom;
        return lp;
    }
}
