import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:manul_mobile/bridge/account.dart';
import 'package:manul_mobile/bridge/client.dart';
import 'package:manul_mobile/bridge/store.dart';
import 'package:manul_mobile/bridge/tunnel.dart';

class FixtureAccount extends MobileAccount {
  final Map fixture;
  final HttpClient http;
  FixtureAccount(this.fixture, this.http) : super(const FlutterSecureStorage());
  @override
  String get deviceId => 'a' * 32;
  @override
  Future<String> token() async => 'test-account';
  @override
  Future<List<Json>> desktops() async {
    final req = await http.getUrl(
      Uri.parse(fixture['url'] as String).replace(path: '/v1/desktops'),
    );
    req.headers.set('authorization', 'Bearer test-account');
    return objects(
      jsonDecode(await utf8.decoder.bind(await req.close()).join()),
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'Flutter tunnels TLS, account auth, RPC and multi-frame media; rejects a wrong pin',
    () async {
      // This integration test deliberately uses real sockets, not widget HTTP mocks.
      final overrides = HttpOverrides.current;
      HttpOverrides.global = null;
      addTearDown(() => HttpOverrides.global = overrides);
      final build = await Process.run('npx', [
        'esbuild',
        'test/fixtures/mobile-relay.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--packages=external',
        '--outfile=mobile_app/build/relay-fixture.mjs',
      ], workingDirectory: '..');
      expect(build.exitCode, 0, reason: '${build.stderr}');
      final process = await Process.start('node', ['build/relay-fixture.mjs']);
      final errors = StringBuffer();
      process.stderr.transform(utf8.decoder).listen(errors.write);
      addTearDown(() async {
        process.kill();
        await process.exitCode;
      });
      final line = await process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 20));
      final fixture = jsonDecode(line) as Map;
      final context = SecurityContext(withTrustedRoots: false)
        ..setTrustedCertificatesBytes(utf8.encode(fixture['cert'] as String));
      final outer = HttpClient(context: context);
      addTearDown(() => outer.close(force: true));
      final tunnel = RelayTunnel(
        Uri.parse(fixture['url'] as String),
        fixture['desktop'] as String,
        () async => 'test-account',
        webSocketClient: outer,
      );
      await tunnel.start();
      addTearDown(tunnel.close);
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 10)
        ..connectionFactory = (_, _, _) =>
            tunnel.secureConnection(fixture['fingerprint'] as String);
      addTearDown(() => client.close(force: true));
      Future<HttpClientResponse> request(
        String path,
        String token, [
        Object? body,
      ]) async {
        final req = await client.openUrl(
          body == null ? 'GET' : 'POST',
          Uri.parse('https://desktop.manul.invalid$path'),
        );
        req.headers.set('authorization', 'Bearer $token');
        if (body != null) {
          req.headers.contentType = ContentType.json;
          req.write(jsonEncode(body));
        }
        return req.close();
      }

      final pair = await request('/account/pair', 'test-account', {
        'id': 'e' * 32,
        'name': 'Flutter test',
      });
      expect(pair.statusCode, 200);
      final token =
          (jsonDecode(await utf8.decoder.bind(pair).join()) as Map)['token']
              as String;
      final rpc = await request('/rpc', token, {
        'method': 'project:recent',
        'args': [],
      });
      expect(jsonDecode(await utf8.decoder.bind(rpc).join()), {
        'method': 'project:recent',
        'args': [],
      });
      final media = await request(
        '/gallery?url=manul%3A%2F%2Fgallery%2Ftest',
        token,
      );
      var bytes = 0;
      await for (final chunk in media) {
        expect(chunk.every((b) => b == 42), isTrue);
        bytes += chunk.length;
      }
      expect(bytes, 2 * 1024 * 1024);
      // A brand-new desktop has no agent snapshots yet. Headers must arrive
      // immediately, not wait for the first 15-second heartbeat.
      final live = await request(
        '/events',
        token,
      ).timeout(const Duration(seconds: 2));
      expect(live.statusCode, 200);
      final lines = StreamIterator(
        live.transform(utf8.decoder).transform(const LineSplitter()),
      );
      addTearDown(lines.cancel);
      expect(
        await lines.moveNext().timeout(const Duration(seconds: 2)),
        isTrue,
      );
      expect(lines.current, ': connected');
      FlutterSecureStorage.setMockInitialValues({});
      final bridgeClient = BridgeClient(
        account: FixtureAccount(fixture, outer),
        relay: Uri.parse(fixture['url'] as String),
        relayClient: outer,
      );
      final store = BridgeStore(bridgeClient);
      addTearDown(bridgeClient.dispose);
      addTearDown(store.dispose);
      await bridgeClient.connectDesktop(fixture['desktop'] as String);
      // Historical messages must load via project attachment even before SSE.
      await store.open('/test-project');
      expect(
        store.agent('/test-project').messages.single['content'],
        'Keep the previous opening shot',
      );
      final connected = Completer<void>();
      final reconnected = Completer<void>();
      var connections = 0;
      final subscription = bridgeClient.events.listen((event) {
        if (event['channel'] == 'connection' && event['args'][0] == true) {
          connections++;
          if (!connected.isCompleted) {
            connected.complete();
          } else if (!reconnected.isCompleted) {
            reconnected.complete();
          }
        }
      });
      addTearDown(subscription.cancel);
      bridgeClient.listen();
      await connected.future.timeout(const Duration(seconds: 3));
      expect(store.connected, isTrue);
      final wrong = HttpClient()
        ..connectionTimeout = const Duration(seconds: 10)
        ..connectionFactory = (_, _, _) => tunnel.secureConnection('0' * 64);
      addTearDown(() => wrong.close(force: true));
      await expectLater(
        wrong.getUrl(Uri.parse('https://desktop.manul.invalid/rpc')),
        throwsA(isA<HandshakeException>()),
      );
      // Desktop restart rotates its certificate and token. Rediscover, pin the
      // new certificate, reconnect SSE, and preserve the selected project's history.
      process.stdin.writeln('restart');
      await reconnected.future.timeout(const Duration(seconds: 12));
      expect(connections, 2);
      expect(store.connected, isTrue);
      expect(
        store.agent('/test-project').messages.single['content'],
        'Keep the previous opening shot',
      );
    },
    timeout: const Timeout(Duration(seconds: 60)),
  );
}
