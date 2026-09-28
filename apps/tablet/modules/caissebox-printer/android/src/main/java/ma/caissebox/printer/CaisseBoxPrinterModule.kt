package ma.caissebox.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class PrinterException(message: String, cause: Throwable? = null) : CodedException("ERR_PRINTER", message, cause)

/**
 * Envoi d'octets ESC/POS déjà mis en forme (par @caissebox/shared) vers une
 * imprimante thermique :
 *  - Wi-Fi : socket TCP brute, port 9100 en général ;
 *  - Bluetooth : profil série SPP, imprimante appairée au préalable dans Android.
 * Aucune mise en forme ici : le module ne fait que transporter les octets.
 */
class CaisseBoxPrinterModule : Module() {
  private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private val btLocks = ConcurrentHashMap<String, Any>()

  override fun definition() = ModuleDefinition {
    Name("CaisseBoxPrinter")

    AsyncFunction("printTcp") { host: String, port: Int, base64: String, timeoutMs: Int ->
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      try {
        Socket().use { socket ->
          socket.connect(InetSocketAddress(host, port), timeoutMs)
          socket.soTimeout = timeoutMs
          socket.tcpNoDelay = true
          val out = socket.getOutputStream()
          var offset = 0
          while (offset < bytes.size) {
            val len = minOf(4096, bytes.size - offset)
            out.write(bytes, offset, len)
            offset += len
          }
          out.flush()
          // Laisse à l'imprimante le temps de vider son tampon avant la fermeture.
          Thread.sleep(150)
        }
      } catch (e: IOException) {
        throw PrinterException("Imprimante $host:$port injoignable (${e.message ?: "erreur réseau"})", e)
      }
      true
    }

    AsyncFunction("printBluetooth") { address: String, base64: String, timeoutMs: Int ->
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val lock = btLocks.getOrPut(address.uppercase()) { Any() }
      synchronized(lock) {
        val socket = connectBluetooth(address.uppercase(), timeoutMs)
        try {
          val out = socket.outputStream
          var offset = 0
          while (offset < bytes.size) {
            val len = minOf(512, bytes.size - offset)
            out.write(bytes, offset, len)
            out.flush()
            offset += len
            // Les petites imprimantes Bluetooth saturent si on envoie trop vite.
            Thread.sleep(8)
          }
          Thread.sleep(250)
        } catch (e: IOException) {
          throw PrinterException("Envoi Bluetooth interrompu vers $address (${e.message ?: "erreur"})", e)
        } finally {
          try { socket.close() } catch (_: IOException) {}
        }
      }
      true
    }

    AsyncFunction("bondedDevices") {
      val adapter = adapter() ?: return@AsyncFunction emptyList<Map<String, String>>()
      try {
        @SuppressLint("MissingPermission")
        val devices = adapter.bondedDevices
        devices.map { mapOf("name" to (it.name ?: "Sans nom"), "address" to it.address) }
      } catch (e: SecurityException) {
        throw PrinterException("Autorisation Bluetooth refusée", e)
      }
    }

    Function("isBluetoothEnabled") {
      adapter()?.isEnabled == true
    }
  }

  private fun adapter(): BluetoothAdapter? {
    val context = appContext.reactContext ?: return null
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  @SuppressLint("MissingPermission")
  private fun connectBluetooth(address: String, timeoutMs: Int): BluetoothSocket {
    val adapter = adapter() ?: throw PrinterException("Bluetooth indisponible sur cette tablette")
    if (!adapter.isEnabled) throw PrinterException("Bluetooth désactivé")
    val device = try {
      adapter.getRemoteDevice(address)
    } catch (e: IllegalArgumentException) {
      throw PrinterException("Adresse Bluetooth invalide : $address", e)
    }
    try {
      adapter.cancelDiscovery()
    } catch (_: SecurityException) {}

    var lastError: Exception? = null
    for (secure in listOf(true, false)) {
      val socket = try {
        if (secure) device.createRfcommSocketToServiceRecord(sppUuid) else device.createInsecureRfcommSocketToServiceRecord(sppUuid)
      } catch (e: Exception) {
        lastError = e
        continue
      }
      // connect() est bloquant et sans délai propre : on le borne avec un minuteur.
      val watchdog = Thread {
        try {
          Thread.sleep(timeoutMs.toLong())
          if (!socket.isConnected) socket.close()
        } catch (_: Exception) {}
      }
      watchdog.isDaemon = true
      watchdog.start()
      try {
        socket.connect()
        watchdog.interrupt()
        return socket
      } catch (e: SecurityException) {
        watchdog.interrupt()
        throw PrinterException("Autorisation Bluetooth refusée", e)
      } catch (e: Exception) {
        watchdog.interrupt()
        lastError = e
        try { socket.close() } catch (_: IOException) {}
      }
    }
    throw PrinterException("Imprimante Bluetooth $address injoignable (${lastError?.message ?: "connexion refusée"})", lastError)
  }
}
