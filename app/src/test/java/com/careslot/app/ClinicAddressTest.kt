package com.careslot.app

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class ClinicAddressTest {
    @Test fun routerAndHotspotAddressesWorkWithoutRebuilding() {
        for (host in listOf("192.168.1.20", "192.168.43.120", "192.168.137.1", "172.20.10.2", "10.2.3.4")) {
            assertEquals("http://$host:3001/api/v1", ClinicAddress.normalize(host, true))
            assertEquals("http://$host:3001/api/v1", ClinicAddress.normalize("$host:3001", true))
            assertEquals("http://$host:3001/api/v1", ClinicAddress.normalize("http://$host:3001/api/v1/", true))
        }
    }
    @Test fun publicHttpAndMalformedAddressesAreRejected() {
        for (address in listOf("http://8.8.8.8:3001", "http://192.168.001.2", "http://192.168.0.999", "http://169.254.0.1", "http://clinic.local", "file:///tmp/x", "http://user:pass@192.168.0.2", "http://192.168.0.2/path", "http://192.168.0.2?x=1", "http://192.168.0.2#token", "http://192.168.0.2:0", "http://192.168.0.2:65536")) {
            try { ClinicAddress.normalize(address, true); fail("Accepted $address") } catch (_: IOException) {}
        }
    }
    @Test fun releaseRequiresHttpsAndDebugStillSupportsLoopback() {
        assertEquals("https://clinic.example/api/v1", ClinicAddress.normalize("https://clinic.example", false))
        assertEquals("http://127.0.0.1:3001/api/v1", ClinicAddress.normalize("http://127.0.0.1:3001", true))
        try { ClinicAddress.normalize("http://192.168.0.2:3001", false); fail("Release accepted HTTP") } catch (_: IOException) {}
    }
    @Test fun sessionsStayWithTheirSelectedServer() {
        assertTrue(ClinicConnectionRules.canSelect(false, null, "new", false))
        assertTrue(ClinicConnectionRules.canSelect(true, "same", "same", false))
        assertFalse(ClinicConnectionRules.canSelect(true, "old", "other", false))
        assertFalse(ClinicConnectionRules.canSelect(true, null, "other", false))
        assertTrue(ClinicConnectionRules.canSelect(true, null, "legacy", true))
    }
}
