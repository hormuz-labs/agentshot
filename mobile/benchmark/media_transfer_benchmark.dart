// Run through scripts/bench-mobile-media.mjs, which supplies a real, shaped desktop media server.
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/media_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  // This is a Flutter test outside test/ so normal unit runs do not run the benchmark.
  // ignore: invalid_use_of_visible_for_testing_member
  FlutterSecureStorage.setMockInitialValues({});
  test('large-video transfer benchmark', () async {
    const address = String.fromEnvironment('BENCH_URL');
    const fingerprint = String.fromEnvironment('BENCH_FINGERPRINT');
    expect(address, isNotEmpty, reason: 'Run scripts/bench-mobile-media.mjs');
    final base = Uri.parse(address);
    final control =
        HttpClient(context: SecurityContext(withTrustedRoots: false))
          ..badCertificateCallback = (cert, _, _) =>
              sha256.convert(cert.der).toString() == fingerprint;
    Future<Map<String, dynamic>> api(
      String route, [
      Map<String, dynamic>? body,
    ]) async {
      final req = await control.openUrl(
        body == null ? 'GET' : 'POST',
        base.replace(path: route),
      );
      if (body != null) req.write(jsonEncode(body));
      final res = await req.close();
      expect(res.statusCode, 200);
      return jsonDecode(await utf8.decoder.bind(res).join())
          as Map<String, dynamic>;
    }

    final results = <Map<String, dynamic>>[];
    final root = await Directory.systemTemp.createTemp('phone-media-bench-');
    try {
      for (final profile in [
        {'name': 'lan', 'latencyMs': 5, 'mbps': 100},
        {'name': 'wan', 'latencyMs': 80, 'mbps': 10},
      ]) {
        for (var repeat = 1; repeat <= 3; repeat++) {
          final cache = MediaCache(
            root: () async =>
                Directory('${root.path}/${profile['name']}-$repeat'),
          );
          final client = BridgeClient(cache: cache);
          final player = HttpClient();
          await client.connectDirect(
            Connection(base, fingerprint, 'benchmark'),
          );
          Future<void> read(Uri uri, String range) async {
            final req = await player.getUrl(uri);
            req.headers.set('range', range);
            final response = await req.close();
            expect(response.statusCode, 206);
            await response.drain<void>();
          }

          Future<void> measure(
            String scenario,
            Future<void> Function() run,
          ) async {
            await api('/bench/reset', profile);
            final watch = Stopwatch()..start();
            await run();
            watch.stop();
            final stats = await api('/bench/stats');
            expect(stats['active'], 0);
            results.add({
              ...profile,
              'repeat': repeat,
              'scenario': scenario,
              'elapsedMs': watch.elapsedMilliseconds,
              ...stats,
              'cacheBytes': await cache.size(),
              'processRssBytes': ProcessInfo.currentRss,
            });
          }

          try {
            late Uri uri;
            await measure('cold-preview', () async {
              uri = await client.media('/p', 'hour-long.mp4');
              await read(uri, 'bytes=0-262143');
              await read(uri, 'bytes=-65536');
            });
            await measure('warm-preview', () async {
              await read(uri, 'bytes=0-262143');
              await read(uri, 'bytes=-65536');
            });
            await measure('three-seeks', () async {
              for (final offset in [
                3,
                9,
                17,
              ].map((gib) => gib * 1024 * 1024 * 1024)) {
                await read(uri, 'bytes=$offset-${offset + 131071}');
              }
            });
            await api('/bench/revise', {});
            await measure('changed-revision', () async {
              uri = await client.media('/p', 'hour-long.mp4');
              await read(uri, 'bytes=0-262143');
            });
            await measure('cancel-open-ended', () async {
              final cancelling = HttpClient();
              final req = await cancelling.getUrl(uri);
              req.headers.set('range', 'bytes=1073741824-');
              final res = await req.close();
              await res.first;
              cancelling.close(force: true);
              // Wait for the production relay's in-flight block to stop, then sample again for a tail fetch.
              await Future<void>.delayed(const Duration(seconds: 2));
              final first = await api('/bench/stats');
              await Future<void>.delayed(const Duration(milliseconds: 250));
              expect((await api('/bench/stats'))['bytes'], first['bytes']);
              expect(first['bytes'] as int, lessThanOrEqualTo(3 * 1024 * 1024));
            });
          } finally {
            player.close(force: true);
            await client.dispose();
          }
        }
      }
      final output = File(const String.fromEnvironment('BENCH_OUTPUT'));
      await output.parent.create(recursive: true);
      await output.writeAsString(
        const JsonEncoder.withIndent('  ').convert({
          'sourceBytes': 20 * 1024 * 1024 * 1024,
          'blockBytes': 1024 * 1024,
          'runtime': Platform.version,
          'os': Platform.operatingSystem,
          'results': results,
        }),
      );
      // ignore: avoid_print
      print('Benchmark results: ${output.path}');
    } finally {
      control.close(force: true);
      await root.delete(recursive: true);
    }
  }, timeout: const Timeout(Duration(minutes: 5)));
}
