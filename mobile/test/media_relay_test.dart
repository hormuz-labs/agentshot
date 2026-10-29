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
  // a computer from before tags (every release so far): no ETag, no 304
  var tags = true;
  final asked = <String>[];
  final hellos = <String>[];

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
        hellos.add(req.uri.query);
        res.write(
          req.uri.queryParameters['mesh'] == 'join'
              ? '{"mesh":{"control":"https://mesh.example","key":"k"}}'
              : '{}',
        );
        await res.close();
        return;
      }
      final range = req.headers.value('range');
      asked.add('${req.method} ${range ?? 'whole'} ${req.headers.value('if-none-match') ?? ''}'.trim());
      res.headers
        ..set('accept-ranges', 'bytes')
        ..contentType = ContentType('video', 'mp4');
      if (tags) res.headers.set('etag', etag);
      if (tags && req.headers.value('if-none-match') == etag) {
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

  test(
    'paired before the computer had its private network: asks for a way on, once',
    () async {
      BridgeClient.canJoinMesh = true;
      hellos.clear();
      final client = BridgeClient(
        cache: MediaCache(root: () async => Directory('${tmp.path}/mesh')),
      );
      try {
        await client.connectDirect(
          Connection(
            Uri.parse('https://127.0.0.1:${computer.port}'),
            fingerprint,
            'token',
          ),
        );
        client.listen();
        // it says hello again on every reconnect: the stand-in's events end at once
        for (var i = 0; i < 60 && hellos.length < 4; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        expect(hellos.length, greaterThanOrEqualTo(4));
        expect(hellos.where((q) => q == 'mesh=join'), hasLength(1));
      } finally {
        BridgeClient.canJoinMesh = false;
        await client.dispose();
      }
    },
  );

  test('a computer without tags still has its films kept, versioned by their size', () async {
    final cache = MediaCache(root: () async => Directory('${tmp.path}/untagged'));
    final client = BridgeClient(cache: cache);
    await client.connectDirect(
      Connection(Uri.parse('https://127.0.0.1:${computer.port}'), fingerprint, 'token'),
    );
    tags = false;
    try {
      // the film opened is fetched whole, without anyone playing it
      await client.keep('/p', 'renders/old.mp4');
      expect(await cache.size(), film.length);
      asked.clear();
      final uri = await client.media('/p', 'renders/old.mp4');
      final http = HttpClient();
      final req = await http.getUrl(uri);
      req.headers.set('range', 'bytes=2-5');
      final res = await req.close();
      expect((res.statusCode, await utf8.decodeStream(res)), (206, '2345'));
      http.close(force: true);
      // played from the phone: nothing asked of the computer
      expect(asked, isEmpty);
    } finally {
      tags = true;
      await client.dispose();
    }
  });

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

    Future<void> settle(bool Function() done) async {
      for (var i = 0; i < 100 && !done(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    }

    // checked with the computer by its tag behind what's already playing: unchanged costs a 304, nothing more
    MediaCache.recheck = Duration.zero;
    expect(await play(uri, 'bytes=0-1'), (206, '01'));
    await settle(() => asked.isNotEmpty);
    expect(asked, ['HEAD whole "v1"']);

    // a new render in its place: the kept one plays at once, the new one comes behind it, and its picture reloads
    asked.clear();
    film = utf8.encode('ABCDEFGHIJKL');
    etag = '"v2"';
    final changed = client.mediaChanged.first;
    expect(await play(uri, 'bytes=0-3'), (206, '0123'));
    expect(await changed.timeout(const Duration(seconds: 5)), ('/p', 'renders/cut.mp4'));
    expect(asked, ['HEAD whole "v1"', 'GET whole']);
    expect(await cache.size(), 12);
    final fresh = await client.media('/p', 'renders/cut.mp4');
    expect(fresh, isNot(uri));
    MediaCache.recheck = const Duration(minutes: 2);
    expect(await play(fresh, 'bytes=0-3'), (206, 'ABCD'));

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
