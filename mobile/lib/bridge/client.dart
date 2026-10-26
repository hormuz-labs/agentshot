import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'mesh.dart';

typedef Json = Map<String, dynamic>;
Json object(dynamic value) => Map<String, dynamic>.from(value as Map);
List<Json> objects(dynamic value) =>
    (value as List? ?? []).map(object).toList();

/// Any error, as the person should read it: AgentShot's own messages as they are, the network's (a socket closed, a
/// timeout, a certificate) as what to check, and never the raw exception. [where] names the computer.
String plain(Object error, {String? where}) {
  if (error is BridgeException) return error.message;
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
  int _generation = 0;
  bool _disposed = false;
  BridgeClient({this.storage = const FlutterSecureStorage()});

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

  static String _proxyFor(Uri uri) => Mesh.proxyPort != null && Mesh.isMeshHost(uri.host)
      ? 'PROXY 127.0.0.1:${Mesh.proxyPort}'
      : 'DIRECT';

  /// The first of [target]'s addresses that answers, so pairing away from home doesn't wait on dead Wi-Fi addresses.
  Future<Connection> _fastest(Connection target) async {
    final found = Completer<Uri?>();
    var pending = target.urls.length;
    for (final candidate in target.urls) {
      final client = HttpClient(context: SecurityContext(withTrustedRoots: false))
        ..connectionTimeout = const Duration(seconds: 20)
        ..findProxy = _proxyFor
        ..badCertificateCallback = (certificate, host, port) =>
            sha256.convert(certificate.der).toString() == target.fingerprint;
      unawaited(() async {
        try {
          final req = await client.getUrl(candidate.replace(path: '/discover'));
          final res = await req.close().timeout(const Duration(seconds: 20));
          await res.drain<void>();
          if (res.statusCode == 200 && !found.isCompleted) found.complete(candidate);
        } catch (_) {
        } finally {
          client.close(force: true);
          if (--pending == 0 && !found.isCompleted) found.complete(null);
        }
      }());
    }
    final first = await found.future;
    return first == null ? target : Connection(first, target.fingerprint, target.token, target.urls);
  }

  Future<Connection> _discover({String? host}) async {
    final candidates = <String>[];
    final cleanHost = host?.trim() ?? '';
    if (cleanHost.isNotEmpty) {
      candidates.add(
        cleanHost.contains(':') ? cleanHost : '$cleanHost:$defaultPort',
      );
    } else {
      candidates.addAll([
        '10.0.2.2:$defaultPort',
        '127.0.0.1:$defaultPort',
      ]);
      try {
        final socket = await RawDatagramSocket.bind(
          InternetAddress.anyIPv4,
          0,
        );
        socket.broadcastEnabled = true;
        final payload = utf8.encode('manul-discover');
        socket.send(
          payload,
          InternetAddress('255.255.255.255'),
          defaultPort,
        );
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
            final primary =
                'https://${dg.address.address}:$defaultPort';
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
      final client = HttpClient(context: SecurityContext(withTrustedRoots: false))
        ..connectionTimeout = const Duration(milliseconds: 600)
        ..badCertificateCallback = (_, _, _) => true;
      try {
        final uri = Uri.parse('https://$authority/discover');
        final req = await client.getUrl(uri);
        final res = await req.close().timeout(
          const Duration(milliseconds: 800),
        );
        if (res.statusCode != 200) return null;
        final data = object(await utf8.decoder.bind(res).join().then(jsonDecode));
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
          await storage.write(key: _meshStorageKey, value: mesh['control'] as String);
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
      _configure(
        Connection(candidate, target.fingerprint, '', target.urls),
      );
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
          req.headers.set(HttpHeaders.authorizationHeader, 'Bearer ${target.token}');
          req.headers.set('x-agentshot-device', deviceName);
          final res = await req.close().timeout(timeout);
          await res.drain<void>();
          if (res.statusCode == 200 && !found.isCompleted) found.complete(candidate);
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
      _configure(Connection(candidate, target.fingerprint, target.token, target.urls, target.machine, target.name));
      try {
        final req = await _open('GET', candidate.replace(path: '/hello'));
        req.followRedirects = false;
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer ${target.token}');
        req.headers.set('x-agentshot-device', deviceName);
        final res = await req.close().timeout(const Duration(seconds: 6));
        if (res.statusCode != 200) {
          throw BridgeException('Worker refused connection (${res.statusCode}).', res.statusCode);
        }
        await storage.write(key: _storageKey, value: jsonEncode(connection!.toJson()));
        return;
      } catch (e) {
        lastError = e;
      }
    }
    _http?.close(force: true);
    connection = null;
    throw lastError ?? BridgeException('Could not reach the worker on any address.');
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
    if (await firstToAnswer(here, timeout: const Duration(seconds: 3)) != null) return false;
    final first = await firstToAnswer(current);
    if (_disposed || generation != _generation) return true;
    if (first == null || first == current.url) return false;
    _configure(Connection(first, current.fingerprint, current.token, current.urls, current.machine, current.name));
    await storage.write(key: _storageKey, value: jsonEncode(connection!.toJson()));
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
                    final first = await firstToAnswer(fresh, timeout: const Duration(seconds: 5));
                    if (first == null) throw BridgeException('Not answering yet');
                    await connectDirect(Connection(first, fresh.fingerprint, fresh.token, [first, ...fresh.urls.where((u) => u != first)], fresh.machine, fresh.name));
                    break;
                  } catch (e) {
                    if (_disposed || generation != _generation) return;
                    // one of the person's own computers answers at once or not at all
                    if (fresh.name != 'AgentShot Cloud') rethrow;
                    if (DateTime.now().isAfter(end)) {
                      throw BridgeException('AgentShot Cloud didn’t open your space in time. Try again in a moment.');
                    }
                    _events.add({
                      'channel': 'connection',
                      'args': [false, 'Opening your space…'],
                    });
                    await Future<void>.delayed(const Duration(seconds: 3));
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
          await Future<void>.delayed(const Duration(seconds: 2));
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
    return Uri.http('127.0.0.1:${_relay!.port}', '/$_relaySecret$route', query);
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
      final remote = await _request(
        local.method,
        route.substring(_relaySecret.length + 1),
        local.uri.queryParameters,
      );
      final range = local.headers.value(HttpHeaders.rangeHeader);
      if (range != null) remote.headers.set(HttpHeaders.rangeHeader, range);
      final response = await remote.close();
      local.response.statusCode = response.statusCode;
      for (final key in [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ]) {
        final value = response.headers.value(key);
        if (value != null) local.response.headers.set(key, value);
      }
      await local.response.addStream(response);
      await local.response.close();
    } catch (_) {
      local.response.statusCode = 502;
      await local.response.close().catchError((_) {});
    }
  }

  Future<File> download(
    String project,
    String relative, {
    void Function(double)? progress,
  }) async {
    final response = await (await _request('GET', '/media', {
      'project': project,
      'file': relative,
    })).close();
    if (response.statusCode != 200) {
      await _decode(response);
      throw BridgeException('Download failed');
    }
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
    final sink = file.openWrite();
    var received = 0;
    try {
      await sink.addStream(
        response.map((chunk) {
          received += chunk.length;
          if (response.contentLength > 0) {
            progress?.call(received / response.contentLength);
          }
          return chunk;
        }),
      );
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
      await (await request.close()).drain<void>().timeout(const Duration(seconds: 5));
    } catch (_) {}
    _http?.close(force: true);
    _http = null;
    connection = null;
    await _relay?.close(force: true);
    _relay = null;
    await storage.delete(key: _storageKey);
    await storage.delete(key: _meshStorageKey);
    await Mesh.stop();
  }

  Future<void> dispose() async {
    _disposed = true;
    _generation++;
    _http?.close(force: true);
    await _relay?.close(force: true);
    await _events.close();
  }
}
