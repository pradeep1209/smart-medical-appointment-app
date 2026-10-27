import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}
dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-savedstate:2.8.7")
    implementation("androidx.room:room-runtime:2.7.2")
    kapt("androidx.room:room-compiler:2.7.2")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
}
kapt { arguments { arg("room.schemaLocation", "$projectDir/schemas") } }
val localConnection = Properties().apply {
    rootProject.file(".local/android-wifi.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val debugApiUrl = providers.gradleProperty("careslotApiUrl").orElse(localConnection.getProperty("careslotApiUrl", "http://127.0.0.1:3001/api/v1"))
val generatedNetworkResources = layout.buildDirectory.dir("generated/clinicNetwork/debug/res")
val generateDebugClinicNetwork by tasks.registering {
    inputs.property("apiUrl", debugApiUrl)
    outputs.dir(generatedNetworkResources)
    doLast {
        val uri = URI(debugApiUrl.get())
        val host = requireNotNull(uri.host) { "Clinic API URL needs a host" }
        require(uri.scheme in listOf("http", "https") && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Use an HTTP(S) clinic API URL without credentials, query or fragment" }
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        val privateIp = parts.size == 4 && parts.all { it in 0..255 } && (parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168))
        require(uri.scheme == "https" || host in listOf("127.0.0.1", "localhost") || privateIp) { "Debug HTTP is limited to loopback or a private LAN address" }
        val xml = generatedNetworkResources.get().file("xml/network_security_config.xml").asFile
        xml.parentFile.mkdirs()
        xml.writeText("""<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config>
    <domain-config cleartextTrafficPermitted="true"><domain>$host</domain></domain-config>
</network-security-config>
""")
    }
}
tasks.matching { it.name == "preDebugBuild" }.configureEach { dependsOn(generateDebugClinicNetwork) }
android {
    buildFeatures { buildConfig = true }
    namespace = "com.careslot.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.careslot.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 226
        versionName = "1.6.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("debug").res.srcDir(generatedNetworkResources)
    buildTypes {
        getByName("debug") {
            val apiUrl = debugApiUrl.get()
            buildConfigField("String", "API_BASE_URL", "\"${apiUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
        }
        getByName("release") {
            val apiUrl = providers.gradleProperty("careslotReleaseApiUrl").orElse("https://clinic.invalid/api/v1").get()
            require(apiUrl.startsWith("https://")) { "Release API URL must use HTTPS" }
            buildConfigField("String", "API_BASE_URL", "\"${apiUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
        }
    }
}
