import 'dart:convert';
import 'package:flutter/services.dart';

/// The embedded Headscale node (Android). Requests to mesh addresses go through its local CONNECT proxy,
/// so TLS (and the desktop's pinned certificate) stays end to end.
class Mesh {
  static const _channel = MethodChannel('agentshot/native');
  static int? proxyPort;

  static bool isMeshHost(String host) {
    final p = host.split('.').map(int.tryParse).toList();
    if (p.length == 4 && p.every((n) => n != null)) {
      return p[0] == 100 && p[1]! >= 64 && p[1]! <= 127;
    }
    return host.toLowerCase().startsWith('fd7a:115c:a1e0:');
  }

  /// Joins the mesh; [key] is only needed the first time, the node key is kept on the device.
  static Future<void> start(String control, [String key = '']) async {
    try {
      final out = await _channel.invokeMethod<String>('meshStart', {
        'control': control,
        'key': key,
      });
      proxyPort = (jsonDecode(out!) as Map)['proxyPort'] as int;
    } on MissingPluginException {
      throw UnsupportedError('Pairing from anywhere is not available on this device yet.');
    } on PlatformException catch (e) {
      throw StateError(e.message ?? 'Could not join your AgentShot mesh.');
    }
  }

  static Future<void> stop() async {
    proxyPort = null;
    try {
      await _channel.invokeMethod('meshStop');
    } on MissingPluginException {
      // no embedded mesh on this platform
    }
  }

  /// The agentshot://pair link the app was opened with (scanned by the phone's camera), if any.
  static Future<String?> initialLink() async {
    try {
      return await _channel.invokeMethod<String>('initialLink');
    } on MissingPluginException {
      return null;
    }
  }

  static void onLink(void Function(String link) handler) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'link' && call.arguments is String) handler(call.arguments as String);
    });
  }
}
