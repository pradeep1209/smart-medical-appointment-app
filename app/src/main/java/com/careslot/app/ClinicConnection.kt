package com.careslot.app

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

data class ClinicServer(val url: String, val id: String, val name: String, val publicKey: String) {
    fun json() = JSONObject().put("url", url).put("id", id).put("name", name).put("publicKey", publicKey).toString()
}

/** Only this class may change the destination of session-bearing requests. */
class ClinicConnection(private val context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("clinic_connection", Context.MODE_PRIVATE)
    fun saved(): ClinicServer? {
        // Preferences publish an atomic string; UI reads must not wait for a network search lock.
        val value = prefs.getString("server", null) ?: return null
        return runCatching { JSONObject(value).let { ClinicServer(ClinicAddress.normalize(it.getString("url"), BuildConfig.DEBUG), it.getString("id"), it.getString("name"), it.getString("publicKey")) } }.getOrNull()
    }
    fun choose(server: ClinicServer) {
      synchronized(SessionVault.lock) {
      val signedIn = SessionVault(context).read() != null
      synchronized(lock) {
        val previous = saved()
        // Never move an existing patient session to a different installation.
        if (!ClinicConnectionRules.canSelect(signedIn, previous?.id, server.id, previous == null && server.url == ClinicAddress.normalize(BuildConfig.API_BASE_URL, BuildConfig.DEBUG))) throw IOException("Sign out before choosing another clinic server. Your current records are preserved.")
        save(server)
      }
      }
    }
    private fun save(server: ClinicServer) { check(prefs.edit().putString("server", server.json()).commit()) { "The clinic connection could not be saved." } }
    fun inspect(value: String): ClinicServer = probe(ClinicAddress.normalize(value, BuildConfig.DEBUG))
    fun discover(): List<ClinicServer> = if (BuildConfig.DEBUG) ClinicDiscovery(context).find() else emptyList()
    fun resolve(): String {
      val signedIn = SessionVault(context).read() != null
      return synchronized(lock) {
        val stored = saved()
        val initial = stored?.url ?: ClinicAddress.normalize(BuildConfig.API_BASE_URL, BuildConfig.DEBUG)
        runCatching { probe(initial) }.getOrNull()?.let { server ->
            if (stored == null || (server.id == stored.id && server.publicKey == stored.publicKey)) {
                save(server); return@synchronized server.url
            }
            // The old DHCP address may now belong to another server. Rediscover only the pinned one.
        }
        if (!BuildConfig.DEBUG) throw IOException("The selected clinic could not be reached.")
        // An old APK's unpaired session may only be bound at its original configured address.
        if (stored == null && signedIn) throw IOException("Reconnect to your original clinic address, or sign out before selecting a new server.")
        if (System.currentTimeMillis() - lastSearch < 12000) throw IOException("The clinic could not be reached. Open Clinic connection to search again.")
        lastSearch = System.currentTimeMillis()
        val found = discover().filter { stored == null || (it.id == stored.id && it.publicKey == stored.publicKey) }
        if (found.map { it.id }.distinct().size == 1) {
            val candidate = found.first()
            val verified = probe(candidate.url)
            if (verified.id != candidate.id || verified.publicKey != candidate.publicKey) throw IOException("The clinic identity changed during connection.")
            save(verified); return@synchronized verified.url
        }
        throw IOException(if (found.isEmpty()) "No reachable clinic was found. Check the shared network and server." else "More than one clinic was found. Choose yours in Clinic connection.")
      }
    }
    companion object {
        private val lock = Any()
        private var lastSearch = 0L
        fun proof(json: JSONObject, nonce: String, base: String): ClinicServer {
            require(json.getString("service") == "CareSlot API" && json.getInt("protocol") == 1 && json.getString("nonce") == nonce)
            val publicKey = json.getString("publicKey")
            val encoded = Base64.decode(publicKey, Base64.NO_WRAP)
            val id = MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }
            require(json.getString("serverId") == id)
            val name = json.getString("name").also { require(it.length in 1..80 && it.none { c -> c == '\n' || c == '\r' || c.isISOControl() }) }
            val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(encoded))
            val verifier = Signature.getInstance("SHA256withECDSA").apply { initVerify(key); update("CareSlot/1\n$nonce\n$id\n$name".toByteArray(Charsets.UTF_8)) }
            require(verifier.verify(Base64.decode(json.getString("signature"), Base64.NO_WRAP)))
            return ClinicServer(ClinicAddress.normalize(base, BuildConfig.DEBUG), id, name, publicKey)
        }
        fun probe(base: String): ClinicServer {
            val normalized = ClinicAddress.normalize(base, BuildConfig.DEBUG)
            val nonce = UUID.randomUUID().toString().replace("-", "")
            val connection = URL("$normalized/connection?nonce=$nonce").openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 1500; connection.readTimeout = 2000; connection.instanceFollowRedirects = false
                connection.setRequestProperty("Accept", "application/json")
                if (connection.responseCode != 200) throw IOException("This address is not a reachable CareSlot server.")
                val bytes = connection.inputStream.use { stream ->
                    val buffer = ByteArray(4097); var count = 0
                    while (count < buffer.size) { val n = stream.read(buffer, count, buffer.size - count); if (n < 0) break; count += n }
                    if (count > 4096) throw IOException("Invalid clinic response.")
                    buffer.copyOf(count)
                }
                return proof(JSONObject(String(bytes, Charsets.UTF_8)), nonce, normalized)
            } catch (error: IOException) { throw error }
            catch (_: Exception) { throw IOException("The address did not provide a valid CareSlot identity.") }
            finally { connection.disconnect() }
        }
    }
}

object ClinicAddress {
    fun privateIpv4(host: String): Boolean {
        val raw = host.split('.')
        if (raw.size != 4 || raw.any { it.toIntOrNull() !in 0..255 || it.toIntOrNull().toString() != it }) return false
        val parts = raw.map { it.toInt() }
        return parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168)
    }
    fun normalize(value: String, debug: Boolean): String {
        val clean = value.trim()
        val uri = try { URI(if (clean.contains("://")) clean else "http://$clean") } catch (_: Exception) { throw IOException("Enter a valid clinic address.") }
        val host = uri.host?.lowercase() ?: throw IOException("Enter a valid clinic address.")
        if (uri.userInfo != null || uri.query != null || uri.fragment != null || uri.rawPath !in listOf(null, "", "/", "/api/v1", "/api/v1/") || uri.port !in -1..65535 || uri.port == 0) throw IOException("Use a clinic address without credentials, extra paths or query parameters.")
        if (uri.scheme != "https" && !(debug && uri.scheme == "http" && (privateIpv4(host) || host in listOf("127.0.0.1", "localhost")))) throw IOException("Use a private network IP for local connections, or an HTTPS clinic address.")
        val port = if (uri.port == -1 && uri.scheme == "http") 3001 else uri.port
        return "${uri.scheme}://$host${if (port != -1) ":$port" else ""}/api/v1"
    }
}

object ClinicConnectionRules {
    fun canSelect(hasSession: Boolean, currentId: String?, candidateId: String, legacyAddressMatches: Boolean): Boolean =
        !hasSession || currentId == candidateId || (currentId == null && legacyAddressMatches)
}
