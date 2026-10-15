package club.denflix.mylib

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(message: String, val status: Int = 0, val body: JSONObject? = null) : IOException(message)

data class LibCollection(val id: Int, val name: String, val count: Int) {
    override fun toString() = name
}

/** Blocking calls to the MyLib server — always call from a background thread. */
class Api(base: String) {
    private val base = base.trimEnd('/')

    companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
        private val JSON = "application/json".toMediaType()
    }

    private fun request(path: String) = Request.Builder().url(base + path)

    private fun execute(req: Request): JSONObject {
        try {
            client.newCall(req).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (!res.isSuccessful) {
                    val msg = json?.optString("error")?.takeIf { it.isNotBlank() }
                        ?: "Server error (${res.code})"
                    throw ApiException(msg, res.code, json)
                }
                return json ?: JSONObject()
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: IOException) {
            throw ApiException("Can't reach the library. Is NetBird connected?")
        }
    }

    private fun get(path: String) = execute(request(path).get().build())
    private fun post(path: String, body: RequestBody) = execute(request(path).post(body).build())
    private fun postJson(path: String, json: JSONObject) = post(path, json.toString().toRequestBody(JSON))

    fun health(): JSONObject = execute(Request.Builder().url("$base/health").get().build())

    fun collections(): List<LibCollection> {
        val arr = get("/api/collections").getJSONArray("collections")
        return (0 until arr.length()).map {
            val c = arr.getJSONObject(it)
            LibCollection(c.getInt("id"), c.getString("name"), c.optInt("item_count"))
        }
    }

    /** Creates a collection and returns its id. */
    fun createCollection(name: String): Int =
        postJson("/api/collections", JSONObject().put("name", name)).getInt("id")

    /** Book info for a scanned ISBN. Throws ApiException(status=404) with "owned" in body when unknown. */
    fun lookupIsbn(isbn: String): JSONObject = get("/api/lookup/isbn/$isbn")

    fun search(q: String): JSONArray =
        get("/api/lookup/search?q=" + URLEncoder.encode(q, "UTF-8")).getJSONArray("results")

    /** Identify a book from a cover photo and the text read off it (biggest text first). */
    fun identifyCover(jpeg: ByteArray?, lines: List<String>): JSONObject {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("lines", JSONArray(lines).toString())
        if (jpeg != null) body.addFormDataPart("photo", "cover.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
        return post("/api/lookup/cover", body.build())
    }

    fun addItem(collectionId: Int, metadata: JSONObject): JSONObject =
        postJson("/api/items", JSONObject().put("collection_id", collectionId).put("metadata", metadata))

    fun addCopy(itemId: Int): JSONObject = postJson("/api/items/$itemId/copies", JSONObject().put("delta", 1))

    fun uploadCover(itemId: Int, jpeg: ByteArray): JSONObject {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("cover", "cover.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        return post("/api/items/$itemId/cover", body)
    }

    /** Download an image (cover thumbnails). Relative paths are on our server. */
    fun imageBytes(url: String): ByteArray? {
        val full = if (url.startsWith("/")) base + url else url
        val req = Request.Builder().url(full).build()
        return runCatching { client.newCall(req).execute().use { if (it.isSuccessful) it.body?.bytes() else null } }.getOrNull()
    }
}
