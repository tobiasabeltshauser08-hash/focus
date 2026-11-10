package app.focus.study.blocker;

import java.util.Locale;

/** Texte für Benachrichtigung und Sperrbildschirm. Gleiche Regeln wie js/blocker.js (beide getestet). */
public final class Texts {
    private Texts() {}

    /** Restzeit, aufgerundet auf volle Minuten: „noch 23 min“, „noch 1 h 5 min“, „noch 2 h“. */
    public static String remain(long ms) {
        if (ms <= 0) return "gleich vorbei";
        long min = (ms + 59_999) / 60_000;
        if (min < 60) return "noch " + min + " min";
        long h = min / 60, m = min % 60;
        return m == 0 ? "noch " + h + " h" : "noch " + h + " h " + m + " min";
    }

    /** „Fokus bis 18:45 · 3 Apps gesperrt“ */
    public static String notification(int hour, int minute, int apps) {
        String count = apps == 0 ? "keine App gesperrt" : apps == 1 ? "1 App gesperrt" : apps + " Apps gesperrt";
        return String.format(Locale.GERMANY, "Fokus bis %02d:%02d · %s", hour, minute, count);
    }
}
