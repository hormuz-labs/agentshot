// The phone's media relay with its cache, against a stand-in computer (pinned TLS, ETags and ranges like the desktop's
// bridge): a film comes over once, plays from the phone after that, comes again only when it changed, and still plays
// with the computer out of reach.
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/media_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // real sockets: the test binding's own HTTP stand-in answers 400 to everything
  HttpOverrides.global = null;
  FlutterSecureStorage.setMockInitialValues({});

  late Directory tmp;
  late HttpServer computer;
  late String fingerprint;
  var film = utf8.encode('0123456789'), etag = '"v1"';
  final asked = <String>[];

  setUpAll(() async {
    tmp = await Directory.systemTemp.createTemp('media-relay-test-');
    // where a shared film is copied out to
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async => tmp.path,
    );
    final made = await Process.run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-keyout', '${tmp.path}/key.pem', '-out', '${tmp.path}/cert.pem',
    ]);
    expect(made.exitCode, 0, reason: '${made.stderr}');
    final pem = await File('${tmp.path}/cert.pem').readAsString();
    final der = base64.decode(pem.split('\n').where((l) => l.isNotEmpty && !l.startsWith('-----')).join());
    fingerprint = sha256.convert(der).toString();
    final context = SecurityContext()
      ..useCertificateChain('${tmp.path}/cert.pem')
      ..usePrivateKey('${tmp.path}/key.pem');
    computer = await HttpServer.bindSecure(InternetAddress.loopbackIPv4, 0, context);
    computer.listen((req) async {
      final res = req.response;
      if (req.uri.path == '/hello') {
        res.write('{}');
        await res.close();
        return;
      }
      final range = req.headers.value('range');
      asked.add('${req.method} ${range ?? 'whole'} ${req.headers.value('if-none-match') ?? ''}'.trim());
      res.headers
        ..set('etag', etag)
        ..set('accept-ranges', 'bytes')
        ..contentType = ContentType('video', 'mp4');
      if (req.headers.value('if-none-match') == etag) {
        res.statusCode = 304;
        await res.close();
        return;
      }
      var bytes = film;
      if (range != null) {
        final m = RegExp(r'bytes=(\d+)-(\d*)').firstMatch(range)!;
        final a = int.parse(m.group(1)!), b = m.group(2)!.isEmpty ? film.length - 1 : int.parse(m.group(2)!);
        bytes = film.sublist(a, b + 1);
        res.statusCode = 206;
        res.headers.set('content-range', 'bytes $a-$b/${film.length}');
      }
      res.contentLength = bytes.length;
      if (req.method != 'HEAD') res.add(bytes);
      await res.close();
    });
  });

  tearDownAll(() async {
    await computer.close(force: true);
    await tmp.delete(recursive: true);
  });

  Future<(int, String)> play(Uri uri, String range) async {
    final http = HttpClient();
    try {
      final req = await http.getUrl(uri);
      req.headers.set('range', range);
      final res = await req.close();
      return (res.statusCode, await utf8.decodeStream(res));
    } finally {
      http.close(force: true);
    }
  }

  test('a film comes over once, then plays from the phone until it changes, and offline too', () async {
    final cache = MediaCache(root: () async => Directory('${tmp.path}/cache'));
    final client = BridgeClient(cache: cache);
    await client.connectDirect(
      Connection(Uri.parse('https://127.0.0.1:${computer.port}'), fingerprint, 'token'),
    );
    final uri = await client.media('/p', 'renders/cut.mp4');

    // first play: streamed from the computer in parts, and fetched whole behind it
    expect(await play(uri, 'bytes=0-3'), (206, '0123'));
    for (var i = 0; i < 50 && await cache.size() == 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(await cache.size(), 10);
    expect(asked, ['GET bytes=0-3', 'GET whole']);

    // again: from the phone, nothing asked of the computer
    asked.clear();
    expect(await play(uri, 'bytes=2-5'), (206, '2345'));
    expect(await play(uri, 'bytes=-3'), (206, '789'));
    expect(asked, isEmpty);

    // checked with the computer by its tag: unchanged costs a 304, nothing more
    MediaCache.recheck = Duration.zero;
    expect(await play(uri, 'bytes=0-1'), (206, '01'));
    expect(asked, ['HEAD whole "v1"']);

    // a new render in its place: fetched again
    asked.clear();
    film = utf8.encode('ABCDEFGHIJKL');
    etag = '"v2"';
    expect(await play(uri, 'bytes=0-3'), (206, 'ABCD'));
    expect(asked.first, 'HEAD whole "v1"');
    for (var i = 0; i < 50 && await cache.size() != 12; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(await cache.size(), 12);

    // sharing it needs no network: the kept file, copied out
    asked.clear();
    MediaCache.recheck = const Duration(minutes: 2);
    final shared = await client.download('/p', 'renders/cut.mp4');
    expect(await shared.readAsString(), 'ABCDEFGHIJKL');
    expect(asked, isEmpty);

    // the computer out of reach: what's kept still plays
    MediaCache.recheck = Duration.zero;
    await computer.close(force: true);
    expect(await play(uri, 'bytes=4-7'), (206, 'EFGH'));
    await client.dispose();
  });
}
