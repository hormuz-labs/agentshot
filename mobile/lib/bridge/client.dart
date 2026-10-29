import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'media_cache.dart';
import 'mesh.dart';

typedef Json = Map<String, dynamic>;
Json object(dynamic value) => Map<String, dynamic>.from(value as Map);
List<Json> objects(dynamic value) =>
    (value as List? ?? []).map(object).toList();

/// Any error, as the person should read it: AgentShot's own messages as they are, the network's (a socket closed, a
/// timeout, a certificate) as what to check, and never the raw exception. [where] names the computer.
/// When a secure connection is met by someone else's certificate: a network that looks inside secure connections (an
/// office firewall, some VPNs) is between this phone and AgentShot, and nothing here can get past it.
const blockedNetwork =
    'This network is blocking AgentShot (a firewall or VPN is getting in the way). Try mobile data or another Wi-Fi.';

/// Whether [error] is a secure connection turned away over its certificate (see [blockedNetwork]).
bool isBlockedNetwork(Object error) =>
    error is HandshakeException &&
    '$error'.contains(
      RegExp('CERTIFICATE_VERIFY_FAILED|certificate', caseSensitive: false),
    );

String plain(Object error, {String? where}) {
  if (error is BridgeException) return error.message;
  if (isBlockedNetwork(error)) return blockedNetwork;
  final place = where ?? 'your computer';
  if (error is SocketException ||
      error is HttpException ||
      error is TimeoutException ||
      error is HandshakeException ||
      error is TlsException ||
      error is OSError) {
    return place == 'AgentShot Cloud'
        ? 'Couldn’t reach AgentShot Cloud. Check this phone’s internet connection, then try again.'
        : 'Couldn’t reach $place. Make sure AgentShot is open on it and both are online, then try again.';
  }
  if (error is FormatException) {
    return '$place sent something this app couldn’t read. Update the app and AgentShot there, then try again.';
  }
  return 'Something went wrong. Try again in a moment.';
}

class BridgeException implements Exception {
  final String message;
  final int? status;

  /// What went wrong, when the desktop says (e.g. needs-key: no AI set up on the computer yet).
  final String? code;
  BridgeException(this.message, [this.status, this.code]);
  @override
  String toString() => message;
}

class Connection {
  final Uri url;
  final List<Uri> urls;
  final String fingerprint;
  final String token;

  /// The computer in the person's AgentShot account this connects to (signed in, not paired): its token runs out
  /// after a day and comes again from the account.
  final String? machine;

  /// What the computer is called, when the account said so.
  final String? name;
  Connection(
    this.url,
    this.fingerprint,
    this.token, [
    List<Uri>? urls,
    this.machine,
    this.name,
  ]) : urls = <Uri>[
         url,
         ...?urls?.where((u) => u.toString() != url.toString()),
       ];
  static Uri _parseUrl(String raw) {
    final url = Uri.parse(raw);
    if (url.scheme != 'https' ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment ||
        (url.path.isNotEmpty && url.path != '/')) {
      throw BridgeException(
        'Paste the complete connection code from AgentShot → Settings → Mobile.',
      );
    }
    return url;
  }

  factory Connection.fromJson(Json json) {
    final url = _parseUrl(json['url'] as String);
    final fingerprint = json['fingerprint'] as String;
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw BridgeException(
        'Paste the complete connection code from AgentShot → Settings → Mobile.',
      );
    }
    final extra = <Uri>[];
    for (final raw in (json['urls'] as List? ?? const [])) {
      if (raw is String) {
        try {
          final parsed = _parseUrl(raw);
          if (!extra.any((u) => u.toString() == parsed.toString())) {
            extra.add(parsed);
          }
        } catch (_) {}
      }
    }
    return Connection(
      url,
      fingerprint,
      json['token'] as String? ?? '',
      extra,
      json['machine'] as String?,
      json['name'] as String?,
    );
  }
  Json toJson() => {
    'url': url.toString(),
    'urls': urls.map((u) => u.toString()).toList(),
    'fingerprint': fingerprint,
    'token': token,
    'machine': ?machine,
    'name': ?name,
  };
}

/// All remote traffic, including native-player media, uses certificate-pinned TLS.
/// The localhost relay lets AVPlayer/ExoPlayer stream without bypassing their TLS checks.
class BridgeClient {
  static const _storageKey = 'agentshot.desktop.connection.v1';
  static const _meshStorageKey = 'agentshot.mesh.v1';
  final FlutterSecureStorage storage;
  Connection? connection;
  HttpClient? _http;
  HttpServer? _relay;
  final _relaySecret = List.generate(
    32,
    (_) => Random.secure().nextInt(256),
  ).map((n) => n.toRadixString(16).padLeft(2, '0')).join();
  final _events = StreamController<Json>.broadcast();
  Stream<Json> get events => _events.stream;

  /// A kept file found changed on the computer and fetched anew (its project and path): pictures showing it reload.
  final _mediaChanged = StreamController<(String, String)>.broadcast();
  Stream<(String, String)> get mediaChanged => _mediaChanged.stream;

