// Pairing with the desktop: a wrong code is refused with a clear message, the right one connects and the desktop's
// projects appear. Starts from a phone that has never paired.
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('pairs with the desktop and lists its projects', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await launch(tester);
    expect(find.text('Connect to desktop'), findsOneWidget);

    final wrong = code == '000000' ? '111111' : '000000';
    await enterCode(tester, wrong);
    await waitFor(tester, find.textContaining('Invalid or expired code'));
    expect(find.text('What are we making?'), findsNothing);

    await enterCode(tester, code);
    await waitFor(tester, find.text('What are we making?'));
    await reveal(tester, find.text('On your computer'));
    await reveal(tester, find.text(project));

    // The connection survives a restart: the app comes back paired, not on the pair screen.
    await launch(tester);
    await reveal(tester, find.text('On your computer'));
    expect(find.text('Connect to desktop'), findsNothing);
  });
}
