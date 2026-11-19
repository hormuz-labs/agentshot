import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/mesh.dart';

Connection target(String host, {String token = 'fresh'}) => Connection(
  Uri.parse('https://$host:47821'),
  'a' * 64,
  token,
  null,
  'home',
  'Home',
);
Computer computer(Connection c) => Computer('home', 'Home', 'linux', c);

class FakeClient extends BridgeClient {
  final List<Connection> probes = [];
  Connection? connected;
  Uri? Function(Connection)? answer;
  @override
  Future<Uri?> firstToAnswer(
    Connection c, {
    Duration timeout = const Duration(seconds: 4),
  }) async {
    probes.add(c);
    return answer?.call(c);
  }

  @override
  Future<void> connectDirect(Connection c) async {
    connected = c;
  }

  @override
  Future<void> rememberMesh(String control) async {}
}

class FakeAccount extends Account {
  Connection? fresh;
  int renewals = 0;
  int joins = 0;
  bool meshUnavailable = false;
  bool meshAuthExpired = false;
  Object? failure;
  @override
  Future<void> joinPrivateNetwork(BridgeClient client) async {
    joins++;
    if (meshAuthExpired) {
      throw BridgeException('Your sign-in has expired. Sign in again.', 401);
    }
    if (meshUnavailable) throw UnsupportedError('Unavailable');
    Mesh.proxyPort = 12345;
  }

  @override
  Future<Connection?> renew(Connection expired) async {
    renewals++;
    if (failure != null) throw failure!;
    return fresh;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  FlutterSecureStorage.setMockInitialValues({});
  const channel = MethodChannel('agentshot/native');
  setUp(() {
    Mesh.proxyPort = null;
  });
  tearDown(() {
    Mesh.proxyPort = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('a bad registration never hides valid computers', () {
    final good = {
      'id': 'home',
      'name': 'Home',
      'urls': ['https://192.168.1.4:47821'],
      'fingerprint': 'a' * 64,
      'token': 'token',
    };
    final found = Account.parseComputers([
      null,
      {},
      {...good, 'urls': []},
      {...good, 'fingerprint': 'invalid'},
      {
        ...good,
        'urls': ['http://unsafe:47821'],
      },
      good,
    ]);
    expect(found.map((c) => c.id), ['home']);
    expect(Account.parseComputers('not a list'), isEmpty);
  });

  test('working LAN does not refresh credentials or start mesh', () async {
    final account = FakeAccount();
    final client = FakeClient()..answer = (c) => c.url;
    await account.connect(client, computer(target('192.168.1.4')));
    expect(client.connected!.url.host, '192.168.1.4');
    expect(account.renewals, 0);
  });

  test('refreshes stale Wi-Fi addresses and expired tokens', () async {
    final account = FakeAccount()..fresh = target('192.168.2.8');
    final client = FakeClient()
      ..answer = (c) => c.token == 'fresh' ? c.url : null;
    await account.connect(
      client,
      computer(target('192.168.1.4', token: 'expired')),
    );
    expect(client.connected!.url.host, '192.168.2.8');
    expect(client.connected!.token, 'fresh');
    expect(account.renewals, 1);
  });

  test(
    'offline computer produces an actionable error after refreshing',
    () async {
      final account = FakeAccount();
      final client = FakeClient();
      await expectLater(
        account.connect(client, computer(target('192.168.1.4'))),
        throwsA(
          isA<BridgeException>().having(
            (e) => e.message,
            'message',
            contains('Could not reach Home'),
          ),
        ),
      );
      expect(account.renewals, 1);
      expect(client.connected, isNull);
    },
  );

  test(
    'account authentication failure is not reported as an offline desktop',
    () async {
      final account = FakeAccount()
        ..failure = BridgeException(
          'Your sign-in has expired. Sign in again.',
          401,
        );
      await expectLater(
        account.connect(FakeClient(), computer(target('192.168.1.4'))),
        throwsA(isA<BridgeException>().having((e) => e.status, 'status', 401)),
      );
    },
  );

  test('mesh ranges cover IPv4 and IPv6 but not unrelated LAN addresses', () {
    for (final host in ['100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) {
      expect(Mesh.isMeshHost(host), isTrue);
    }
    for (final host in ['192.168.1.4', '100.63.0.1', '100.128.0.1']) {
      expect(Mesh.isMeshHost(host), isFalse);
    }
  });

  test('a stale saved proxy does not suppress mesh recovery', () async {
    Mesh.proxyPort = 9999;
    final account = FakeAccount()..fresh = target('100.64.0.3');
    final client = FakeClient()
      ..answer = (c) => Mesh.proxyPort == 12345 ? c.url : null;
    var away = false;
    await account.connect(
      client,
      computer(target('100.64.0.3')),
      away: () => away = true,
    );
    expect(account.joins, 1);
    expect(away, isTrue);
    expect(client.connected!.url.host, '100.64.0.3');
  });

  test('unsupported mesh fails cleanly rather than hanging', () async {
    final account = FakeAccount()..meshUnavailable = true;
    final client = FakeClient();
    await expectLater(
      account.connect(client, computer(target('100.64.0.3'))),
      throwsA(isA<BridgeException>()),
    );
    expect(account.joins, 1);
    expect(client.connected, isNull);
  });

  test(
    'expired sign-in during mesh join remains an authentication error',
    () async {
      final account = FakeAccount()..meshAuthExpired = true;
      await expectLater(
        account.connect(FakeClient(), computer(target('100.64.0.3'))),
        throwsA(isA<BridgeException>().having((e) => e.status, 'status', 401)),
      );
    },
  );
}