  /// How many times each kept file was found changed (by cache key): part of its local address, so a picture shown
  /// before isn't served from the screen's own memory.
  final _versions = <String, int>{};
  int _generation = 0;
  bool _disposed = false;

  /// The films and pictures kept on this phone (see [MediaCache]): played from here while the computer has nothing new.
  final MediaCache cache;
  BridgeClient({this.storage = const FlutterSecureStorage(), MediaCache? cache})
    : cache = cache ?? MediaCache();

  /// A fresh connection for a computer in the person's account when its token was turned down (see Account).
  Future<Connection?> Function(Connection expired)? renew;

  /// How this phone shows up on the desktop, under Settings → Mobile.
  static final deviceName = Platform.isIOS ? 'iPhone' : 'Android phone';

  Future<bool> restore() async {
    final saved = await storage.read(key: _storageKey);
    if (saved == null) return false;
    try {
      _configure(Connection.fromJson(object(jsonDecode(saved))));
      // rejoin the mesh in the background; the reconnect loop retries until it is up
      final mesh = await storage.read(key: _meshStorageKey);
      if (mesh != null) {
        unawaited(Mesh.start(mesh).catchError((Object _) {}));
      }
      return true;
    } catch (_) {
      await storage.delete(key: _storageKey);
      return false;
    }
  }

  /// Rejoins the private network with this control server on the next start (the node key stays on the device).
  Future<void> rememberMesh(String control) =>
      storage.write(key: _meshStorageKey, value: control);

  void _configure(Connection value) {
    _generation++;
    _http?.close(force: true);
    connection = value;
    _http = HttpClient(context: SecurityContext(withTrustedRoots: false))
      ..connectionTimeout = const Duration(seconds: 15)
      ..findProxy = _proxyFor
      ..badCertificateCallback = (certificate, host, port) =>
          value.urls.any((u) => u.host == host && u.port == port) &&
          sha256.convert(certificate.der).toString() == value.fingerprint;
  }

  static const defaultPort = 47821;

  static String _proxyFor(Uri uri) =>
      Mesh.proxyPort != null && Mesh.isMeshHost(uri.host)
      ? 'PROXY 127.0.0.1:${Mesh.proxyPort}'
      : 'DIRECT';

  /// The first of [target]'s addresses that answers, so pairing away from home doesn't wait on dead Wi-Fi addresses.
  Future<Connection> _fastest(Connection target) async {
    final found = Completer<Uri?>();
    var pending = target.urls.length;
    for (final candidate in target.urls) {
      final client =
          HttpClient(context: SecurityContext(withTrustedRoots: false))
            ..connectionTimeout = const Duration(seconds: 20)
            ..findProxy = _proxyFor
            ..badCertificateCallback = (certificate, host, port) =>
                sha256.convert(certificate.der).toString() ==
                target.fingerprint;
      unawaited(() async {
        try {
          final req = await client.getUrl(candidate.replace(path: '/discover'));
          final res = await req.close().timeout(const Duration(seconds: 20));
          await res.drain<void>();
          if (res.statusCode == 200 && !found.isCompleted) {
            found.complete(candidate);
          }
        } catch (_) {
        } finally {
          client.close(force: true);
          if (--pending == 0 && !found.isCompleted) found.complete(null);
        }
      }());
    }
    final first = await found.future;
    return first == null
        ? target
        : Connection(first, target.fingerprint, target.token, target.urls);
  }

  Future<Connection> _discover({String? host}) async {
    final candidates = <String>[];
    final cleanHost = host?.trim() ?? '';
    if (cleanHost.isNotEmpty) {
      candidates.add(
        cleanHost.contains(':') ? cleanHost : '$cleanHost:$defaultPort',
      );
    } else {
      candidates.addAll(['10.0.2.2:$defaultPort', '127.0.0.1:$defaultPort']);
      try {
        final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
        socket.broadcastEnabled = true;
        final payload = utf8.encode('manul-discover');
        socket.send(payload, InternetAddress('255.255.255.255'), defaultPort);
        final found = Completer<Connection?>();
        final sub = socket.listen((event) {
          if (event != RawSocketEvent.read) return;
          final dg = socket.receive();
          if (dg == null) return;
          try {
            final data = object(jsonDecode(utf8.decode(dg.data)));
            final urls = (data['urls'] as List? ?? const [])
                .whereType<String>()
                .toList();
            final primary = 'https://${dg.address.address}:$defaultPort';
            final c = Connection.fromJson({
              'url': urls.isNotEmpty ? urls.first : primary,
              'urls': <String>[primary, ...urls],
              'fingerprint': data['fingerprint'],
            });
            if (!found.isCompleted) found.complete(c);
          } catch (_) {}
        });
        final udpResult = await found.future.timeout(
          const Duration(milliseconds: 250),
          onTimeout: () => null,
        );
        await sub.cancel();
        socket.close();
        if (udpResult != null) return udpResult;
      } catch (_) {}
      try {
        final ifaces = await NetworkInterface.list(
          type: InternetAddressType.IPv4,
        );
        for (final iface in ifaces) {
          for (final addr in iface.addresses) {
            final parts = addr.address.split('.');
            if (parts.length == 4 && parts[0] != '100') {
              final prefix = '${parts[0]}.${parts[1]}.${parts[2]}';
              for (var i = 1; i <= 254; i++) {
                final ip = '$prefix.$i:$defaultPort';
                if (!candidates.contains(ip)) candidates.add(ip);
              }
            }
          }
        }
      } catch (_) {}
    }

    Future<Connection?> probe(String authority) async {
      final client =
          HttpClient(context: SecurityContext(withTrustedRoots: false))
            ..connectionTimeout = const Duration(milliseconds: 600)
            ..badCertificateCallback = (_, _, _) => true;
      try {
        final uri = Uri.parse('https://$authority/discover');
        final req = await client.getUrl(uri);
        final res = await req.close().timeout(
          const Duration(milliseconds: 800),
        );
        if (res.statusCode != 200) return null;
        final data = object(
          await utf8.decoder.bind(res).join().then(jsonDecode),
        );
        final urls = (data['urls'] as List? ?? const [])
            .whereType<String>()
            .toList();
        final primary = 'https://$authority';
        return Connection.fromJson({
          'url': primary,
          'urls': <String>[primary, ...urls],
          'fingerprint': data['fingerprint'],
        });
      } catch (_) {
        return null;
      } finally {
        client.close(force: true);
      }
    }

    for (var i = 0; i < candidates.length; i += 32) {
      final batch = candidates.skip(i).take(32);
      final results = await Future.wait(batch.map(probe));
      for (final r in results) {
        if (r != null) return r;
      }
    }
    throw BridgeException(
      'Could not find your computer. Make sure AgentShot is open on it and both are on the same Wi-Fi, or scan its QR code. Signed in with Google, it connects from anywhere.',
    );
  }

