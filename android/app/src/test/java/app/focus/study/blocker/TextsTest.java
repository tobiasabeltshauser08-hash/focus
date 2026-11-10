package app.focus.study.blocker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Gleiche Fälle wie tests/test.js für js/blocker.js, damit Web und Android dieselben Texte zeigen. */
public class TextsTest {
    @Test
    public void remain() {
        assertEquals("gleich vorbei", Texts.remain(0));
        assertEquals("noch 1 min", Texts.remain(1_000));
        assertEquals("noch 1 min", Texts.remain(60_000));
        assertEquals("noch 23 min", Texts.remain(22 * 60_000 + 1));
        assertEquals("noch 59 min", Texts.remain(59 * 60_000));
        assertEquals("noch 1 h", Texts.remain(60 * 60_000));
        assertEquals("noch 1 h 5 min", Texts.remain(65 * 60_000));
        assertEquals("noch 2 h", Texts.remain(120 * 60_000));
    }

    @Test
    public void notification() {
        assertEquals("Fokus bis 18:45 · 3 Apps gesperrt", Texts.notification(18, 45, 3));
        assertEquals("Fokus bis 09:05 · 1 App gesperrt", Texts.notification(9, 5, 1));
        assertEquals("Fokus bis 00:00 · keine App gesperrt", Texts.notification(0, 0, 0));
    }
}
