// Out of reach, the phone offers to change computer: that leads back to the connect screen, while still offline.
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('changes computer when this one is out of reach', (tester) async {
    await launchPaired(tester);
    cue('stop');
    try {
      await waitFor(
        tester,
        find.text('Change computer'),
        timeout: const Duration(seconds: 60),
      );
      await press(tester, find.text('Change computer'));
      await waitFor(tester, find.text('Continue with Google'));
    } finally {
      cue('start');
    }
  });
}