  Future<void> pair(String code, {String? host}) async {
    var trimmed = code.trim();
    // the desktop's QR: agentshot://pair?d=<base64url JSON with the code, addresses and a mesh key>
    if (trimmed.startsWith('agentshot://')) {
      try {
        final data = Uri.parse(trimmed).queryParameters['d'] ?? '';
        trimmed = utf8.decode(base64Url.decode(base64Url.normalize(data)));
      } catch (_) {
        throw BridgeException('That QR code is not an AgentShot pairing code.');
      }
    }
    Connection target;
    final String pairCode;
    if (trimmed.startsWith('{')) {
      final Json input;
      try {
        input = object(jsonDecode(trimmed));
      } catch (_) {
        throw BridgeException(
          'Enter the 6-digit code from AgentShot → Settings → Mobile.',
        );
      }
      target = Connection.fromJson(input);
      if (target.token.isNotEmpty && input['code'] == null) {
        await connectDirect(target);
        return;
      }
      if (input['code'] is! String) {
        throw BridgeException('Connection code is missing.');
      }
      pairCode = input['code'] as String;
      final mesh = input['mesh'];
      if (mesh is Map && mesh['control'] is String && mesh['key'] is String) {
        try {
          await Mesh.start(mesh['control'] as String, mesh['key'] as String);
          await storage.write(
            key: _meshStorageKey,
            value: mesh['control'] as String,
          );
        } catch (_) {
          // still try the Wi-Fi and Tailscale addresses
        }
      }
      target = await _fastest(target);
    } else {
      final digits = trimmed.replaceAll(RegExp(r'\D'), '');
      if (digits.length != 6) {
        throw BridgeException(
          'Enter the 6-digit code from AgentShot → Settings → Mobile.',
        );
      }
      target = await _discover(host: host);
      pairCode = digits;
    }
    Object? lastError;
    for (final candidate in target.urls) {
      _configure(Connection(candidate, target.fingerprint, '', target.urls));
      try {
        final result = object(
          await _post('/pair', {
            'code': pairCode,
            'name': Platform.isIOS ? 'iPhone / iPad' : 'Android',
          }),
        );
        if (result['protocol'] != 1) {
          throw BridgeException(
            'Update the mobile app to connect to this desktop.',
          );
        }
        final discovered = <Uri>[...target.urls];
        for (final raw in (result['urls'] as List? ?? const [])) {
          if (raw is String) {
            try {
              final u = Connection._parseUrl(raw);
              if (!discovered.any((e) => e.toString() == u.toString())) {
                discovered.add(u);
              }
            } catch (_) {}
          }
        }
        _configure(
          Connection(
            candidate,
            target.fingerprint,
            result['token'] as String,
            discovered,
          ),
        );
        await storage.write(
          key: _storageKey,
          value: jsonEncode(connection!.toJson()),
        );
        return;
      } catch (e) {
        lastError = e;
        if (e is BridgeException && e.status != null) break;
      }
    }
    _http?.close(force: true);
    connection = null;
    throw lastError ??
        BridgeException('Could not reach your desktop on the network.');
  }

