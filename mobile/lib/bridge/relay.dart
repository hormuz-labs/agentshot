// Outbound WebSocket tunnel with a loopback CONNECT proxy. The existing bridge
// client performs certificate-pinned TLS *inside* it, so the relay sees no HTTP.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

class RelayRoute {
  final Uri url;
  final String ticket;
  final int expiresAt;
  RelayRoute(this.url, this.ticket, this.expiresAt);
  factory RelayRoute.fromJson(Map<String, dynamic> json) {
    final url = Uri.parse(json['url'] as String);
    if (url.scheme != 'wss' || url.host.isEmpty || url.userInfo.isNotEmpty || url.hasQuery || url.hasFragment) {
      throw const FormatException('Invalid relay URL');
    }
    final ticket = json['ticket'] as String;
    if (ticket.isEmpty || ticket.length > 2048) throw const FormatException('Invalid relay ticket');
    return RelayRoute(url, ticket, (json['expiresAt'] as num).toInt());
  }
  Map<String, dynamic> toJson() => {'url': url.toString(), 'ticket': ticket, 'expiresAt': expiresAt};
}

class RelayProxy {
  static ServerSocket? _server;
  static RelayRoute? _route;
  static Uri? _target;
  static final _sockets = <Socket>{};
  static final _websockets = <WebSocket>{};
  static int _generation = 0;
  static int? get port => _server?.port;
  static bool handles(Uri url) => _server != null && url.host == _target?.host && url.port == _target?.port;

  static Future<void> start(RelayRoute route, Uri target) async {
    if (route.expiresAt <= DateTime.now().millisecondsSinceEpoch) throw const FormatException('Relay credentials expired');
    if (_server != null && _target == target && _route?.url == route.url) { _route = route; return; }
    await stop();
    final generation = ++_generation;
    _route = route; _target = target;
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    if (generation != _generation) { await server.close(); return; }
    _server = server;
    server.listen((socket) => _accept(socket, target));
  }

  static Future<void> stop() async {
    final server = _server; _server = null; _route = null; _target = null;
    _generation++;
    for (final socket in _sockets.toList()) { socket.destroy(); }
    for (final ws in _websockets.toList()) { unawaited(ws.close()); }
    _sockets.clear(); _websockets.clear();
    await server?.close();
  }

  static void _accept(Socket socket, Uri target) {
    _sockets.add(socket);
    final route = _route;
    final header = <int>[];
    WebSocket? ws;
    StreamSubscription<List<int>>? input;
    StreamSubscription<dynamic>? output;
    Timer? timer;
    var ready = false, opening = false, closed = false;
    Future<void> send(List<int> bytes) async {
      // Socket chunks can exceed the relay's frame limit on fast uploads.
      final chunks = <List<int>>[];
      for (var at = 0; at < bytes.length; at += 65536) {
        chunks.add(bytes.sublist(at, (at + 65536).clamp(0, bytes.length)));
      }
      await ws!.addStream(Stream<List<int>>.fromIterable(chunks));
    }
    void close() {
      if (closed) return;
      closed = true; timer?.cancel(); socket.destroy(); _sockets.remove(socket);
      if (ws != null) { _websockets.remove(ws); unawaited(ws!.close()); }
    }
    timer = Timer(const Duration(seconds: 20), close);
    input = socket.listen((bytes) async {
      if (ready) {
        try {
          input!.pause();
          await send(bytes);
          if (!closed) input.resume();
        } catch (_) { close(); }
        return;
      }
      if (opening) { close(); return; }
      header.addAll(bytes);
      if (header.length > 8192) { close(); return; }
      final text = latin1.decode(header);
      final end = text.indexOf('\r\n\r\n');
      if (end < 0) return;
      final authority = target.host.contains(':') ? '[${target.host}]:${target.port}' : '${target.host}:${target.port}';
      if (!text.startsWith('CONNECT $authority HTTP/1.1\r\n') || route == null || route.expiresAt <= DateTime.now().millisecondsSinceEpoch) { close(); return; }
      opening = true; input!.pause();
      final http = HttpClient()..connectionTimeout = const Duration(seconds: 10);
      try {
        final connected = WebSocket.connect(route.url.replace(path: '/client').toString(),
          headers: {HttpHeaders.authorizationHeader: 'Bearer ${route.ticket}'},
          customClient: http, compression: CompressionOptions.compressionOff);
        // If a timed-out connect finishes later, never leak its socket.
        connected.then((late) { if (closed) unawaited(late.close()); }, onError: (Object _) {});
        ws = await connected.timeout(const Duration(seconds: 15));
        if (closed) { unawaited(ws!.close()); return; }
        _websockets.add(ws!);
        ws!.pingInterval = const Duration(seconds: 15);
        output = ws!.listen((message) async {
          if (!ready) {
            try {
              if (message is! String || jsonDecode(message)['type'] != 'ready') { close(); return; }
            } catch (_) { close(); return; }
            ready = true; timer?.cancel();
            socket.add(ascii.encode('HTTP/1.1 200 Connection Established\r\n\r\n'));
            final trailing = header.sublist(end + 4);
            if (trailing.isNotEmpty) await send(trailing);
            input!.resume();
          } else if (message is List<int>) {
            if (message.length > 256 * 1024) { close(); return; }
            output!.pause();
            try {
              socket.add(message);
              await socket.flush();
              if (!closed) output!.resume();
            } catch (_) { close(); }
          } else { close(); }
        }, onError: (Object _) => close(), onDone: close);
      } catch (_) { close(); }
      finally { http.close(force: closed); }
    }, onError: (Object _) => close(), onDone: close);
  }
}
