// Pairing from a phone signed in to AgentShot with a computer that isn't: once, "sign it in as you?", so it's
// reachable from anywhere and listed under Your computers. Never done quietly, and never asked of a signed-in computer.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/pair.dart';

class Computer extends BridgeClient {
  Computer({this.email});
  final String? email;
  final asked = <List<dynamic>>[];
  @override
  Connection? get connection => Connection(
    Uri.parse('https://x:1'),
    'a' * 64,
    't',
    [],
    null,
    'Studio iMac',
  );
  @override
  Future<void> pair(String code, {String? host}) async {}
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    asked.add([method, ...args]);
    return method == 'account:status' ? {'email': email} : null;
  }
}

class Signed extends Account {
  Signed() : super(browser: (_) async => '') {
    email = 'maya@example.com';
    key = 'sk-maya';
  }
}

void main() {
  // the pairing screen keeps something moving (a spinner, the mascot): frames, not "settled"
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<bool> paired(
    WidgetTester tester,
    Computer computer, {
    Account? account,
  }) async {
    var done = false;
    await tester.pumpWidget(
      MaterialApp(
        home: PairScreen(
          // a pairing of its own each time
          key: UniqueKey(),
          client: computer,
          account: account,
          link: 'agentshot://pair?d=x',
          onPaired: () => done = true,
          onSignIn: () async {},
        ),
      ),
    );
    await settle(tester);
    return done;
  }

  testWidgets(
    'a computer that isn\'t signed in is offered the phone\'s account, and gets it on Sign in',
    (tester) async {
      final computer = Computer();
      expect(await paired(tester, computer, account: Signed()), isFalse);
      expect(
        find.text('Sign Studio iMac in as maya@example.com?'),
        findsOneWidget,
      );
      await tester.tap(find.text('Sign in').last);
      await settle(tester);
      expect(computer.asked.last, [
        'account:adopt',
        {'key': 'sk-maya', 'email': 'maya@example.com'},
      ]);
    },
  );

  testWidgets('declined: paired all the same, and nothing handed over', (
    tester,
  ) async {
    final computer = Computer();
    await paired(tester, computer, account: Signed());
    await tester.tap(find.text('Cancel').last);
    await settle(tester);
    expect(
      computer.asked.map((a) => a.first),
      isNot(contains('account:adopt')),
    );
  });

  testWidgets(
    'a computer already signed in, or a phone that isn\'t: no question',
    (tester) async {
      expect(
        await paired(
          tester,
          Computer(email: 'someone@example.com'),
          account: Signed(),
        ),
        isTrue,
      );
      expect(await paired(tester, Computer()), isTrue);
      expect(find.textContaining('Sign Studio iMac in'), findsNothing);
    },
  );
}
