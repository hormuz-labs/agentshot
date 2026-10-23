import 'dart:async';
import 'dart:io';
import 'package:crypto/crypto.dart';

/// Bridges a loopback TCP socket to WSS. The caller wraps it in desktop-pinned
/// TLS; neither the local forwarder nor the cloud relay decrypts application data.
class RelayTunnel {
  final Uri relay;
  final String desktop;
  final Future<String> Function() token;
  final HttpClient? webSocketClient;
  ServerSocket? _server;
  final _sockets = <Socket>{};
  final _websockets = <WebSocket>{};
  final _forwards = <Future<void>>{};
  bool _closed = false;
  RelayTunnel(this.relay, this.desktop, this.token, {this.webSocketClient});

  Future<void> start() async {
    if (relay.scheme != 'https') throw Exception('Relay requires HTTPS');
    _server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    _server!.listen((socket) {
      final forward = _forward(socket);
      _forwards.add(forward);
      unawaited(forward.whenComplete(() => _forwards.remove(forward)));
    });
  }

  Future<Socket> connect() => Socket.connect(
    InternetAddress.loopbackIPv4,
    _server!.port,
    timeout: const Duration(seconds: 15),
  );
  Future<ConnectionTask<Socket>> secureConnection(String fingerprint) async {
    Socket? raw;
    bool cancelled = false;
    final socket = () async {
      raw = await connect();
      if (cancelled) {
        raw!.destroy();
        throw const SocketException('Connection cancelled');
      }
      return SecureSocket.secure(
        raw!,
        host: 'desktop.manul.invalid',
        context: SecurityContext(withTrustedRoots: false),
        onBadCertificate: (certificate) =>
            sha256.convert(certificate.der).toString() == fingerprint,
      );
    }();
    return ConnectionTask.fromSocket(socket, () {
      cancelled = true;
      raw?.destroy();
    });
  }

  Future<void> _forward(Socket socket) async {
    _sockets.add(socket);
    WebSocket? ws;
    try {
      ws = await WebSocket.connect(
        relay
            .replace(
              scheme: 'wss',
              path: '/v1/tunnel',
              queryParameters: {'desktop': desktop},
            )
            .toString(),
        headers: {'authorization': 'Bearer ${await token()}'},
        compression: CompressionOptions.compressionOff,
        customClient: webSocketClient,
      ).timeout(const Duration(seconds: 20));
      if (_closed) {
        await ws.close();
        return;
      }
      _websockets.add(ws);
      ws.pingInterval = const Duration(seconds: 25);
      final remote = ws;
      // Both sinks apply stream backpressure; avoid buffering whole media files.
      final up = remote.addStream(socket).whenComplete(() => remote.close());
      final down = socket
          .addStream(
            remote.map((message) {
              if (message is! List<int> || message.length > 256 * 1024) {
                throw const FormatException('Invalid relay frame');
              }
              return message;
            }),
          )
          .whenComplete(() => socket.destroy());
      await Future.wait([up, down]);
    } catch (_) {
      socket.destroy();
      await ws?.close();
    } finally {
      _sockets.remove(socket);
      _websockets.remove(ws);
      socket.destroy();
    }
  }

  Future<void> close() async {
    _closed = true;
    await _server?.close();
    for (final s in _sockets.toList()) {
      s.destroy();
    }
    // addStream owns each WebSocket sink until TCP ends. Closing a bound sink
    // throws; destroying TCP lets _forward finish the stream and close WSS.
    await Future.wait(_forwards.toList());
  }
}
