package club.denflix.mylib

import android.content.Context

/** Saved settings: server address and last-used collection. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("mylib", Context.MODE_PRIVATE)

    var server: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()

    var lastCollection: Int
        get() = sp.getInt("lastCollection", 0)
        set(v) = sp.edit().putInt("lastCollection", v).apply()

    val isConnected get() = !server.isNullOrBlank()

    companion object {
        /** "100.64.0.5:14100" → "http://100.64.0.5:14100" (no trailing slash). */
        fun normalizeServer(input: String): String {
            var s = input.trim().trimEnd('/')
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            return s
        }
    }
}