  /// Connect directly to a pre-authenticated worker (personal or leased pool worker from the account service).
  /// The first of [target]'s addresses to answer, all tried at once; null when none does within [timeout].
  /// Addresses on the private network count only once it is up.
  Future<Uri?> firstToAnswer(
    Connection target, {
    Duration timeout = const Duration(seconds: 4),
  }) async {
    final tries = target.urls
        .where((u) => Mesh.proxyPort != null || !Mesh.isMeshHost(u.host))
        .toList();
    if (tries.isEmpty) return null;
    final found = Completer<Uri?>();
    var pending = tries.length;
    for (final candidate in tries) {
      final http = HttpClient(context: SecurityContext(withTrustedRoots: false))
        ..connectionTimeout = timeout
        ..findProxy = _proxyFor
        ..badCertificateCallback = (certificate, host, port) =>
            sha256.convert(certificate.der).toString() == target.fingerprint;
      unawaited(() async {
        try {
          final req = await http.getUrl(candidate.replace(path: '/hello'));
          req.headers.set(
            HttpHeaders.authorizationHeader,
            'Bearer ${target.token}',
          );
          req.headers.set('x-agentshot-device', deviceName);
          final res = await req.close().timeout(timeout);
          await res.drain<void>();
          if (res.statusCode == 200 && !found.isCompleted) {
            found.complete(candidate);
          }
        } catch (_) {
        } finally {
          http.close(force: true);
          if (--pending == 0 && !found.isCompleted) found.complete(null);
        }
      }());
    }
    return found.future;
  }

