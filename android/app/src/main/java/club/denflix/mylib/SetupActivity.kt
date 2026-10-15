package club.denflix.mylib

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** First screen: the server address. There are no logins — MyLib is only on the home network / NetBird. */
class SetupActivity : AppCompatActivity() {
    companion object {
        /** Opened from "Change server" rather than on first launch. */
        const val EXTRA_EDIT = "edit"
    }

    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        prefs = Prefs(this)

        val server = findViewById<EditText>(R.id.server)
        val error = findViewById<TextView>(R.id.error)
        val button = findViewById<Button>(R.id.connect)
        val progress = findViewById<ProgressBar>(R.id.progress)

        server.setText(prefs.server ?: "http://")
        server.setSelection(server.text.length)

        fun submit() {
            val base = Prefs.normalizeServer(server.text.toString())
            if (base.length < 10) {
                error.text = "Enter the server address, e.g. http://100.64.0.5:14100"
                error.visibility = View.VISIBLE
                return
            }
            error.visibility = View.GONE
            button.isEnabled = false
            progress.visibility = View.VISIBLE
            lifecycleScope.launch {
                // Make sure the address really is a MyLib server before saving it.
                val result = withContext(Dispatchers.IO) { runCatching { Api(base).health() } }
                progress.visibility = View.GONE
                button.isEnabled = true
                val ok = result.getOrNull()?.optString("status") == "ok"
                if (ok) {
                    prefs.server = base
                    startActivity(Intent(this@SetupActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                } else {
                    error.text = result.exceptionOrNull()?.message?.let { "$it\n\nCheck the address and port." }
                        ?: "That address answered, but it isn't a MyLib server."
                    error.visibility = View.VISIBLE
                }
            }
        }

        button.setOnClickListener { submit() }
        server.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO) {
                submit(); true
            } else false
        }

        // Back out of "Change server" to the library without changing anything.
        if (intent.getBooleanExtra(EXTRA_EDIT, false) && prefs.isConnected) {
            onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    startActivity(Intent(this@SetupActivity, MainActivity::class.java))
                    finish()
                }
            })
        }
    }
}
