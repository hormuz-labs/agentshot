// Every panel in Settings against the real desktop: the app's appearance; an AI key added and removed; skill
// profiles (a new one, switching back) and turning a skill off and on; something to remember, edited and forgotten
// (Cancel first); desktop tools (Install asks first: Cancel, then yes, and the runner makes that download fail at
// once) and speech recognition; the agent browser (its mode, opening a page, the tab, back/forward/reload/new, closing
// a tab, refreshing); the AgentShot account; and About with its licenses.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

const page = String.fromEnvironment('E2E_DESKTOP_PAGE');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('works every settings panel', (tester) async {
    await launchPaired(tester);
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    await waitFor(tester, find.text('Connected'));

    Future<void> open(String panel, String title) async {
      await press(tester, find.text(panel));
      await waitFor(tester, find.text(title));
      await settle(tester);
    }

    // appearance, one tap each: dark, light, and back to the system's
    Brightness brightness() =>
        Theme.of(tester.element(find.text('Settings').first)).brightness;
    final appearance = find.byKey(const ValueKey('appearance'));
    Future<void> appear(String pick) async {
      await reveal(tester, appearance);
      await tester.tap(
        find.descendant(of: appearance, matching: find.text(pick)),
      );
      await settle(tester);
    }

    Future<void> choose(String now, String pick) async {
      await press(tester, find.text(now).last);
      await tester.tap(find.text(pick).last);
      await settle(tester);
    }

    await appear('Dark');
    expect(brightness(), Brightness.dark);
    await appear('Light');
    expect(brightness(), Brightness.light);
    await appear('System');

    // AI: what the computer uses now in a line (here its own provider, the scripted model), then an own key added
    // (Added) and in the line, and removed again (asking first)
    final ai = find.byKey(const ValueKey('settings-ai'));
    await reveal(tester, ai);
    await waitFor(
      tester,
      find.descendant(of: ai, matching: find.text('Your Scripted')),
    );
    await open('AI models', 'Your own keys');
    await reveal(tester, find.text('Your providers'));
    expect(find.byKey(const ValueKey('ai-credits')), findsOneWidget);
    final tile = find.byKey(const ValueKey('key-OPENAI_API_KEY'));
    await reveal(tester, tile);
    expect(
      find.descendant(of: tile, matching: find.text('Add')),
      findsOneWidget,
    );
    await tester.tap(tile);
    await answer(tester, 'e2e-not-a-real-key');
    await waitFor(
      tester,
      find.descendant(of: tile, matching: find.text('Added')),
    );
    await tester.tap(tile);
    await waitFor(tester, find.text('Remove the OpenAI key?'));
    await tester.tap(find.text('Remove'));
    await waitFor(
      tester,
      find.descendant(of: tile, matching: find.text('Add')),
    );
    await closeSheet(tester);
    await waitFor(
      tester,
      find.descendant(of: ai, matching: find.text('Your Scripted')),
    );

    // skills: a new profile, back to the first; a skill off and on again
    await open('Skills & profiles', 'Profile');
    final first = tester
        .widget<DropdownButtonFormField<String>>(
          find.byType(DropdownButtonFormField<String>).last,
        )
        .initialValue!;
    await press(tester, find.text('New profile'));
    await answer(tester, 'Mobile e2e profile');
    await settle(tester, const Duration(seconds: 1));
    await press(tester, find.byType(DropdownButtonFormField<String>).last);
    await waitFor(tester, find.text('Mobile e2e profile'));
    final names = tester
        .widgetList<DropdownMenuItem<String>>(
          find.byType(DropdownMenuItem<String>),
        )
        .where((i) => i.value == first);
    await tester.tap(
      find
          .descendant(
            of: find.byWidget(names.last),
            matching: find.byType(Text),
          )
          .first,
    );
    await settle(tester, const Duration(seconds: 1));
    final skill = find.byType(SwitchListTile);
    if (skill.evaluate().isNotEmpty) {
      bool on() => tester.widget<SwitchListTile>(skill.first).value;
      final was = on();
      await press(tester, skill.first);
      await settle(tester, const Duration(seconds: 1));
      expect(on(), !was);
      await press(tester, skill.first);
      await settle(tester, const Duration(seconds: 1));
      expect(on(), was);
    }
    expect(find.byType(SnackBar), findsNothing);
    await closeSheet(tester);

    // memory: remember, edit, forget (Cancel first)
    await open('Memory', 'Remember something');
    await press(tester, find.text('Remember something'));
    await answer(tester, 'Mobile e2e likes short films');
    await answer(tester, 'Keep films under a minute.');
    await waitFor(tester, find.text('Mobile e2e likes short films'));
    await press(tester, find.text('Mobile e2e likes short films'));
    await answer(tester, 'Mobile e2e likes very short films');
    await answer(tester, 'Keep films under thirty seconds.');
    await waitFor(tester, find.text('Mobile e2e likes very short films'));
    final fact = find.widgetWithText(Card, 'Mobile e2e likes very short films');
    await tester.tap(
      find.descendant(of: fact, matching: find.byTooltip('Forget')),
    );
    await waitFor(tester, find.text('Forget this?'));
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(fact, findsOneWidget);
    await tester.tap(
      find.descendant(of: fact, matching: find.byTooltip('Forget')),
    );
    await waitFor(tester, find.text('Forget this?'));
    await tester.tap(find.text('Confirm'));
    await waitGone(tester, fact);
    await closeSheet(tester);

    // desktop tools: Install asks first; yes starts a download (which fails here at once); speech recognition
    await open('Desktop tools', 'Tools on your desktop');
    final install = find.widgetWithText(OutlinedButton, 'Install');
    await waitFor(tester, install);
    await press(tester, install.first);
    await waitFor(tester, find.text('Install tool?'));
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    await press(tester, install.first);
    await waitFor(tester, find.text('Install tool?'));
    await tester.tap(find.text('Confirm'));
    await waitFor(
      tester,
      find.byType(SnackBar),
      timeout: const Duration(minutes: 1),
    ); // the download failed: said so
    ScaffoldMessenger.of(
      tester.element(find.byType(SnackBar).first),
    ).clearSnackBars();
    await press(tester, find.text('Speech recognition'));
    await waitFor(
      tester,
      find.textContaining(
        RegExp('No engine ready|whisper', caseSensitive: false),
      ),
    );
    await closeSheet(tester);

    // the agent browser: its mode, a page opened there, its tab and buttons
    await open('Agent browser', 'Agent browser on your desktop');
    await waitFor(tester, find.text('AgentShot’s own browser'));
    await choose('AgentShot’s own browser', 'Your desktop Chrome');
    await waitFor(tester, find.text('Your desktop Chrome'));
    await choose('Your desktop Chrome', 'AgentShot’s own browser');
    await waitFor(tester, find.text('AgentShot’s own browser'));
    // a new tab, a page in it, then its buttons; closing it leaves one fewer
    final tabs = find.byTooltip('Close tab');
    await tester.tap(find.byTooltip('new'));
    await waitFor(tester, tabs, timeout: const Duration(minutes: 1));
    await press(tester, find.text('Navigate'));
    await answer(tester, page);
    // the page loads on the desktop after the call returns: Refresh browser state shows it
    final opened = DateTime.now().add(const Duration(minutes: 1));
    while (find.textContaining(page).evaluate().isEmpty) {
      if (DateTime.now().isAfter(opened)) fail('$page never showed');
      await press(tester, find.text('Refresh browser state'));
      await settle(tester, const Duration(seconds: 1));
    }
    await press(tester, find.widgetWithText(ListTile, page).first);
    for (final button in ['reload', 'back', 'forward']) {
      await tester.tap(find.byTooltip(button));
      await settle(tester, const Duration(seconds: 1));
      expect(find.byType(SnackBar), findsNothing, reason: button);
    }
    await press(tester, find.text('Refresh browser state'));
    final before = tabs.evaluate().length;
    await tester.tap(tabs.last);
    final end = DateTime.now().add(const Duration(seconds: 30));
    while (tabs.evaluate().length >= before && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(tabs.evaluate().length, lessThan(before));
    await closeSheet(tester);

    // the AgentShot account (the desktop isn't signed in here)
    await open(
      'AgentShot account',
      'Sign in through AgentShot on your desktop.',
    );
    await closeSheet(tester);

    // About, and its licenses
    await press(tester, find.text('About AgentShot'));
    await waitFor(tester, find.text('View licenses'));
    await tester.tap(find.text('View licenses'));
    await waitFor(tester, find.byType(LicensePage));
    await tester.pageBack();
    await settle(tester);
    await tester.tap(find.text('Close'));
    await waitGone(tester, find.text('View licenses'));
  });
}
