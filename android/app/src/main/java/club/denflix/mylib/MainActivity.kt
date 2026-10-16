package club.denflix.mylib

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * The phone app shows the same web app as the browser, so everything works the
 * same way. The page gets a small bridge (window.MyLibAndroid) that opens the
 * native camera scanner.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var offline: View
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var mainFrameFailed = false
    // A page that never finishes loading (e.g. NetBird still connecting) shows the
    // "Can't reach your library" screen instead of staying blank.
    private val loadTimeout = android.os.Handler(android.os.Looper.getMainLooper())
    private val showOffline = Runnable {
        mainFrameFailed = true
        web.stopLoading()
        offline.visibility = View.VISIBLE
    }

    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val added = result.data?.getIntExtra(ScanActivity.EXTRA_ADDED, 0) ?: 0
        if (added > 0) web.evaluateJavascript("window.mylibRefresh && window.mylibRefresh()", null)
        result.data?.getStringExtra(ScanActivity.EXTRA_OPEN_PATH)?.let { web.loadUrl(prefs.server + it) }
    }

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.isConnected) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        offline = findViewById(R.id.offline)
        val loading = findViewById<View>(R.id.loading)

        val base = prefs.server!!
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            userAgentString = "$userAgentString MyLibAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "MyLibAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith(base)) return false
                // Links to other sites (Open Library, Google…) open in the browser.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                mainFrameFailed = false
                loading.visibility = View.VISIBLE
                loadTimeout.removeCallbacks(showOffline)
                loadTimeout.postDelayed(showOffline, 20_000)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                loadTimeout.removeCallbacks(showOffline)
                loading.visibility = View.GONE
                offline.visibility = if (mainFrameFailed) View.VISIBLE else View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    offline.visibility = View.VISIBLE
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileLauncher.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        // CSV exports, backups and the APK are downloads; hand them to Android's download manager.
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("User-Agent", userAgent)
                .setMimeType(mimeType)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
        }

        findViewById<View>(R.id.retry).setOnClickListener {
            offline.visibility = View.GONE
            web.reload()
        }
        findViewById<View>(R.id.changeServer).setOnClickListener { changeServer() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(base)
    }

    override fun onDestroy() {
        super.onDestroy()
        loadTimeout.removeCallbacks(showOffline)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    private fun openScanner(collectionId: Int) {
        val intent = Intent(this, ScanActivity::class.java)
            .putExtra(ScanActivity.EXTRA_COLLECTION, collectionId)
        scanLauncher.launch(intent)
    }

    private fun changeServer() {
        startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_EDIT, true))
        finish()
    }

    /** Methods the web page can call: window.MyLibAndroid.scan(collectionId), .changeServer() */
    inner class Bridge {
        @JavascriptInterface
        fun scan(collectionId: Int) {
            runOnUiThread { openScanner(collectionId) }
        }

        @JavascriptInterface
        fun changeServer() {
            runOnUiThread { this@MainActivity.changeServer() }
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }
}
