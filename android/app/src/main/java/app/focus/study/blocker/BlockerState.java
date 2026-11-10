package app.focus.study.blocker;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/**
 * Laufende Sperre, dauerhaft gespeichert. So läuft sie weiter, wenn Focus weggewischt
 * oder der Dienst vom System neu gestartet wird.
 */
public final class BlockerState {
    private static final String PREFS = "focus_blocker";
    private final SharedPreferences p;

    public BlockerState(Context ctx) {
        p = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public long until() { return p.getLong("until", 0); }
    public Set<String> packages() { return new HashSet<>(p.getStringSet("packages", new HashSet<>())); }
    public boolean active() { return until() > System.currentTimeMillis(); }
    /** Zeitpunkt, an dem die Session über den Sperrbildschirm abgebrochen wurde (0 = nicht abgebrochen). */
    public long abortedAt() { return p.getLong("aborted", 0); }

    public void start(long until, Set<String> packages) {
        p.edit().putLong("until", until).putStringSet("packages", new HashSet<>(packages)).putLong("aborted", 0).apply();
    }

    public void stop() { p.edit().remove("until").remove("packages").apply(); }

    public void abort() { p.edit().remove("until").remove("packages").putLong("aborted", System.currentTimeMillis()).apply(); }

    public void clearAborted() { p.edit().remove("aborted").apply(); }
}
