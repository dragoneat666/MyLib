package club.denflix.mylib

/** Pure helpers for deciding what the camera is looking at (unit tested in src/test). */
object ScanLogic {

    /** Returns a book ISBN-13 for a scanned barcode value, or null if it isn't a book barcode. */
    fun isbnFromBarcode(raw: String?): String? {
        val digits = raw?.filter { it.isDigit() || it == 'X' || it == 'x' }?.uppercase() ?: return null
        if (digits.length == 13 && (digits.startsWith("978") || digits.startsWith("979")) && validIsbn13(digits)) return digits
        if (digits.length == 10 && validIsbn10(digits)) return isbn10to13(digits)
        return null
    }

    fun validIsbn13(s: String): Boolean {
        if (s.length != 13 || !s.all { it.isDigit() }) return false
        val sum = s.mapIndexed { i, c -> (c - '0') * if (i % 2 == 0) 1 else 3 }.sum()
        return sum % 10 == 0
    }

    fun validIsbn10(s: String): Boolean {
        if (s.length != 10 || !s.substring(0, 9).all { it.isDigit() }) return false
        val last = s[9]
        if (!last.isDigit() && last != 'X') return false
        val sum = s.mapIndexed { i, c -> (if (c == 'X') 10 else c - '0') * (10 - i) }.sum()
        return sum % 11 == 0
    }

    fun isbn10to13(s: String): String {
        val core = "978" + s.substring(0, 9)
        val sum = core.mapIndexed { i, c -> (c - '0') * if (i % 2 == 0) 1 else 3 }.sum()
        return core + ((10 - sum % 10) % 10)
    }

    data class Line(val text: String, val height: Int)

    /**
     * A front cover has a few lines of big text (title, author); a back cover or
     * a page has many lines of small text. frameHeight is the upright image height.
     */
    fun looksLikeCover(lines: List<Line>, frameHeight: Int): Boolean {
        if (frameHeight <= 0) return false
        val useful = lines.filter { l -> l.text.count { it.isLetter() } >= 2 }
        if (useful.isEmpty() || useful.size > 22) return false
        val letters = useful.sumOf { l -> l.text.count { it.isLetter() } }
        if (letters < 6) return false
        val biggest = useful.maxOf { it.height }
        return biggest.toFloat() / frameHeight >= 0.045f
    }

    /** Biggest text first: titles are usually the largest words on a cover. */
    fun linesBySize(lines: List<Line>): List<String> =
        lines.filter { l -> l.text.any { it.isLetterOrDigit() } }
            .sortedByDescending { it.height }
            .map { it.text.trim() }
            .distinct()
            .take(30)
}
