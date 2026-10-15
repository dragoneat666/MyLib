package club.denflix.mylib

import club.denflix.mylib.ScanLogic.Line
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanLogicTest {
    @Test
    fun bookBarcodes() {
        assertEquals("9780679824114", ScanLogic.isbnFromBarcode("9780679824114"))
        assertEquals("9781593696832", ScanLogic.isbnFromBarcode("978-1-59369-683-2"))
        assertEquals("9780439398749", ScanLogic.isbnFromBarcode("0439398746"))
        assertEquals("9781609583712", ScanLogic.isbnFromBarcode("160958371X"))
    }

    @Test
    fun nonBookBarcodes() {
        assertNull(ScanLogic.isbnFromBarcode("012345678905")) // UPC-A grocery code
        assertNull(ScanLogic.isbnFromBarcode("9780679824115")) // bad check digit
        assertNull(ScanLogic.isbnFromBarcode("4006381333931")) // EAN-13, not a book
        assertNull(ScanLogic.isbnFromBarcode(null))
    }

    @Test
    fun frontCoverVsBackCover() {
        val front = listOf(Line("MAGIC TREE HOUSE", 60), Line("Mummies in the Morning", 90), Line("Mary Pope Osborne", 40))
        assertTrue(ScanLogic.looksLikeCover(front, 1280))
        val back = (1..30).map { Line("small blurb text line number $it", 18) }
        assertFalse(ScanLogic.looksLikeCover(back, 1280))
        assertFalse(ScanLogic.looksLikeCover(listOf(Line("ok", 200)), 1280))
    }

    @Test
    fun biggestTextFirst() {
        val lines = listOf(Line("by Mary Pope Osborne", 30), Line("Night of the Ninjas", 80), Line("#5", 50), Line("Night of the Ninjas", 70))
        assertEquals(listOf("Night of the Ninjas", "#5", "by Mary Pope Osborne"), ScanLogic.linesBySize(lines))
    }
}
