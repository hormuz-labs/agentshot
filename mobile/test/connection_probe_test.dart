import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/mesh.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  late Directory tmp;
  late SecurityContext context;
  late String fingerprint;
  final servers = <HttpServer>[];
  setUpAll(() async {
    tmp = await Directory.systemTemp.createTemp('connection-probe-');
    final made = await Process.run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      '${tmp.path}/key.pem',
      '-out',
      '${tmp.path}/cert.pem',
    ]);
    expect(made.exitCode, 0);
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
    context = SecurityContext()
      ..useCertificateChain('${tmp.path}/cert.pem')
      ..usePrivateKey('${tmp.path}/key.pem');
  });
  tearDown(() async {
    Mesh.proxyPort = null;
    for (final server in servers) {
      await server.close(force: true);
    }
    servers.clear();
  });
  tearDownAll(() => tmp.delete(recursive: true));
  Future<Uri> serve(void Function(HttpRequest) handle) async {
    final server = await HttpServer.bindSecure(
      InternetAddress.loopbackIPv4,
      0,
      context,
    );
    servers.add(server);
    server.listen(handle);
    return Uri.parse('https://127.0.0.1:${server.port}');
  }

  Connection connection(Uri url, {List<Uri>? urls, String? fp}) =>
      Connection(url, fp ?? fingerprint, 'token', urls);

  test(
    'races all addresses: unreachable first address cannot hide a working desktop',
    () async {
      final good = await serve((r) {
        expect(r.headers.value('authorization'), 'Bearer token');
        r.response.write('{}');
        r.response.close();
      });
      final dead = Uri.parse('https://127.0.0.1:1');
      expect(
        await BridgeClient().firstToAnswer(connection(dead, urls: [good])),
        good,
      );
    },
  );

  test('wrong certificate and refused credentials never win', () async {
    final url = await serve((r) {
      r.response.statusCode = 401;
      r.response.close();
    });
    expect(await BridgeClient().firstToAnswer(connection(url)), isNull);
    expect(
      await BridgeClient().firstToAnswer(connection(url, fp: 'a' * 64)),
      isNull,
    );
  });

  test(
    'redirects are not followed as authenticated desktop responses',
    () async {
      var followed = false;
      final good = await serve((r) {
        followed = true;
        r.response.close();
      });
      final redirect = await serve((r) {
        r.response.statusCode = 302;
        r.response.headers.set('location', good.toString());
        r.response.close();
      });
      expect(await BridgeClient().firstToAnswer(connection(redirect)), isNull);
      expect(followed, isFalse);
    },
  );

  test(
    'a stalled response body is bounded by the whole-probe timeout',
    () async {
      final stalled = await serve((r) {
        r.response.write('partial');
        r.response.flush();
      });
      final watch = Stopwatch()..start();
      expect(
        await BridgeClient().firstToAnswer(
          connection(stalled),
          timeout: const Duration(milliseconds: 250),
        ),
        isNull,
      );
      expect(watch.elapsed, lessThan(const Duration(seconds: 2)));
    },
  );

  test(
    'mesh-only addresses are skipped until the proxy is available',
    () async {
      expect(
        await BridgeClient().firstToAnswer(
          connection(Uri.parse('https://100.64.0.3:47821')),
        ),
        isNull,
      );
    },
  );
}
