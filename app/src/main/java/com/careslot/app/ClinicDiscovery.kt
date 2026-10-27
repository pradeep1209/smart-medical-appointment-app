package com.careslot.app

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Bounded discovery only: no IP range scanning and no account credentials in discovery packets. */
class ClinicDiscovery(context: Context) {
    private val app = context.applicationContext
    @Suppress("DEPRECATION")
    fun find(): List<ClinicServer> {
        val found = ConcurrentHashMap<String, ClinicServer>()
        val pending = ConcurrentLinkedQueue<NsdServiceInfo>()
        val manager = app.getSystemService(Context.NSD_SERVICE) as NsdManager
        val wifi = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val multicast = wifi.createMulticastLock("careslot-discovery").apply { setReferenceCounted(false) }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) {}
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) { if (info.serviceType.contains("_careslot._tcp")) pending.add(info) }
        }
        var started = false
        val socket = DatagramSocket().apply { broadcast = true; soTimeout = 200 }
        val verifier = Executors.newFixedThreadPool(3)
        val checked = mutableSetOf<String>()
        try {
            runCatching { multicast.acquire() }
            runCatching { manager.discoverServices("_careslot._tcp.", NsdManager.PROTOCOL_DNS_SD, listener); started = true }
            val nonce = UUID.randomUUID().toString().replace("-", "")
            val payload = JSONObject().put("service", "CareSlot discovery").put("protocol", 1).put("nonce", nonce).toString().toByteArray(Charsets.UTF_8)
            val targets = mutableSetOf("255.255.255.255")
            runCatching { for (iface in Collections.list(NetworkInterface.getNetworkInterfaces())) if (iface.isUp && !iface.isLoopback) for (address in iface.interfaceAddresses) if (address.address is Inet4Address && ClinicAddress.privateIpv4(address.address.hostAddress ?: "")) address.broadcast?.hostAddress?.let { targets.add(it) } }
            val deadline = System.currentTimeMillis() + 4000
            var sentAt = 0L; val resolving = AtomicBoolean(false)
            while (System.currentTimeMillis() < deadline) {
                while (checked.size < 8) {
                    val next = endpoints.poll() ?: break
                    if (!checked.add(next)) continue
                    verifier.execute { runCatching { ClinicConnection.probe(next) }.getOrNull()?.let { found.putIfAbsent(it.id, it) } }
                }
                if (System.currentTimeMillis() - sentAt > 1000) {
                    sentAt = System.currentTimeMillis()
                    for (target in targets) runCatching { socket.send(DatagramPacket(payload, payload.size, InetAddress.getByName(target), 3002)) }
                }
                if (!resolving.get()) pending.poll()?.let { info ->
                    resolving.set(true)
                    runCatching { manager.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) { resolving.set(false) }
                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            try {
                                val host = serviceInfo.host?.hostAddress ?: return
                                if (!ClinicAddress.privateIpv4(host) || serviceInfo.port !in 1..65535) return
                                // Verify via HTTP on the worker below, never block the platform callback thread.
                                endpoints.add("http://$host:${serviceInfo.port}/api/v1")
                            } finally { resolving.set(false) }
                        }
                    }) }.onFailure { resolving.set(false) }
                }
                try {
                    val packet = DatagramPacket(ByteArray(4096), 4096); socket.receive(packet)
                    val host = packet.address.hostAddress ?: continue
                    if (!ClinicAddress.privateIpv4(host)) continue
                    val json = JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8))
                    val port = json.getInt("port"); if (port !in 1..65535) continue
                    val server = ClinicConnection.proof(json, nonce, "http://$host:$port/api/v1")
                    endpoints.add(server.url)
                } catch (_: Exception) {}
            }
            // Bound candidates and verify a fresh HTTP challenge; UDP/mDNS are only hints.
            while (checked.size < 8) {
                val next = endpoints.poll() ?: break
                if (!checked.add(next)) continue
                verifier.execute { runCatching { ClinicConnection.probe(next) }.getOrNull()?.let { found.putIfAbsent(it.id, it) } }
            }
            verifier.shutdown(); verifier.awaitTermination(3500, TimeUnit.MILLISECONDS)
            return found.values.sortedBy { it.name }
        } finally {
            socket.close()
            verifier.shutdownNow()
            if (started) runCatching { manager.stopServiceDiscovery(listener) }
            if (multicast.isHeld) multicast.release()
        }
    }
    private val endpoints = ConcurrentLinkedQueue<String>()
}
