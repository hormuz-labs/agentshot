// Paired with a computer on a Wi-Fi the phone has since left: the account knows that computer by its certificate, and
// reaches it the way the account knows (its private-network address too). Never another computer, and nothing when
// the phone isn't signed in.
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:agentshot_mobile/bridge/client.dart';

class Mine extends Account {
  Mine({this.signed = true}) : super(browser: (_) async => '') {
    if (signed) {
      email = 'maya@example.com';
      key = 'sk-maya';
    }
  }
  final bool signed;
  final opened = <Computer>[];
  @override
  Future<List<Computer>> computers() async => [
    Computer(
      'm1',
      'Studio iMac',
      'darwin',
      Connection(Uri.parse('https://100.64.0.2:47821'), 'a' * 64, 'day-token'),
    ),
    Computer(
      'm2',
      'Office PC',
      'win32',
      Connection(Uri.parse('https://100.64.0.3:47821'), 'b' * 64, 'day-token'),
    ),
  ];
  @override
  Future<void> connect(
    BridgeClient client,
    Computer computer, {
    void Function()? away,
    void Function()? opening,
  }) async {
    opened.add(computer);
  }
}

void main() {
  final pairedOnWifi = Connection(
    Uri.parse('https://192.168.8.10:47821'),
    'a' * 64,
    'paired-token',
  );

  test(
    'the paired computer, found in the account by its certificate, opened the account\'s way',
    () async {
      final account = Mine();
      expect(await account.reach(BridgeClient(), pairedOnWifi), isTrue);
      expect(account.opened.single.name, 'Studio iMac');
    },
  );

  test('not this account\'s computer, or not signed in: nothing', () async {
    final account = Mine();
    final elsewhere = Connection(
      Uri.parse('https://192.168.8.20:47821'),
      'c' * 64,
      't',
    );
    expect(await account.reach(BridgeClient(), elsewhere), isFalse);
    expect(account.opened, isEmpty);
    expect(
      await Mine(signed: false).reach(BridgeClient(), pairedOnWifi),
      isFalse,
    );
  });
}
