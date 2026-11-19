// Real TLS sockets through the production phone relay. Synthetic media keeps multi-GB cases cheap and deterministic.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/media_cache.dart';
import 'package:agentshot_mobile/bridge/media_ranges.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  FlutterSecureStorage.setMockInitialValues({});
  late Directory tmp;
  late HttpServer computer;
  late BridgeClient client;
  late MediaCache cache;
  late Directory cacheRoot;
  late SecurityContext tls;
  late String fingerprint;
  var size = 8 * 1024 * 1024 + 17,
      version = 1,
      transferred = 0,
      active = 0,
      peak = 0;
  var supportsBlocks = true, denied = false, malformed = false;
  var truncated = false;
  var chunkDelay = Duration.zero;
  Completer<void>? blockStarted, releaseBlock;
  int? mutateAfter;
  final ranges = <String>[];
  final http = HttpClient();
  List<int> content(int start, int length, int v) =>
      List.generate(length, (i) => (start + i + v) % 251);

  setUpAll(() async {
    tmp = await Directory.systemTemp.createTemp('media-relay-test-');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.flutter.io/path_provider'),
          (call) async => tmp.path,
        );
    final made = await Process.run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-keyout',
      '${tmp.path}/key.pem',
      '-out',
      '${tmp.path}/cert.pem',
    ]);
    expect(made.exitCode, 0, reason: '${made.stderr}');
    final pem = await File('${tmp.path}/cert.pem').readAsString();
    fingerprint = sha256
        .convert(
          base64.decode(
            pem
                .split('\n')
                .where((l) => l.isNotEmpty && !l.startsWith('-----'))
                .join(),
          ),
        )
        .toString();
    tls = SecurityContext()
      ..useCertificateChain('${tmp.path}/cert.pem')
      ..usePrivateKey('${tmp.path}/key.pem');
  });
  setUp(() async {
    size = 8 * 1024 * 1024 + 17;
    version = 1;
    transferred = 0;
    active = 0;
    peak = 0;
    supportsBlocks = true;
    denied = false;
    malformed = false;
    mutateAfter = null;
    ranges.clear();
    truncated = false;
    chunkDelay = Duration.zero;
    blockStarted = null;
    releaseBlock = null;
    computer = await HttpServer.bindSecure(
      InternetAddress.loopbackIPv4,
      0,
      tls,
    );
    computer.listen((req) async {
      final res = req.response;
      try {
        if (req.uri.path == '/hello' || req.uri.path == '/unpair') {
          res.write('{}');
          await res.close();
          return;
        }
        if (denied) {
          res.statusCode = 401;
          await res.close();
          return;
        }
        final tag = '"v$version"', v = version;
        res.headers
          ..set('etag', tag)
          ..set('accept-ranges', 'bytes')
          ..contentType = ContentType('video', 'mp4');
        if (supportsBlocks) res.headers.set('x-agentshot-range-cache', '1');
        if (req.headers.value('if-match') != null &&
            req.headers.value('if-match') != tag) {
          res.statusCode = 412;
          await res.close();
          return;
        }
        if (req.headers.value('if-none-match') == tag) {
          res.statusCode = 304;
          await res.close();
          return;
        }
        final header = req.headers.value('range');
        final range = header == null
            ? (start: 0, end: size - 1)
            : playbackRange(header, size);
        if (range == null) {
          res.statusCode = 416;
          await res.close();
          return;
        }
        if (header != null) {
          res.statusCode = 206;
          res.headers.set(
            'content-range',
            malformed
                ? 'bytes 0-0/$size'
                : 'bytes ${range.start}-${range.end}/$size',
          );
        }
        res.contentLength = range.end - range.start + 1;
        if (req.method == 'HEAD') {
          await res.close();
          return;
        }
        ranges.add(header ?? 'whole');
        active++;
        peak = max(peak, active);
        try {
          if (blockStarted?.isCompleted == false) blockStarted!.complete();
          await releaseBlock?.future;
          for (var offset = range.start; offset <= range.end; offset += 65536) {
            final n = min(65536, range.end - offset + 1);
            transferred += n;
            res.add(content(offset, n, v));
            await res.flush();
            if (truncated) {
              res.deadline = Duration.zero;
              return;
            }
            if (chunkDelay != Duration.zero) {
              await Future<void>.delayed(chunkDelay);
            }
          }
          await res.close();
          if (mutateAfter == ranges.length) version++;
        } finally {
          active--;
        }
      } catch (_) {
        res.deadline = Duration.zero;
      }
    });
    cacheRoot = Directory(
      '${tmp.path}/cache-${DateTime.now().microsecondsSinceEpoch}',
    );
    cache = MediaCache(root: () async => cacheRoot);
    client = BridgeClient(cache: cache);
    await client.connectDirect(
      Connection(
        Uri.parse('https://127.0.0.1:${computer.port}'),
        fingerprint,
        'token',
      ),
    );
  });
  tearDown(() async {
    await client.dispose();
    await computer.close(force: true);
  });
  tearDownAll(() async {
    http.close(force: true);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await tmp.delete(recursive: true);
  });

  Future<(int, List<int>)> play(
    Uri uri,
    String range, {
    String method = 'GET',
  }) async {
    final req = await http.openUrl(method, uri);
    req.headers.set('range', range);
    final res = await req.close();
    final bytes = await res.fold<BytesBuilder>(
      BytesBuilder(),
      (b, chunk) => b..add(chunk),
    );
    return (res.statusCode, bytes.takeBytes());
  }

  test('leaving does not wait on a computer that never answers', () async {
    client.unpairWait = const Duration(milliseconds: 200);
    final port = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final held = <Socket>[];
    port.listen(held.add);
    client.connection = Connection(Uri.parse('https://127.0.0.1:${port.port}'), fingerprint, 'token');
    try {
      await client.disconnect().timeout(const Duration(seconds: 3));
      expect(client.connection, isNull);
      expect(await cache.size(), 0);
    } finally {
      for (final socket in held) { socket.destroy(); }
      await port.close();
    }
  });

  test('an unwritable cache does not prevent online playback', () async {
    await client.dispose();
    final unavailable = File('${tmp.path}/not-a-directory');
    await unavailable.writeAsString('occupied');
    cache = MediaCache(root: () async => Directory(unavailable.path));
    client = BridgeClient(cache: cache);
    expect(await client.restore(), isTrue);
    final uri = await client.media('/p', 'film.mp4');
    expect((await play(uri, 'bytes=0-3')).$2, content(0, 4, 1));
    expect(ranges, hasLength(1));
  });

  test('a range crossing the last block preserves exact byte order and length', () async {
    size = MediaRanges.blockSize + 17;
    final uri = await client.media('/p', 'film.mp4');
    final start = MediaRanges.blockSize - 7;
    final result = await play(uri, 'bytes=$start-${size + 100}');
    expect(result.$1, 206);
    expect(result.$2, content(start, 24, 1));
    expect(transferred, size);
    expect(ranges, ['bytes=0-${MediaRanges.blockSize - 1}', 'bytes=${MediaRanges.blockSize}-${size - 1}']);
  });

  test(
    'short previews of a 20 GiB film fetch only touched blocks; replay and suffix seek reuse them',
    () async {
      size = 20 * 1024 * 1024 * 1024;
      final uri = await client.media('/p', 'film.mp4');
      final result = await play(uri, 'bytes=2-5');
      expect(result.$1, 206);
      expect(result.$2, content(2, 4, 1));
      expect(transferred, MediaRanges.blockSize);
      expect((await play(uri, 'bytes=3-7')).$2, content(3, 5, 1));
      expect(transferred, MediaRanges.blockSize);
      expect((await play(uri, 'bytes=-17')).$2, content(size - 17, 17, 1));
      expect(transferred, 2 * MediaRanges.blockSize);
      expect(ranges.every((r) => r != 'whole'), isTrue);
      expect(await cache.size(), lessThan(3 * MediaRanges.blockSize));
    },
  );
  test(
    'concurrent overlap is downloaded once and remote concurrency stays bounded',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      await Future.wait(
        List.generate(8, (i) => play(uri, 'bytes=${i * 2}-${i * 2 + 1}')),
      );
      expect(ranges, hasLength(1));
      await Future.wait(
        List.generate(
          5,
          (i) => play(
            uri,
            'bytes=${(i + 1) * MediaRanges.blockSize}-${(i + 1) * MediaRanges.blockSize + 1}',
          ),
        ),
      );
      expect(peak, lessThanOrEqualTo(2));
    },
  );
  test(
    'old player URLs cannot splice new renders into cached old blocks',
    () async {
      final old = await client.media('/p', 'film.mp4');
      await play(old, 'bytes=0-3');
      version = 2;
      expect(
        (await play(
          old,
          'bytes=${MediaRanges.blockSize}-${MediaRanges.blockSize + 3}',
        )).$1,
        502,
      );
      expect((await play(old, 'bytes=0-3')).$2, content(0, 4, 1));
      final fresh = await client.media('/p', 'film.mp4');
      expect(fresh, isNot(old));
      expect((await play(fresh, 'bytes=0-3')).$2, content(0, 4, 2));
    },
  );
  test(
    'a version change during a multi-block response fails instead of returning mixed bytes',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      mutateAfter = 1;
      await expectLater(
        play(uri, 'bytes=0-${2 * MediaRanges.blockSize - 1}'),
        throwsA(isA<HttpException>()),
      );
      expect(ranges, hasLength(1));
    },
  );
  test('malformed blocks are not cached and can be retried', () async {
    final uri = await client.media('/p', 'film.mp4');
    malformed = true;
    expect((await play(uri, 'bytes=0-3')).$1, 502);
    malformed = false;
    expect((await play(uri, 'bytes=0-3')).$2, content(0, 4, 1));
    expect(ranges, hasLength(2));
  });
  test(
    'HEAD and invalid ranges transfer no media; eviction respects the shared disk budget',
    () async {
      cache.limit = MediaRanges.blockSize + 4096;
      final uri = await client.media('/p', 'film.mp4');
      expect((await play(uri, 'bytes=0-3', method: 'HEAD')).$2, isEmpty);
      for (final range in [
        'bytes=-0',
        'bytes=4-2',
        'bytes=0-1,4-5',
        'bytes=$size-',
      ]) {
        expect((await play(uri, range)).$1, 416);
      }
      expect(transferred, 0);
      await play(uri, 'bytes=0-3');
      await play(
        uri,
        'bytes=${MediaRanges.blockSize}-${MediaRanges.blockSize + 3}',
      );
      expect(await cache.size(), lessThanOrEqualTo(cache.limit));
      await play(uri, 'bytes=0-3');
      expect(ranges, hasLength(3));
    },
  );
  test(
    'legacy desktops stream only the requested range without full-film background downloads',
    () async {
      supportsBlocks = false;
      final uri = await client.media('/p', 'film.mp4');
      expect((await play(uri, 'bytes=2-5')).$2, content(2, 4, 1));
      expect(transferred, 4);
      expect(ranges, ['bytes=2-5']);
    },
  );
  test(
    'cached blocks survive restart and work offline; new uncached blocks fail',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      await play(uri, 'bytes=0-3');
      await client.dispose();
      cache = MediaCache(root: () async => cacheRoot);
      client = BridgeClient(cache: cache);
      expect(await client.restore(), isTrue);
      await computer.close(force: true);
      final offline = await client.media('/p', 'film.mp4');
      expect((await play(offline, 'bytes=2-5')).$2, content(2, 4, 1));
      expect(
        (await play(
          offline,
          'bytes=${MediaRanges.blockSize}-${MediaRanges.blockSize + 3}',
        )).$1,
        502,
      );
    },
  );
  test(
    'metadata authorization failures do not silently serve offline data',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      await play(uri, 'bytes=0-3');
      denied = true;
      await expectLater(client.media('/p', 'film.mp4'), throwsA(anything));
    },
  );
  test('explicit export still downloads a complete file', () async {
    size = 4096;
    cache.limit = 100;
    final file = await client.download('/p', 'film.mp4');
    expect(await file.readAsBytes(), content(0, size, 1));
    expect(ranges, ['whole']);
    expect(await cache.size(), 0);
  });
  test(
    'cancelled open-ended playback stops within bounded read-ahead',
    () async {
      size = 20 * 1024 * 1024 * 1024;
      chunkDelay = const Duration(milliseconds: 2);
      final uri = await client.media('/p', 'film.mp4');
      final player = HttpClient();
      final req = await player.getUrl(uri);
      req.headers.set('range', 'bytes=0-');
      final response = await req.close();
      await response.first;
      player.close(force: true);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      final stopped = transferred;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(transferred, stopped);
      expect(transferred, lessThanOrEqualTo(3 * MediaRanges.blockSize));
      expect(active, 0);
    },
  );
  test(
    'truncated blocks are discarded and a later request retries them',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      truncated = true;
      expect((await play(uri, 'bytes=0-3')).$1, 502);
      truncated = false;
      expect((await play(uri, 'bytes=0-3')).$2, content(0, 4, 1));
      expect(ranges, hasLength(2));
    },
  );
  test(
    'clearing during a remote read prevents that block from repopulating the cache',
    () async {
      final uri = await client.media('/p', 'film.mp4');
      blockStarted = Completer<void>();
      releaseBlock = Completer<void>();
      final playing = play(uri, 'bytes=0-3');
      await blockStarted!.future;
      await cache.clear();
      releaseBlock!.complete();
      expect((await playing).$2, content(0, 4, 1));
      expect(await cache.size(), 0);
      await play(uri, 'bytes=0-3');
      expect(ranges, hasLength(2));
    },
  );
  test('interrupted exports leave no partial file', () async {
    truncated = true;
    await expectLater(client.download('/p', 'broken.mp4'), throwsA(anything));
    final exports = Directory('${tmp.path}/agentshot-exports');
    expect(
      await exports.list().where((f) => f.path.contains('broken.mp4')).toList(),
      isEmpty,
    );
  });
  test('slow duplicate readers have a bounded admission queue', () async {
    final uri = await client.media('/p', 'film.mp4');
    blockStarted = Completer<void>();
    releaseBlock = Completer<void>();
    final players = List.generate(40, (_) => HttpClient());
    final replies = players.map((p) async {
      final req = await p.getUrl(uri);
      req.headers.set('range', 'bytes=0-3');
      final response = await req.close();
      await response.drain<void>();
      return response.statusCode;
    }).toList();
    await blockStarted!.future;
    // The overload response must arrive while the admitted readers are still blocked.
    expect(await Future.any(replies).timeout(const Duration(seconds: 3)), 503);
    releaseBlock!.complete();
    final statuses = await Future.wait(replies);
    expect(statuses.where((s) => s == 206).length, lessThanOrEqualTo(16));
    expect(ranges, hasLength(1));
    for (final p in players) {
      p.close(force: true);
    }
  });
}
