import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/relay.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  late Directory tmp;
  late String fingerprint;
  late RelayRoute route;
  late Process fixture;
  // A deliberately unresolvable private hostname: no direct connection can win.
  final target = Uri.parse('https://private-desktop.invalid:47821');
  setUpAll(() async {
    // Workspace-local: also works in CI/sandboxes without writable system temp.
    tmp = await Directory('../out').createTemp('relay-phone-');
    final certificate = await Process.run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-keyout', '${tmp.path}/key.pem',
      '-out', '${tmp.path}/cert.pem',
    ]);
    expect(certificate.exitCode, 0);
    final pem = await File('${tmp.path}/cert.pem').readAsString();
    fingerprint = sha256.convert(base64.decode(pem.split('\n')
        .where((l) => l.isNotEmpty && !l.startsWith('-----')).join())).toString();
    final bundle = await Process.run('../node_modules/.bin/esbuild', [
      '../test/fixtures/relay-phone.mjs', '--bundle', '--platform=node',
      '--format=esm', '--external:ws', '--external:proxy-agent', '--external:proxy-from-env', '--outfile=../out/relay-phone-fixture.mjs',
    ]);
    expect(bundle.exitCode, 0, reason: '${bundle.stderr}');
    fixture = await Process.start('node', [
      '../out/relay-phone-fixture.mjs', '${tmp.path}/key.pem', '${tmp.path}/cert.pem',
    ], environment: {'NODE_ENV': 'test'});
    fixture.stderr.transform(utf8.decoder).listen((text) => stderr.write(text));
    final raw = jsonDecode(await fixture.stdout.transform(utf8.decoder)
        .transform(const LineSplitter()).first.timeout(const Duration(seconds: 10)));
    route = RelayRoute(Uri.parse(raw['url']), raw['ticket'], raw['expiresAt']);
  });
  tearDown(() => RelayProxy.stop());
  tearDownAll(() async {
    await fixture.stdin.close();
    await fixture.exitCode.timeout(const Duration(seconds: 5), onTimeout: () {
      fixture.kill();
      return -1;
    });
    await tmp.delete(recursive: true);
  });

  Connection connection({String? fp, String token = 'desktop-token'}) =>
      Connection(target, fp ?? fingerprint, token, null, 'home', 'Desktop', route);

  test('real pinned TLS traverses outbound relay to private desktop', () async {
    await RelayProxy.start(route, target);
    expect(await BridgeClient().firstToAnswer(connection()), target);
  });
  test('relay cannot bypass certificate pinning or bridge authorization', () async {
    await RelayProxy.start(route, target);
    expect(await BridgeClient().firstToAnswer(connection(fp: 'a' * 64)), isNull);
    expect(await BridgeClient().firstToAnswer(connection(token: 'wrong')), isNull);
  });
  test('route survives serialization and accepts no insecure account URLs', () {
    final secure = RelayRoute(Uri.parse('wss://relay.example'), 'ticket', route.expiresAt);
    final restored = Connection.fromJson(connection().toJson()..['relay'] = secure.toJson());
    expect(restored.relay!.ticket, 'ticket');
    expect(() => RelayRoute.fromJson(route.toJson()), throwsFormatException);
  });
  test('stopping and reopening proxy recovers without stale sockets', () async {
    await RelayProxy.start(route, target);
    expect(await BridgeClient().firstToAnswer(connection()), target);
    await RelayProxy.stop();
    expect(RelayProxy.port, isNull);
    await RelayProxy.start(route, target);
    expect(await BridgeClient().firstToAnswer(connection()), target);
  });
}
