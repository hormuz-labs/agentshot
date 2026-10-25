// Pairing with the desktop: a wrong code is refused with a clear message, the right one connects and the desktop's
// projects appear. Starts from a phone that has never paired.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('pairs with the desktop and lists its projects', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await launch(tester);
    expect(find.text('Continue with Google'), findsOneWidget);

    // the other ways fold away again
    await showCodes(tester);
    await press(tester, find.text('Other ways to connect'));
    expect(find.text('Paste code'), findsNothing);
    await showCodes(tester);

    // Scan QR code opens the camera (allowed by the runner), and back
    cue('camera');
    await settle(tester, const Duration(seconds: 2));
    await press(tester, find.byKey(const ValueKey('scan')));
    await waitFor(tester, find.text('Scan to pair'));
    await settle(tester, const Duration(seconds: 2));
    await tester.pageBack();
    await waitFor(tester, find.text('Paste code'));

    // a wrong code typed into the boxes
    final wrong = codeOf(pairLink) == '000000' ? '111111' : '000000';
    for (var i = 0; i < 6; i++) {
      final box = find.byKey(ValueKey('otp-$i'));
      await reveal(tester, box);
      await tester.enterText(box, wrong[i]);
      await tester.pump(const Duration(milliseconds: 100));
    }
    // turned away: as a wrong code where the computer is found on the Wi-Fi; an emulator can't look there
    await waitFor(
      tester,
      find.textContaining(
        RegExp('Invalid or expired code|Could not find your computer'),
      ),
    );
    expect(find.text('What are we making?'), findsNothing);

    // the right one, pasted (the scanned link as the fallback where the clipboard can't be read)
    await Clipboard.setData(const ClipboardData(text: pairLink));
    await press(tester, find.text('Paste code'));
    await settle(tester, const Duration(seconds: 3));
    if (find.text('What are we making?').evaluate().isEmpty &&
        find.text('Connecting…').evaluate().isEmpty) {
      await enterCode(tester, pairLink);
    }
    await waitFor(tester, find.text('What are we making?'));
    await reveal(tester, find.text('On your computer'));
    await reveal(tester, find.text(project));

    // The connection survives a restart: the app comes back paired, not on the pair screen.
    await launch(tester);
    await reveal(tester, find.text('On your computer'));
    expect(find.text('Continue with Google'), findsNothing);
  });
}
