// Signing in instead of pairing: Continue with Google, the computer signed in to the same account shows up by itself,
// one tap opens it. Then switching computer and signing out. The runner signs the desktop in to stand-in Clerk and
// account services first, so the desktop reports itself the way it does to the real ones.
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

const computer = String.fromEnvironment('E2E_COMPUTER');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'signs in, opens the computer signed in to the same account, switches and signs out',
    (tester) async {
      await const FlutterSecureStorage().deleteAll();
      await launch(tester);
      // the welcome screen leads with signing in; the codes wait under "Other ways to connect"
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('Scan QR code'), findsNothing);

      await tester.tap(find.text('Continue with Google'));
      // ignore: avoid_print
      print('SIGNING_IN');
      await waitFor(
        tester,
        find.text('Your computers'),
        timeout: const Duration(seconds: 90),
      );
      await waitFor(
        tester,
        find.text(computer),
        timeout: const Duration(seconds: 60),
      );
      expect(find.text('Signed in as maya@example.com'), findsOneWidget);

      // Refresh, and pulling the list down, keep it
      await tester.tap(find.byTooltip('Refresh'));
      await waitFor(tester, find.text(computer));
      await tester.fling(find.text(computer), const Offset(0, 400), 1000);
      await settle(tester, const Duration(seconds: 2));
      expect(find.text(computer), findsOneWidget);

      // pairing with a code instead, and back
      await tester.tap(find.byTooltip('Account'));
      await settle(tester);
      await tester.tap(find.text('Pair with a code instead'));
      await waitFor(tester, find.text('Paste code'));
      await press(tester, find.text('Back to your computers'));
      await waitFor(tester, find.text(computer));

      // the computer signs out: the list empties; Check again finds nothing, then it's back once it signs in
      cue('signout');
      final looking = find.text('Looking for your computers…');
      final until = DateTime.now().add(const Duration(minutes: 2));
      while (looking.evaluate().isEmpty) {
        if (DateTime.now().isAfter(until)) fail('the computer never went');
        if (find
            .byWidgetPredicate(
              (w) =>
                  w is IconButton &&
                  w.tooltip == 'Refresh' &&
                  w.onPressed != null,
            )
            .evaluate()
            .isNotEmpty) {
          await tester.tap(find.byTooltip('Refresh'));
        }
        await settle(tester, const Duration(seconds: 2));
      }
      await press(tester, find.byKey(const ValueKey('check-again')));
      await waitFor(tester, find.textContaining('Checked'));
      expect(looking, findsOneWidget);
      cue('signin');
      await waitFor(
        tester,
        find.text(computer),
        timeout: const Duration(minutes: 2),
      );

      await tester.tap(find.text(computer));
      await waitFor(
        tester,
        find.text('What are we making?'),
        timeout: const Duration(seconds: 60),
      );
      await reveal(tester, find.text(project));

      // Settings names the computer, not an address, and offers switching and signing out
      await tester.tap(find.byKey(const ValueKey('nav-Settings')));
      await waitFor(tester, find.text(computer));
      expect(find.textContaining('https://'), findsNothing);
      await reveal(tester, find.text('Signed in as maya@example.com'));
      final switching = find.text('Switch computer');
      await reveal(tester, switching);
      await tester.tap(switching);
      await waitFor(tester, find.text('Your computers'));
      await waitFor(tester, find.text(computer));

      await tester.tap(find.text(computer));
      await waitFor(
        tester,
        find.text('What are we making?'),
        timeout: const Duration(seconds: 60),
      );
      await tester.tap(find.byKey(const ValueKey('nav-Settings')));
      final out = find.text('Sign out');
      await reveal(tester, out);
      await tester.tap(out);
      await waitFor(tester, find.text('Continue with Google'));

      // signed in again, then out from the computers list's menu
      await tester.tap(find.text('Continue with Google'));
      // ignore: avoid_print
      print('SIGNING_IN');
      await waitFor(
        tester,
        find.text(computer),
        timeout: const Duration(seconds: 90),
      );
      await tester.tap(find.byTooltip('Account'));
      await settle(tester);
      await tester.tap(find.text('Sign out').last);
      await waitFor(tester, find.text('Continue with Google'));
    },
  );
}
