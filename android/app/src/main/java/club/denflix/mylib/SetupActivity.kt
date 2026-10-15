package club.denflix.mylib

import android.content.Intent
import android.os.Build
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

/** First screen: server address + username/password. */
class SetupActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        prefs = Prefs(this)

        val server = findViewById<EditText>(R.id.server)
        val username = findViewById<EditText>(R.id.username)
        val password = findViewById<EditText>(R.id.password)
        val error = findViewById<TextView>(R.id.error)
        val button = findViewById<Button>(R.id.signIn)
        val progress = findViewById<ProgressBar>(R.id.progress)

        server.setText(prefs.server ?: "http://")
        username.setText(prefs.username.orEmpty())

        fun submit() {
            val base = Prefs.normalizeServer(server.text.toString())
            val user = username.text.toString().trim()
            val pass = password.text.toString()
            if (base.length < 10 || user.isEmpty() || pass.isEmpty()) {
                error.text = "Fill in the server address, username and password."
                error.visibility = View.VISIBLE
                return
            }
            error.visibility = View.GONE
            button.isEnabled = false
            progress.visibility = View.VISIBLE
            lifecycleScope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        Api(base, null).health()
                        Api(base, null).login(user, pass, "MyLib app on ${Build.MANUFACTURER} ${Build.MODEL}")
                    }
                }
                progress.visibility = View.GONE
                button.isEnabled = true
                result.onSuccess { token ->
                    prefs.server = base
                    prefs.username = user
                    prefs.token = token
                    startActivity(Intent(this@SetupActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }.onFailure {
                    error.text = it.message ?: "Couldn't sign in"
                    error.visibility = View.VISIBLE
                }
            }
        }

        button.setOnClickListener { submit() }
        password.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submit(); true
            } else false
        }
    }
}
