package si.agentshot.app

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.net.ConnectivityManager
import android.net.Network
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.net.NetworkInterface
import java.util.concurrent.Executors
import si.agentshot.mesh.mobile.Mobile

class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private val worker = Executors.newSingleThreadExecutor()
    private var connectivity: ConnectivityManager? = null
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refreshNetwork()
        override fun onLost(network: Network) = refreshNetwork()
        override fun onLinkPropertiesChanged(network: Network, properties: android.net.LinkProperties) = refreshNetwork()
    }

    private fun refreshNetwork() {
        worker.execute {
            try {
                Mobile.setInterfaces(interfaces())
                Mobile.networkChanged()
            } catch (_: Exception) { /* Reconnect path reports unavailable peers. */ }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val ch = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "agentshot/native")
        channel = ch
        if (connectivity == null) {
            connectivity = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
            connectivity?.registerDefaultNetworkCallback(networkCallback)
        }
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "initialLink" -> result.success(intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString)
                "meshStart" -> worker.execute {
                    try {
                        // Android 11+ blocks Go's interface listing; hand it the list from Java instead
                        Mobile.setInterfaces(interfaces())
                        Mobile.setVerbose(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
                        val out = Mobile.start(
                            File(filesDir, "mesh").apply { mkdirs() }.path,
                            "agentshot-phone-${Build.MODEL.lowercase().replace(Regex("[^a-z0-9-]"), "-")}".take(60),
                            call.argument<String>("control") ?: "",
                            call.argument<String>("key") ?: "",
                        )
                        runOnUiThread { result.success(out) }
                    } catch (e: Exception) {
                        runOnUiThread { result.error("mesh", e.message ?: "Could not join the mesh", null) }
                    }
                }
                "meshStop" -> worker.execute {
                    Mobile.stop()
                    runOnUiThread { result.success(null) }
                }
                "meshNetworkChanged" -> worker.execute {
                    try {
                        Mobile.setInterfaces(interfaces())
                        Mobile.networkChanged()
                        runOnUiThread { result.success(null) }
                    } catch (e: Exception) {
                        runOnUiThread { result.error("mesh", "Could not refresh the mesh network", null) }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onDestroy() {
        connectivity?.unregisterNetworkCallback(networkCallback)
        connectivity = null
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_VIEW) channel?.invokeMethod("link", intent.dataString)
    }

    private fun interfaces(): String = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().joinToString("\n") { i ->
        val addrs = i.interfaceAddresses.mapNotNull { a ->
            a.address?.hostAddress?.substringBefore('%')?.let { "$it/${a.networkPrefixLength}" }
        }
        listOf(i.name, i.index, i.mtu, if (i.isUp) 1 else 0, if (i.isLoopback) 1 else 0).joinToString(" ") +
            addrs.joinToString("") { " $it" }
    }
}
