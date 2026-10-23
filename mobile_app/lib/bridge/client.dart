import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

typedef Json = Map<String, dynamic>;
Json object(dynamic value) => Map<String, dynamic>.from(value as Map);
List<Json> objects(dynamic value) =>
    (value as List? ?? []).map(object).toList();

class BridgeException implements Exception {
  final String message;
  final int? status;
  BridgeException(this.message, [this.status]);
  @override
  String toString() => message;
}

class Connection {
  final Uri url;
  final String fingerprint;
  final String token;
  Connection(this.url, this.fingerprint, this.token);
  factory Connection.fromJson(Json json) {
    final url = Uri.parse(json['url'] as String);
    final fingerprint = json['fingerprint'] as String;
    if (url.scheme != 'https' ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment ||
        (url.path.isNotEmpty && url.path != '/') ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw BridgeException(
        'Paste the complete connection code from Manul → Settings → Mobile.',
      );
    }
    return Connection(url, fingerprint, json['token'] as String? ?? '');
  }
  Json toJson() => {
    'url': url.toString(),
    'fingerprint': fingerprint,
    'token': token,
  };
}

/// All remote traffic, including native-player media, uses certificate-pinned TLS.
/// The localhost relay lets AVPlayer/ExoPlayer stream without bypassing their TLS checks.
class BridgeClient {
  static const _storageKey = 'manul.desktop.connection.v1';
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

  Future<bool> restore() async {
    final saved = await storage.read(key: _storageKey);
    if (saved == null) return false;
    try {
      _configure(Connection.fromJson(object(jsonDecode(saved))));
      return true;
    } catch (_) {
      await storage.delete(key: _storageKey);
      return false;
    }
  }

  void _configure(Connection value) {
    _generation++;
    _http?.close(force: true);
    connection = value;
    _http = HttpClient(context: SecurityContext(withTrustedRoots: false))
      ..connectionTimeout = const Duration(seconds: 15)
      ..badCertificateCallback = (certificate, host, port) =>
          host == value.url.host &&
          port == value.url.port &&
          sha256.convert(certificate.der).toString() == value.fingerprint;
  }

  Future<void> pair(String code) async {
    final Json input;
    try {
      input = object(jsonDecode(code.trim()));
    } catch (_) {
      throw BridgeException(
        'That is not a connection code. Copy it from the desktop’s Mobile settings.',
      );
    }
    final target = Connection.fromJson(input);
    if (input['code'] is! String) {
      throw BridgeException('Connection code is missing.');
    }
    _configure(target);
    try {
      final result = object(
        await _post('/pair', {
          'code': input['code'],
          'name': Platform.isIOS ? 'iPhone / iPad' : 'Android',
        }),
      );
      if (result['protocol'] != 1) {
        throw BridgeException(
          'Update the mobile app to connect to this desktop.',
        );
      }
      connection = Connection(
        target.url,
        target.fingerprint,
        result['token'] as String,
      );
      await storage.write(
        key: _storageKey,
        value: jsonEncode(connection!.toJson()),
      );
    } catch (_) {
      _http?.close(force: true);
      connection = null;
      rethrow;
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
    final request = await _http!.openUrl(method, uri);
    request.followRedirects = false;
    if (target.token.isNotEmpty) {
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${target.token}',
      );
    }
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

  Future<dynamic> call(String method, [List<dynamic> args = const []]) =>
      _post('/rpc', {'method': method, 'args': args});

  void listen() {
    final generation = ++_generation;
    unawaited(_listen(generation));
  }

  Future<void> _listen(int generation) async {
    var delay = 1;
    while (!_disposed && generation == _generation && connection != null) {
      try {
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
        _events.add({
          'channel': 'connection',
          'args': [false, error.toString()],
        });
        if (error is BridgeException && error.status == 401) return;
      }
      if (_disposed || generation != _generation) return;
      _events.add({
        'channel': 'connection',
        'args': [false, 'Reconnecting to your desktop…'],
      });
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
          !['/$_relaySecret/media', '/$_relaySecret/gallery'].contains(route)) {
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
      '${(await getTemporaryDirectory()).path}/manul-exports',
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
    _http?.close(force: true);
    _http = null;
    connection = null;
    await _relay?.close(force: true);
    _relay = null;
    await storage.delete(key: _storageKey);
  }

  Future<void> dispose() async {
    _disposed = true;
    _generation++;
    _http?.close(force: true);
    await _relay?.close(force: true);
    await _events.close();
  }
}
