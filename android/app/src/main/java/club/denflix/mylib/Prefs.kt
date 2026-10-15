package club.denflix.mylib

import android.content.Context

/** Saved connection settings: server address, login token and last-used collection. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("mylib", Context.MODE_PRIVATE)

    var server: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()

    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()

    var username: String?
        get() = sp.getString("username", null)
        set(v) = sp.edit().putString("username", v).apply()

    var lastCollection: Int
        get() = sp.getInt("lastCollection", 0)
        set(v) = sp.edit().putInt("lastCollection", v).apply()

    val isConnected get() = !server.isNullOrBlank() && !token.isNullOrBlank()

    companion object {
        /** "100.64.0.5:14100" → "http://100.64.0.5:14100" (no trailing slash). */
        fun normalizeServer(input: String): String {
            var s = input.trim().trimEnd('/')
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            return s
        }
    }
}