  Future<void> connectDirect(Connection target) async {
    Object? lastError;
    for (final candidate in target.urls) {
      _configure(
        Connection(
          candidate,
          target.fingerprint,
          target.token,
          target.urls,
          target.machine,
          target.name,
        ),
      );
      try {
        final req = await _open('GET', candidate.replace(path: '/hello'));
        req.followRedirects = false;
        req.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer ${target.token}',
        );
        req.headers.set('x-agentshot-device', deviceName);
        final res = await req.close().timeout(const Duration(seconds: 6));
        if (res.statusCode != 200) {
          throw BridgeException(
            'Worker refused connection (${res.statusCode}).',
            res.statusCode,
          );
        }
        await storage.write(
          key: _storageKey,
          value: jsonEncode(connection!.toJson()),
        );
        return;
      } catch (e) {
        lastError = e;
      }
    }
    _http?.close(force: true);
    connection = null;
    throw lastError ??
        BridgeException('Could not reach the worker on any address.');
  }

  /// Opens a request on the client in use. Closing that client while a connection is still being made (moving to
  /// another address, the app going away) cancels it, and dart:io then also raises the cancellation where nobody can
  /// catch it: caught here. The request itself still fails, as it should.
  Future<HttpClientRequest> _open(String method, Uri uri) {
    final http = _http!;
    final opened = Completer<HttpClientRequest>();
    runZonedGuarded(
      () async {
        try {
          opened.complete(await http.openUrl(method, uri));
        } catch (e, s) {
          if (!opened.isCompleted) opened.completeError(e, s);
        }
      },
      (e, s) {
        if (!opened.isCompleted) opened.completeError(e, s);
      },
    );
    return opened.future;
  }

  Future<void> _refreshAddresses() async {
    final current = connection;
    if (current == null || _http == null || current.token.isEmpty) return;
    for (final candidate in current.urls) {
      try {
        final uri = candidate.replace(path: '/hello');
        final req = await _open('GET', uri);
        req.followRedirects = false;
        req.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer ${current.token}',
        );
        final res = await req.close().timeout(const Duration(seconds: 4));
        if (res.statusCode != 200) continue;
        final data = object(await _decode(res));
        final nextUrls = <Uri>[candidate];
        for (final raw in (data['urls'] as List? ?? const [])) {
          if (raw is String) {
            try {
              final u = Connection._parseUrl(raw);
              if (!nextUrls.any((e) => e.toString() == u.toString())) {
                nextUrls.add(u);
              }
            } catch (_) {}
          }
        }
        for (final u in current.urls) {
          if (!nextUrls.any((e) => e.toString() == u.toString())) {
            nextUrls.add(u);
          }
        }
        if (candidate.toString() != current.url.toString() ||
            nextUrls.length != current.urls.length) {
          connection = Connection(
            candidate,
            current.fingerprint,
            current.token,
            nextUrls,
          );
          await storage.write(
            key: _storageKey,
            value: jsonEncode(connection!.toJson()),
          );
        }
        return;
      } catch (_) {}
    }
  }

  Future<HttpClientRequest> _request(
    String method,
    String path, [
    Map<String, String>? query,
  ]) async {
    final target = connection;
    if (target == null || _http == null) {
      throw BridgeException('Connect to your desktop first.');
    }
    final uri = target.url.replace(path: path, queryParameters: query);
    final request = await _open(method, uri);
    request.followRedirects = false;
    if (target.token.isNotEmpty) {
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${target.token}',
      );
    }
    request.headers.set('x-agentshot-device', deviceName);
    return request;
  }

  Future<dynamic> _decode(HttpClientResponse response) async {
    final content = await utf8.decoder.bind(response).join();
    dynamic result;
    try {
      result = jsonDecode(content);
    } catch (_) {
      throw BridgeException(
        'The desktop returned an invalid response.',
        response.statusCode,
      );
    }
    if (response.statusCode != 200) {
      throw BridgeException(
        result is Map
            ? '${result['error'] ?? 'Request failed'}'
            : 'Request failed',
        response.statusCode,
        result is Map ? result['code'] as String? : null,
      );
    }
    return result;
  }

  Future<dynamic> _post(String path, Json value) async {
    final request = await _request('POST', path);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(value));
    return _decode(await request.close());
  }

  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    try {
      return await _post('/rpc', {'method': method, 'args': args});
    } catch (e) {
      // cut off because this client was put away (the app closing, another computer): whoever asked is gone too,
      // so it never answers rather than raise an error nobody is left to handle
      if (_disposed) return Completer<dynamic>().future;
      if (e is BridgeException) rethrow;
      // the network's own error (a socket closed, a timeout): said as what to check
      throw BridgeException(plain(e, where: connection?.name));
    }
  }

  /// [call] for an answer the phone keeps (a list, a project, a conversation): with the tag of the one it has
  /// ([have]), the computer says "unchanged" in a few bytes when that's still it, instead of sending it all again.
  /// The answer's own tag comes back with it, for next time (none from a computer that doesn't tag its answers).
  Future<({bool unchanged, dynamic value, String? tag})> callKept(
    String method,
    List<dynamic> args, {
    String? have,
  }) async {
    try {
      final request = await _request('POST', '/rpc');
      request.headers.contentType = ContentType.json;
      if (have != null) {
        request.headers.set(HttpHeaders.ifNoneMatchHeader, have);
      }
      request.write(jsonEncode({'method': method, 'args': args}));
      final response = await request.close();
      if (response.statusCode == 304 && have != null) {
        await response.drain<void>().catchError((_) {});
        return (unchanged: true, value: null, tag: have);
      }
      final tag = response.headers.value(HttpHeaders.etagHeader);
      return (unchanged: false, value: await _decode(response), tag: tag);
    } catch (e) {
      if (_disposed) {
        return Completer<({bool unchanged, dynamic value, String? tag})>()
            .future;
      }
      if (e is BridgeException) rethrow;
      throw BridgeException(plain(e, where: connection?.name));
    }
  }

  void listen() {
    final generation = ++_generation;
    unawaited(_listen(generation));
  }

  /// Moves to whichever of the computer's addresses answers first (home Wi-Fi, or the private network away) when
  /// that isn't the one in use. True when it did, and listening restarted there.
  Future<bool> _preferReachable(int generation) async {
    final current = connection;
    if (current == null || current.urls.length < 2) return false;
    // stay where it is while that answers (several may; switching between them would never settle)
    final here = Connection(current.url, current.fingerprint, current.token);
    if (await firstToAnswer(here, timeout: const Duration(seconds: 3)) !=
        null) {
      return false;
    }
    final first = await firstToAnswer(current);
    if (_disposed || generation != _generation) return true;
    if (first == null || first == current.url) return false;
    _configure(
      Connection(
        first,
        current.fingerprint,
        current.token,
        current.urls,
        current.machine,
        current.name,
      ),
    );
    await storage.write(
      key: _storageKey,
      value: jsonEncode(connection!.toJson()),
    );
    listen();
    return true;
  }

  Future<void> _listen(int generation) async {
    if (await _preferReachable(generation)) return;
    var delay = 1;
    while (!_disposed && generation == _generation && connection != null) {
      try {
        await _refreshAddresses();
        final response = await (await _request('GET', '/events')).close();
        if (response.statusCode != 200) {
          await _decode(response);
          return;
        }
        delay = 1;
        _events.add({
          'channel': 'connection',
          'args': [true],
        });
        await for (final line
            in response
                .transform(utf8.decoder)
                .transform(const LineSplitter())
                .timeout(const Duration(seconds: 40))) {
          if (_disposed || generation != _generation) return;
          if (line.startsWith('data: ')) {
            _events.add(object(jsonDecode(line.substring(6))));
          }
        }
      } catch (error) {
        if (_disposed || generation != _generation) return;
        if (error is BridgeException && error.status == 401) {
          // signed in: the computer's day-long token ran out; the account has a new one
          final expired = connection;
          if (renew != null && expired?.machine != null) {
            String? why;
            try {
              final fresh = await renew!(expired!);
              if (fresh != null && !_disposed) {
                // a cloud worker taken anew may first restart into this person's space: give it a minute
                final end = DateTime.now().add(const Duration(seconds: 60));
                for (;;) {
                  try {
                    // every address at once (some may never answer from here), then the one that did
                    final first = await firstToAnswer(
                      fresh,
                      timeout: const Duration(seconds: 5),
                    );
                    if (first == null) {
                      throw BridgeException('Not answering yet');
                    }
                    await connectDirect(
                      Connection(
                        first,
                        fresh.fingerprint,
                        fresh.token,
                        [first, ...fresh.urls.where((u) => u != first)],
                        fresh.machine,
                        fresh.name,
                      ),
                    );
                    break;
                  } catch (e) {
                    if (_disposed || generation != _generation) return;
                    // one of the person's own computers answers at once or not at all
                    if (fresh.name != 'AgentShot Cloud') rethrow;
                    if (DateTime.now().isAfter(end)) {
                      throw BridgeException(
                        'AgentShot Cloud didn’t open your space in time. Try again in a moment.',
                      );
                    }
                    _events.add({
                      'channel': 'connection',
                      'args': [false, 'Opening your space…'],
                    });
                    await Future<void>.delayed(const Duration(seconds: 1));
                  }
                }
                listen();
                return;
              }
            } on BridgeException catch (e) {
              // AgentShot Cloud had no spot to give back (all busy, or this person's turn is over for now)
              if (expired?.name == 'AgentShot Cloud') why = e.message;
            } catch (_) {}
            if (_disposed || generation != _generation) return;
            if (why != null) {
              await storage.delete(key: _storageKey);
              _events.add({
                'channel': 'connection',
                'args': [false, why, 'revoked'],
              });
              return;
            }
          }
          // the computer doesn't let this phone in any more (removed there, or the pairing ended): connect again
          await storage.delete(key: _storageKey);
          _events.add({
            'channel': 'connection',
            'args': [
              false,
              'Your computer disconnected this phone. Connect again to keep going.',
              'revoked',
            ],
          });
          return;
        }
        // a cloud worker opening this person's space (it restarts into it): a few seconds, say so
        if (error is BridgeException && error.status == 503) {
          _events.add({
            'channel': 'connection',
            'args': [false, error.message],
          });
          if (_disposed || generation != _generation) return;
          await Future<void>.delayed(const Duration(seconds: 1));
          continue;
        }
        // another of its addresses may answer (home Wi-Fi again, or the private network away)
        if (await _preferReachable(generation)) return;
        // off, asleep or out of reach: keep trying
        _events.add({
          'channel': 'connection',
          'args': [
            false,
            connection?.name == 'AgentShot Cloud'
                ? 'Reconnecting to AgentShot Cloud…'
                : 'Can’t reach ${connection?.name ?? 'your computer'}. Make sure AgentShot is open on it and both are online.',
          ],
        });
      }
      if (_disposed || generation != _generation) return;
      await Future<void>.delayed(Duration(seconds: delay));
      delay = min(delay * 2, 15);
    }
  }

  Future<dynamic> upload(
    File file,
    String name, {
    String? project,
    void Function(double)? progress,
  }) async {
    final request = await _request('POST', '/upload', {
      'name': name,
      'project': ?project,
    });
    final size = await file.length();
    request.contentLength = size;
    request.headers.contentType = ContentType.binary;
    var sent = 0;
    await request.addStream(
      file.openRead().map((chunk) {
        sent += chunk.length;
        progress?.call(sent / size);
        return chunk;
      }),
    );
    return _decode(await request.close());
  }

  /// A voice note recorded here, as the words said (the computer's speech recognition), for the composer.
  Future<String> voiceNote(File file, String project) async {
    final request = await _request('POST', '/voice', {'project': project});
    request.contentLength = await file.length();
    request.headers.contentType = ContentType('audio', 'mp4');
    await request.addStream(file.openRead());
    final reply = object(await _decode(await request.close()));
    return '${reply['text'] ?? ''}';
  }

  Future<Uri> media(String project, String file) =>
      _localUrl('/media', {'project': project, 'file': file});

  /// A small picture of a project file: a frame of a video, or the photo (for lists of footage).
  Future<Uri> thumbnail(String project, String file) =>
      _localUrl('/thumbnail', {'project': project, 'file': file});
  Future<Uri> gallery(String url) {
    final uri = Uri.parse(url);
    if (uri.scheme == 'https' && uri.userInfo.isEmpty) return Future.value(uri);
    return _localUrl('/gallery', {'url': url});
  }

  Future<Uri> _localUrl(String route, Map<String, String> query) async {
    if (_relay == null) {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      if (_relay != null) {
        await server.close(force: true);
      } else {
        _relay = server;
        unawaited(_serve(server));
      }
    }
    final seen = _versions[_cacheKey(route, query)] ?? 0;
    return Uri.http('127.0.0.1:${_relay!.port}', '/$_relaySecret$route', {
      ...query,
      if (seen > 0) 'v': '$seen',
    });
  }

  Future<void> _serve(HttpServer server) async {
    await for (final local in server) {
      unawaited(_forward(local));
    }
  }

  Future<void> _forward(HttpRequest local) async {
    try {
      final route = local.uri.path;
      if (!['GET', 'HEAD'].contains(local.method) ||
          ![
            '/$_relaySecret/media',
            '/$_relaySecret/gallery',
            '/$_relaySecret/thumbnail',
          ].contains(route)) {
        local.response.statusCode = 403;
        await local.response.close();
        return;
      }
      final path = route.substring(_relaySecret.length + 1);
      // the local address's version is the phone's own, not the computer's
      final query = {...local.uri.queryParameters}..remove('v');
      final range = local.headers.value(HttpHeaders.rangeHeader);
      final key = _cacheKey(path, query);
      // kept on the phone: shown from here at once, and checked with the computer meanwhile (fetched anew if it changed)
      if (key != null) {
        final kept = await cache.lookup(key);
        if (kept != null) {
          if (!cache.recentlyChecked(key) && path != '/gallery') {
            unawaited(_recheck(path, query, key, kept.$1));
          }
          await _serveKept(local, kept.$2, kept.$1, range);
          return;
        }
      }
      final remote = await _request(local.method, path, query);
      if (range != null) remote.headers.set(HttpHeaders.rangeHeader, range);
      final response = await remote.close();
      local.response.statusCode = response.statusCode;
      for (final key in [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
      ]) {
        final value = response.headers.value(key);
        if (value != null) local.response.headers.set(key, value);
      }
      final etag = _versionOf(path, response);
      // the whole file, as it comes (a picture): kept on its way through
      if (key != null &&
          etag != null &&
          local.method == 'GET' &&
          response.statusCode == 200) {
        final writer = await cache.write(key, etag, _typeOf(response));
        try {
          await local.response.addStream(
            response.map((chunk) {
              writer.add(chunk);
              return chunk;
            }),
          );
          await writer.commit(response.contentLength);
        } catch (_) {
          await writer.abort();
          rethrow;
        }
        await local.response.close();
        return;
      }
      await local.response.addStream(response);
      await local.response.close();
      // a film the player streams in parts: fetched whole in the background, to play from the phone next time
      if (key != null && etag != null && response.statusCode == 206) {
        unawaited(cache.fill(key, () => _fetchWhole(path, query, key)));
      }
    } catch (_) {
      local.response.statusCode = 502;
      await local.response.close().catchError((_) {});
    }
  }

  /// Where a computer's file is kept on the phone.
  String? _cacheKey(String path, Map<String, String> query) {
    final computer = connection?.fingerprint;
    if (computer == null) return null;
    return MediaCache.keyOf(computer, path, query);
  }

  /// The version of what came back: the computer's tag; a gallery example's poster never changes (one per example).
  /// A computer from before tags (every release so far) still gets its films kept: versioned by their whole size and
  /// when they changed, which a new render in their place changes too.
  static String? _versionOf(String path, HttpClientResponse response) {
    final tag = response.headers.value(HttpHeaders.etagHeader);
    if (tag != null) return tag;
    if (path == '/gallery') return '"gallery"';
    final total = response.statusCode == 206
        ? int.tryParse(
            response.headers
                    .value(HttpHeaders.contentRangeHeader)
                    ?.split('/')
                    .last ??
                '',
          )
        : (response.contentLength >= 0 ? response.contentLength : null);
    if (total == null) return null;
    final changed =
        response.headers.value(HttpHeaders.lastModifiedHeader) ?? '';
    return 'W/"$total-$changed"';
  }

  static String _typeOf(HttpClientResponse response) =>
      response.headers.value(HttpHeaders.contentTypeHeader) ??
      'application/octet-stream';

  /// Whether what's kept is still the computer's version: asked by its tag (a few bytes back when it is), at most every
  /// couple of minutes. When the computer can't be reached, what's kept is the best there is, so it plays.
  Future<bool> _stillCurrent(
    String path,
    Map<String, String> query,
    String key,
    CachedMedia kept,
  ) async {
    if (cache.recentlyChecked(key) || path == '/gallery') return true;
    try {
      // the thumbnail route answers GET only; a 304 has no body either way
      final request = await _request(
        path == '/media' ? 'HEAD' : 'GET',
        path,
        query,
      ).timeout(const Duration(seconds: 4));
      request.headers.set(HttpHeaders.ifNoneMatchHeader, kept.etag);
      final response = await request.close().timeout(
        const Duration(seconds: 6),
      );
      final tag = _versionOf(path, response);
      await response.drain<void>().catchError((_) {});
      if (response.statusCode == 304 ||
          (response.statusCode == 200 && tag == kept.etag)) {
        cache.markChecked(key);
        return true;
      }
      if (response.statusCode == 200) {
        // changed on the computer: fetched again
        await cache.drop(key);
        return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  /// Checks a kept file with the computer while it's already showing: when it changed there, the new one is fetched
  /// whole into the cache and whatever shows it reloads. Once at a time per file (a film is asked for in many parts);
  /// when the computer can't be reached, what's kept stays.
  Future<void> _recheck(
    String path,
    Map<String, String> query,
    String key,
    CachedMedia kept,
  ) async {
    cache.markChecked(key);
    try {
      // the thumbnail route answers GET only; a 304 has no body either way
      final request = await _request(
        path == '/media' ? 'HEAD' : 'GET',
        path,
        query,
      ).timeout(const Duration(seconds: 10));
      request.headers.set(HttpHeaders.ifNoneMatchHeader, kept.etag);
      final response = await request.close().timeout(
        const Duration(seconds: 15),
      );
      final tag = _versionOf(path, response);
      await response.drain<void>().catchError((_) {});
      if (response.statusCode != 200 || tag == null || tag == kept.etag) return;
      await cache.fill(key, () => _fetchWhole(path, query, key));
      if (await cache.lookup(key) case (
        final now,
        _,
      ) when now.etag != kept.etag) {
        _versions[key] = (_versions[key] ?? 0) + 1;
        _mediaChanged.add((query['project'] ?? '', query['file'] ?? ''));
      }
    } catch (_) {
      // not reachable now: what's kept is the best there is
    }
  }

  /// A kept file, served to the player as the computer would (in the parts it asks for).
  Future<void> _serveKept(
    HttpRequest local,
    File file,
    CachedMedia kept,
    String? range,
  ) async {
    final size = kept.size;
    final out = local.response;
    out.headers
      ..set(HttpHeaders.contentTypeHeader, kept.type)
      ..set(HttpHeaders.acceptRangesHeader, 'bytes')
      ..set(HttpHeaders.etagHeader, kept.etag);
    var start = 0, end = size - 1;
    if (range != null) {
      final match = RegExp(r'^bytes=(\d*)-(\d*)$').firstMatch(range.trim());
      final a = int.tryParse(match?.group(1) ?? ''),
          b = int.tryParse(match?.group(2) ?? '');
      if (a != null) {
        start = a;
        if (b != null) end = min(b, size - 1);
      } else if (b != null) {
        start = max(0, size - b);
      }
      if (match == null ||
          (a == null && b == null) ||
          start > end ||
          start >= size) {
        out.statusCode = 416;
        out.headers.set(HttpHeaders.contentRangeHeader, 'bytes */$size');
        await out.close();
        return;
      }
      out.statusCode = 206;
      out.headers.set(
        HttpHeaders.contentRangeHeader,
        'bytes $start-$end/$size',
      );
    }
    out.contentLength = max(0, end - start + 1);
    if (local.method == 'HEAD' || size == 0) {
      await out.close();
      return;
    }
    await out.addStream(file.openRead(start, end + 1));
    await out.close();
  }

  /// The whole of a file into the cache, without anyone waiting on it.
  Future<void> _fetchWhole(
    String path,
    Map<String, String> query,
    String key,
  ) async {
    final response = await (await _request('GET', path, query)).close();
    final etag = _versionOf(path, response);
    if (response.statusCode != 200 || etag == null) {
      await response.drain<void>();
      return;
    }
    final writer = await cache.write(key, etag, _typeOf(response));
    try {
      await for (final chunk in response) {
        writer.add(chunk);
      }
      await writer.commit(response.contentLength);
    } catch (_) {
      await writer.abort();
      rethrow;
    }
  }

  /// A project file fetched whole into the phone in the background when it isn't kept yet: the film opened plays from
  /// here from the first tap, not over the network, and never stalls there.
  Future<void> keep(String project, String file) async {
    final query = {'project': project, 'file': file};
    final key = _cacheKey('/media', query);
    if (key == null || await cache.lookup(key) != null) return;
    await cache.fill(key, () => _fetchWhole('/media', query, key));
  }

  /// A project file on the phone, to share or save: what's kept when it's still current, else fetched (and kept).
  Future<File> download(
    String project,
    String relative, {
    void Function(double)? progress,
  }) async {
    final query = {'project': project, 'file': relative};
    final key = _cacheKey('/media', query);
    final directory = await Directory(
      '${(await getTemporaryDirectory()).path}/agentshot-exports',
    ).create(recursive: true);
    final name = relative
        .split('/')
        .last
        .replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
    final file = File(
      '${directory.path}/${DateTime.now().microsecondsSinceEpoch}-$name',
    );
    if (key != null) {
      final kept = await cache.lookup(key);
      if (kept != null && await _stillCurrent('/media', query, key, kept.$1)) {
        progress?.call(1);
        return kept.$2.copy(file.path);
      }
    }
    final response = await (await _request('GET', '/media', query)).close();
    if (response.statusCode != 200) {
      await _decode(response);
      throw BridgeException('Download failed');
    }
    final etag = response.headers.value(HttpHeaders.etagHeader);
    var received = 0;
    final counted = response.map((chunk) {
      received += chunk.length;
      if (response.contentLength > 0) {
        progress?.call(received / response.contentLength);
      }
      return chunk;
    });
    // kept as it comes, then copied out to share: the next share (or a look in the player) needs no network
    if (key != null && etag != null) {
      final writer = await cache.write(key, etag, _typeOf(response));
      try {
        await for (final chunk in counted) {
          writer.add(chunk);
        }
        await writer.commit(response.contentLength);
      } catch (_) {
        await writer.abort();
        rethrow;
      }
      final kept = await cache.lookup(key);
      if (kept != null) return kept.$2.copy(file.path);
      throw BridgeException('Download failed');
    }
    final sink = file.openWrite();
    try {
      await sink.addStream(counted);
      await sink.close();
      return file;
    } catch (_) {
      await sink.close();
      if (await file.exists()) await file.delete();
      rethrow;
    }
  }

  Future<void> disconnect() async {
    _generation++;
    // Ask the desktop to forget this phone too; offline, it stays listed there until removed on the desktop.
    try {
      final request = await _request('POST', '/unpair');
      await (await request.close()).drain<void>().timeout(
        const Duration(seconds: 5),
      );
    } catch (_) {}
    _http?.close(force: true);
    _http = null;
    connection = null;
    await _relay?.close(force: true);
    _relay = null;
    await storage.delete(key: _storageKey);
    await storage.delete(key: _meshStorageKey);
    await Mesh.stop();
    // what was kept of that computer's films goes with it
    await cache.clear().catchError((_) {});
  }

  Future<void> dispose() async {
    _disposed = true;
    _generation++;
    _http?.close(force: true);
    await _relay?.close(force: true);
    await _events.close();
  }
}
