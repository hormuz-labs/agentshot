// Pairing with the desktop, from a phone that has never paired: the other ways to connect (scanning, typing or
// pasting a code), then a wrong code refused with a clear message and the right one connecting, the desktop's
// projects appearing.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  // first, from a phone that never paired: pairing by link, as the camera app would open it
  testWidgets('pairs with the desktop and lists its projects', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await launch(tester);
    expect(find.text('Continue with Google'), findsOneWidget);

    final wrong = codeOf(pairLink) == '000000' ? '111111' : '000000';
    await enterCode(tester, withCode(pairLink, wrong));
    await waitFor(tester, find.textContaining('Invalid or expired code'));
    expect(find.text('What are we making?'), findsNothing);

    await enterCode(tester, pairLink);
    await waitFor(
      tester,
      find.text('What are we making?'),
      timeout: const Duration(minutes: 1),
    );
    await reveal(tester, find.text('On your computer'));
    await reveal(tester, find.text(project));

    // The connection survives a restart: the app comes back paired, not on the pair screen.
    await launch(tester);
    await reveal(tester, find.text('On your computer'));
    expect(find.text('Continue with Google'), findsNothing);
  });

  // then, unpaired again: the other ways to connect
  testWidgets('offers the other ways to connect', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await launch(tester);
    expect(find.text('Continue with Google'), findsOneWidget);

    // the other ways fold away again
    await showCodes(tester);
    await press(tester, find.text('Other ways to connect'));
    expect(find.text('Paste code'), findsNothing);
    await showCodes(tester);

    await showCodes(tester);
    // a wrong code typed into the boxes is turned away: as a wrong code where the computer is found on the Wi-Fi;
    // an emulator can't look there
    final wrong = codeOf(pairLink) == '000000' ? '111111' : '000000';
    for (var i = 0; i < 6; i++) {
      final box = find.byKey(ValueKey('otp-$i'));
      await reveal(tester, box);
      await tester.enterText(box, wrong[i]);
      await tester.pump(const Duration(milliseconds: 100));
    }
    await waitFor(
      tester,
      find.textContaining(
        RegExp('Invalid or expired code|Could not find your computer'),
      ),
      timeout: const Duration(minutes: 1),
    );

    // a wrong code pasted: refused too (where the emulator lets the app read the clipboard; a CI one may not)
    await Clipboard.setData(ClipboardData(text: withCode(pairLink, wrong)));
    await showCodes(tester);
    await press(tester, find.text('Paste code'));
    await settle(tester, const Duration(seconds: 3));
    expect(find.text('What are we making?'), findsNothing);
    // Scan QR code opens the camera (allowed by the runner), and back. Last in the file: a slow emulator may
    // rebuild the app's screen behind the camera, after which it no longer hears pairing links.
    await showCodes(tester);
    cue('camera');
    await settle(tester, const Duration(seconds: 2));
    await press(tester, find.byKey(const ValueKey('scan')));
    await waitFor(tester, find.text('Scan to pair'));
    await settle(tester, const Duration(seconds: 2));
    await tester.pageBack();
    await waitFor(tester, find.text('Continue with Google'));
  });
}
