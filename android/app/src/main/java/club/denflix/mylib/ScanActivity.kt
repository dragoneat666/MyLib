package club.denflix.mylib

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.snackbar.Snackbar
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * One camera, two kinds of scan:
 *  - a book barcode (ISBN) is recognised automatically on any frame;
 *  - a front cover (a few lines of big text, no barcode) is photographed and
 *    identified by the server — automatically after holding still, or with the button.
 */
class ScanActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_COLLECTION = "collection"
        const val EXTRA_ADDED = "added"
        const val EXTRA_OPEN_PATH = "openPath"
        private const val COVER_HOLD_MS = 2200L
        private const val SAME_ISBN_COOLDOWN_MS = 2500L
    }

    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var previewView: PreviewView
    private lateinit var status: TextView
    private lateinit var busyView: ProgressBar
    private lateinit var counter: TextView
    private lateinit var spinner: Spinner

    private lateinit var cameraExecutor: ExecutorService
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private val barcodeScanner: BarcodeScanner by lazy {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128)
                .build()
        )
    }
    private val textRecognizer: TextRecognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    // State (only touched on the main thread)
    @Volatile private var paused = false
    private var lastTextRun = 0L
    private var coverSince = 0L
    private var lastIsbn: String? = null
    private var lastIsbnAt = 0L
    private var resumeAt = 0L
    private var added = 0
    private var torchOn = false
    // Index 0 is always "New & Unsorted" (id 0): books not in a collection yet.
    private var collections: List<LibCollection> = emptyList()
    private var currentCollectionId = 0
    private var allTags: List<String> = emptyList()
    // "Tag every book I scan" — only for this scanning session.
    private var autoTags: List<String> = emptyList()
    private lateinit var autoTagsView: TextView
    private lateinit var rootView: View

    private val selectedCollection: LibCollection?
        get() = collections.getOrNull(spinner.selectedItemPosition)

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else {
            Toast.makeText(this, R.string.camera_needed, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scan)
        prefs = Prefs(this)
        api = Api(prefs.server!!)
        cameraExecutor = Executors.newSingleThreadExecutor()

        previewView = findViewById(R.id.preview)
        status = findViewById(R.id.status)
        busyView = findViewById(R.id.busy)
        counter = findViewById(R.id.counter)
        spinner = findViewById(R.id.collection)
        autoTagsView = findViewById(R.id.autoTags)
        rootView = findViewById(android.R.id.content)
        autoTagsView.setOnClickListener { chooseAutoTags() }

        findViewById<View>(R.id.close).setOnClickListener { finishWithResult() }
        findViewById<View>(R.id.shutter).setOnClickListener { if (!paused) captureCover() }
        findViewById<View>(R.id.torch).setOnClickListener {
            torchOn = !torchOn
            camera?.cameraControl?.enableTorch(torchOn)
        }
        findViewById<View>(R.id.typeIt).setOnClickListener { openWebAdd(null) }
        previewView.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP) {
                val point = previewView.meteringPointFactory.createPoint(e.x, e.y)
                camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point).build())
                v.performClick()
            }
            true
        }
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finishWithResult()
        })

        // Opened from a collection's page → that collection; otherwise New & Unsorted.
        loadCollections(intent.getIntExtra(EXTRA_COLLECTION, 0))
        loadTags()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else permission.launch(Manifest.permission.CAMERA)
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        barcodeScanner.close()
        textRecognizer.close()
    }

    // ── Collections ─────────────────────────────────────────────────────────
    private fun loadCollections(preferId: Int) {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.collections() } }
            result.onSuccess { fetched ->
                val list = listOf(LibCollection(0, "New & Unsorted", 0)) + fetched
                collections = list
                val labels = list.map { it.name } + "+ New collection…"
                spinner.adapter = ArrayAdapter(this@ScanActivity, android.R.layout.simple_spinner_item, labels).apply {
                    setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                }
                val index = list.indexOfFirst { it.id == preferId }.takeIf { it >= 0 } ?: 0
                currentCollectionId = list[index].id
                spinner.setSelection(index, false)
                (spinner.selectedView as? TextView)?.setTextColor(0xFFFFFFFF.toInt())
                spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                    override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                        (view as? TextView)?.setTextColor(0xFFFFFFFF.toInt())
                        // Stays on this choice until the scanner is closed.
                        if (position == list.size) newCollectionDialog() else currentCollectionId = list[position].id
                    }
                    override fun onNothingSelected(parent: AdapterView<*>?) {}
                }
            }.onFailure { handleError(it) }
        }
    }

    private fun newCollectionDialog() {
        val input = EditText(this).apply { hint = "Collection name"; setSingleLine() }
        val box = LinearLayout(this).apply { setPadding(60, 20, 60, 0); addView(input, LinearLayout.LayoutParams(-1, -2)) }
        AlertDialog.Builder(this)
            .setTitle("New collection")
            .setView(box)
            .setPositiveButton("Create") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isEmpty()) return@setPositiveButton loadCollections(currentCollectionId)
                lifecycleScope.launch {
                    val r = withContext(Dispatchers.IO) { runCatching { api.createCollection(name) } }
                    r.onSuccess { loadCollections(it) }.onFailure { handleError(it); loadCollections(currentCollectionId) }
                }
            }
            .setNegativeButton("Cancel") { _, _ -> loadCollections(currentCollectionId) }
            .setCancelable(false)
            .show()
    }

    // ── Tags ────────────────────────────────────────────────────────────────
    private fun loadTags(then: (() -> Unit)? = null) {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) { runCatching { api.tags() } }.onSuccess { allTags = it }
            then?.invoke()
        }
    }

    private fun showAutoTags() {
        autoTagsView.text = if (autoTags.isEmpty()) "Tag every book I scan: off" else "Tagging every book: ${autoTags.joinToString(", ")}"
    }

    private fun chooseAutoTags() {
        paused = true
        loadTags {
            TagPicker.show(this, "Tag every book I scan", allTags, autoTags,
                message = "These tags go on every book you add until you close the scanner.",
                saveLabel = "Use these tags",
                onCancel = { resume() }) { chosen ->
                autoTags = chosen
                showAutoTags()
                resume()
            }
        }
    }

    /** Pick tags for one book (after adding it, or for a replacement copy). */
    private fun tagBook(itemId: Int, title: String, current: List<String>, heading: String, message: String? = null) {
        paused = true
        loadTags {
            TagPicker.show(this, heading, allTags, current, message = message, onCancel = { resume(1200) }) { chosen ->
                lifecycleScope.launch {
                    val r = withContext(Dispatchers.IO) { runCatching { api.setTags(itemId, chosen) } }
                    r.onSuccess {
                        Toast.makeText(this@ScanActivity,
                            if (chosen.isEmpty()) "Tags cleared on “$title”" else "Tagged “$title”: ${chosen.joinToString(", ")}",
                            Toast.LENGTH_SHORT).show()
                    }.onFailure { handleError(it) }
                    resume(1200)
                }
            }
        }
    }

    /** "Added …" message with an Add tag button; scanning carries on meanwhile. */
    private fun announce(message: String, item: JSONObject) {
        Snackbar.make(rootView, message, 10_000)
            .setAnchorView(R.id.status)
            .setAction("Add tag") {
                tagBook(item.getInt("id"), item.optString("title"), parseTags(item.optString("tags")), "Tags for “${item.optString("title")}”")
            }
            .show()
    }

    // ── Camera ──────────────────────────────────────────────────────────────
    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setTargetResolution(android.util.Size(1280, 720))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(cameraExecutor, ::analyze) }
            val capture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            imageCapture = capture
            try {
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
            } catch (e: Exception) {
                setStatus("Camera unavailable: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun analyze(proxy: ImageProxy) {
        val media = proxy.image
        if (paused || media == null || SystemClock.elapsedRealtime() < resumeAt) {
            proxy.close(); return
        }
        val rotation = proxy.imageInfo.rotationDegrees
        val uprightHeight = if (rotation == 90 || rotation == 270) proxy.width else proxy.height
        val input = InputImage.fromMediaImage(media, rotation)

        barcodeScanner.process(input).addOnCompleteListener(ContextCompat.getMainExecutor(this)) { task ->
            val codes = if (task.isSuccessful) task.result else null
            val isbn = codes?.firstNotNullOfOrNull { ScanLogic.isbnFromBarcode(it.rawValue) }
            val now = SystemClock.elapsedRealtime()
            // The same book still in view shouldn't pop up again: it must leave the frame first.
            val sameBook = isbn != null && isbn == lastIsbn && now - lastIsbnAt < SAME_ISBN_COOLDOWN_MS
            if (sameBook) lastIsbnAt = now
            if (isbn != null && !paused && !sameBook) {
                proxy.close()
                onIsbn(isbn)
                return@addOnCompleteListener
            }
            if (codes?.isNotEmpty() == true) coverSince = 0 // a barcode is in view: not a front cover
            if (now - lastTextRun < 650 || paused) {
                proxy.close(); return@addOnCompleteListener
            }
            lastTextRun = now
            textRecognizer.process(input).addOnCompleteListener(ContextCompat.getMainExecutor(this)) { t ->
                proxy.close()
                if (!paused) onFrameText(if (t.isSuccessful) t.result else null, uprightHeight)
            }
        }
    }

    private fun onFrameText(text: Text?, frameHeight: Int) {
        val lines = text?.textBlocks?.flatMap { b -> b.lines.map { ScanLogic.Line(it.text, it.boundingBox?.height() ?: 0) } }.orEmpty()
        val now = SystemClock.elapsedRealtime()
        if (ScanLogic.looksLikeCover(lines, frameHeight)) {
            if (coverSince == 0L) coverSince = now
            val held = now - coverSince
            if (held >= COVER_HOLD_MS) {
                coverSince = 0
                captureCover()
            } else setStatus("Looks like a cover — hold still…")
        } else {
            coverSince = 0
            setStatus(getString(R.string.scan_hint))
        }
    }

    private fun setStatus(s: String) {
        if (status.text != s) status.text = s
    }

    private fun setBusy(on: Boolean, message: String? = null) {
        busyView.visibility = if (on) View.VISIBLE else View.GONE
        message?.let { setStatus(it) }
    }

    private fun vibrate() {
        runCatching { getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(50, VibrationEffect.DEFAULT_AMPLITUDE)) }
    }

    private fun resume(delayMs: Long = 800) {
        paused = false
        coverSince = 0
        lastIsbnAt = SystemClock.elapsedRealtime() + delayMs // restart the "same book" window
        resumeAt = SystemClock.elapsedRealtime() + delayMs
        setBusy(false, getString(R.string.scan_hint))
    }

    // ── Barcode flow ────────────────────────────────────────────────────────
    private fun onIsbn(isbn: String) {
        paused = true
        lastIsbn = isbn
        lastIsbnAt = SystemClock.elapsedRealtime()
        vibrate()
        setBusy(true, "Looking up $isbn…")
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.lookupIsbn(isbn) } }
            setBusy(false)
            result.onSuccess { book ->
                showResults("Scanned ISBN $isbn", listOf(book), photo = null, isbn = isbn)
            }.onFailure { err ->
                if (err is ApiException && err.status == 404) showNotFound(isbn, err.body)
                else {
                    handleError(err)
                    lastIsbnAt = SystemClock.elapsedRealtime()
                    resume(1500)
                }
            }
        }
    }

    // ── Cover flow ──────────────────────────────────────────────────────────
    private fun captureCover() {
        val capture = imageCapture ?: return
        paused = true
        vibrate()
        setBusy(true, "Reading the cover…")
        capture.takePicture(cameraExecutor, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                val bitmap = runCatching { imageToBitmap(image) }.getOrNull()
                image.close()
                runOnUiThread {
                    if (bitmap == null) {
                        Toast.makeText(this@ScanActivity, "Couldn't take the photo", Toast.LENGTH_SHORT).show()
                        resume()
                    } else identifyCover(bitmap)
                }
            }

            override fun onError(exception: ImageCaptureException) {
                runOnUiThread {
                    Toast.makeText(this@ScanActivity, "Camera error: ${exception.message}", Toast.LENGTH_SHORT).show()
                    resume()
                }
            }
        })
    }

    private fun imageToBitmap(image: ImageProxy): Bitmap {
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        val rotation = image.imageInfo.rotationDegrees
        if (rotation != 0) {
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
        }
        val max = 1600
        val scale = max.toFloat() / maxOf(bmp.width, bmp.height)
        return if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
    }

    private fun identifyCover(bitmap: Bitmap) {
        textRecognizer.process(InputImage.fromBitmap(bitmap, 0)).addOnCompleteListener(ContextCompat.getMainExecutor(this)) { t ->
            val lines = (if (t.isSuccessful) t.result else null)?.textBlocks?.flatMap { b -> b.lines.map { ScanLogic.Line(it.text, it.boundingBox?.height() ?: 0) } }.orEmpty()
            val sorted = ScanLogic.linesBySize(lines)
            val jpeg = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
            setBusy(true, "Finding this book…")
            lifecycleScope.launch {
                val result = withContext(Dispatchers.IO) { runCatching { api.identifyCover(jpeg, sorted) } }
                setBusy(false)
                result.onSuccess { r ->
                    val list = r.optJSONArray("results").toList()
                    val heading = if (list.isEmpty()) "No match for that cover" else "Is it one of these?"
                    showResults(heading, list.take(6), photo = jpeg, isbn = null, query = sorted.take(3).joinToString(" "))
                }.onFailure {
                    handleError(it)
                    resume(1500)
                }
            }
        }
    }

    // ── Results ─────────────────────────────────────────────────────────────
    private fun JSONArray?.toList(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

    private fun showNotFound(isbn: String, body: JSONObject?) {
        val dialog = BottomSheetDialog(this)
        val root = sheetRoot("Couldn't find ISBN $isbn online")
        val owned = body?.optJSONArray("owned").toList()
        var handled = false
        if (owned.isNotEmpty()) {
            // Not online, but it's already in MyLib: same three choices as any duplicate.
            val book = owned.first()
            root.addView(TextView(this).apply {
                text = "✓ Already in MyLib: “${book.optString("title")}” in ${book.optString("collection_name")}"
                setTextColor(ContextCompat.getColor(this@ScanActivity, R.color.success))
                setPadding(0, 8, 0, 8)
            })
            root.addView(button("Replacement copy — retag it", outlined = true) { handled = true; dialog.dismiss(); replaceCopy(owned) })
            root.addView(button("Add 2nd copy") { handled = true; dialog.dismiss(); addCopy(owned) })
            root.addView(button("Ignore", outlined = true) { dialog.dismiss() })
        } else {
            root.addView(TextView(this).apply {
                text = "You can photograph the cover instead, or type the details in."
                setPadding(0, 8, 0, 16)
            })
            root.addView(button("Photograph the cover") { handled = true; dialog.dismiss(); captureCover() })
            root.addView(button("Type it in", outlined = true) { handled = true; dialog.dismiss(); openWebAdd(isbn) })
        }
        dialog.setContentView(root.parent as View)
        dialog.setOnDismissListener { if (!handled) resume(1500) }
        dialog.show()
    }

    private fun showResults(heading: String, results: List<JSONObject>, photo: ByteArray?, isbn: String?, query: String? = null) {
        val dialog = BottomSheetDialog(this)
        val root = sheetRoot(heading)
        var handled = false
        val usePhoto = CheckBox(this).apply { text = "Use my photo as the cover"; isChecked = false }

        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)

        fun render(items: List<JSONObject>) {
            list.removeAllViews()
            if (items.isEmpty()) list.addView(TextView(this).apply { text = "Nothing found."; setPadding(0, 12, 0, 12) })
            for (book in items) list.addView(resultRow(book) { action ->
                handled = true
                dialog.dismiss()
                val owned = book.optJSONArray("owned").toList()
                when (action) {
                    "add" -> addBook(book, if (photo != null && usePhoto.isChecked) photo else null)
                    "copy" -> addCopy(owned)
                    "replace" -> replaceCopy(owned)
                    else -> {
                        Toast.makeText(this, "Ignored", Toast.LENGTH_SHORT).show()
                        resume(1500)
                    }
                }
            })
        }
        render(results)

        if (photo != null) root.addView(usePhoto)

        if (isbn == null) {
            // Let her fix the search if the cover text was misread.
            val search = EditText(this).apply { hint = "Search by title or author"; setSingleLine(); setText(query.orEmpty()) }
            root.addView(search)
            root.addView(button("Search", outlined = true) {
                val q = search.text.toString().trim()
                if (q.isEmpty()) return@button
                lifecycleScope.launch {
                    val r = withContext(Dispatchers.IO) { runCatching { api.search(q) } }
                    r.onSuccess {
                        (root.getChildAt(0) as? TextView)?.text = "Search results"
                        render(it.toList().take(8))
                    }.onFailure { handleError(it) }
                }
            })
        }
        root.addView(button("Not it — type it in", outlined = true) { handled = true; dialog.dismiss(); openWebAdd(isbn) })

        dialog.setContentView(root.parent as View)
        dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED
        dialog.setOnDismissListener { if (!handled) resume(1500) }
        dialog.show()
    }

    private fun sheetRoot(heading: String): LinearLayout {
        val scroll = androidx.core.widget.NestedScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 36, 48, 48)
        }
        scroll.addView(root, ViewGroup.LayoutParams(-1, -2))
        root.addView(TextView(this).apply {
            text = heading
            textSize = 20f
            typeface = android.graphics.Typeface.SERIF
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(this@ScanActivity, R.color.text))
        })
        root.addView(TextView(this).apply {
            text = "Adding to: ${selectedCollection?.name ?: "—"}"
            setTextColor(ContextCompat.getColor(this@ScanActivity, R.color.muted))
            setPadding(0, 4, 0, 4)
        })
        return root
    }

    private fun button(label: String, outlined: Boolean = false, onClick: () -> Unit): Button {
        val style = if (outlined) com.google.android.material.R.attr.materialButtonOutlinedStyle else com.google.android.material.R.attr.materialButtonStyle
        return com.google.android.material.button.MaterialButton(this, null, style).apply {
            text = label
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = 12 }
        }
    }

    private fun resultRow(book: JSONObject, onAction: (String) -> Unit): View {
        val row = LayoutInflater.from(this).inflate(R.layout.item_result, null, false)
        row.findViewById<TextView>(R.id.title).text = listOf(book.optString("title"), book.optString("subtitle")).filter { it.isNotBlank() && it != "null" }.joinToString(": ")
        val authors = book.optJSONArray("authors")
        row.findViewById<TextView>(R.id.author).text = (0 until (authors?.length() ?: 0)).joinToString { authors!!.getString(it) }
        val nyt = book.optJSONObject("nyt")
        row.findViewById<TextView>(R.id.meta).text = (listOf("publisher", "publish_date", "isbn13")
            .mapNotNull { k -> book.optString(k).takeIf { it.isNotBlank() && it != "null" } } +
            listOfNotNull(nyt?.let { "★ NYT Bestseller (${it.optInt("weeks")} weeks)" })).joinToString(" · ")
        val owned = book.optJSONArray("owned").toList()
        if (owned.isNotEmpty()) {
            row.findViewById<TextView>(R.id.owned).apply {
                visibility = View.VISIBLE
                text = "✓ Already in " + owned.joinToString { o -> o.optString("collection_name") + (if (o.optInt("copies") > 1) " (×${o.optInt("copies")})" else "") }
            }
            row.findViewById<View>(R.id.ownedActions).visibility = View.VISIBLE
            row.findViewById<View>(R.id.newActions).visibility = View.GONE
            row.findViewById<View>(R.id.replace).setOnClickListener { onAction("replace") }
            row.findViewById<View>(R.id.copy).setOnClickListener { onAction("copy") }
            row.findViewById<View>(R.id.ignore).setOnClickListener { onAction("ignore") }
        }
        row.findViewById<Button>(R.id.add).apply {
            text = "Add to ${selectedCollection?.name ?: "New & Unsorted"}"
            setOnClickListener { onAction("add") }
        }
        val cover = row.findViewById<ImageView>(R.id.cover)
        book.optString("cover_url").takeIf { it.isNotBlank() && it != "null" }?.let { url ->
            lifecycleScope.launch {
                val bytes = withContext(Dispatchers.IO) { api.imageBytes(url) }
                bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.let { cover.setImageBitmap(it) }
            }
        }
        return row
    }

    private fun addBook(book: JSONObject, photo: ByteArray?) {
        val target = selectedCollection ?: LibCollection(0, "New & Unsorted", 0)
        val tags = autoTags
        setBusy(true, "Adding…")
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) {
                runCatching {
                    val item = api.addItem(target.id, book, tags)
                    if (photo != null) api.uploadCover(item.getInt("id"), photo) else item
                }
            }
            r.onSuccess {
                added++
                counter.text = "$added added"
                announce("Added “${it.optString("title")}” to ${target.name}", it)
            }.onFailure { handleError(it) }
            resume(1200)
        }
    }

    /** The copy we already have — preferring the one in the collection she's adding to. */
    private fun pickOwned(owned: List<JSONObject>): JSONObject =
        owned.firstOrNull { it.optInt("collection_id") == (selectedCollection?.id ?: 0) } ?: owned.first()

    private fun addCopy(owned: List<JSONObject>) {
        val book = pickOwned(owned)
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { api.addCopy(book.getInt("id"), autoTags) } }
            r.onSuccess {
                added++
                counter.text = "$added added"
                announce("“${it.optString("title")}”: now ${it.optInt("copies")} copies", it)
            }.onFailure { handleError(it) }
            resume(1200)
        }
    }

    /** "Replacement copy — retag it": the copy count stays the same; just pick its tags. */
    private fun replaceCopy(owned: List<JSONObject>) {
        val book = pickOwned(owned)
        val current = (parseTags(book.optString("tags")) + autoTags).distinctBy { it.lowercase() }
        tagBook(book.getInt("id"), book.optString("title"), current,
            heading = "Replacement copy — retag it",
            message = "“${book.optString("title")}” keeps its copy count. Pick the tags this copy should have.")
    }

    private fun openWebAdd(isbn: String?) {
        val c = selectedCollection?.id ?: 0
        val path = "/add?collection=$c" + (isbn?.let { "&q=$it" } ?: "")
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_ADDED, added).putExtra(EXTRA_OPEN_PATH, path))
        finish()
    }

    private fun handleError(err: Throwable) {
        Toast.makeText(this, err.message ?: "Something went wrong", Toast.LENGTH_LONG).show()
    }

    private fun finishWithResult() {
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_ADDED, added))
        finish()
    }
}
