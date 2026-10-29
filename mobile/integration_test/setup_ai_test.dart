// A computer with no AI set up yet: sending a note offers to set it up instead of failing. "Use my own AI key"
// opens the keys; "Use AgentShot credits" signs in on the phone and hands the account to the computer, then sends.
// The runner takes the desktop's AI key away first and checks afterwards that the desktop is signed in.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('offers AgentShot credits or an own key when the computer has no AI', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);

    Future<void> note(String text) async {
      await tester.enterText(find.byKey(const ValueKey('composer')), text);
      await tester.pump(); // Send turns on once there is text
      await tester.tap(find.byTooltip('Send'));
      await waitFor(tester, find.text('Set up AI on your computer'));
      await settle(tester); // the sheet slides up
    }

    await note('Mobile e2e: no AI yet');
    expect(find.text('Use AgentShot credits'), findsOneWidget);
    await tester.tap(find.text('Use my own AI key'));
    await waitFor(tester, find.text('Your own keys'));
    await tester.tap(find.byTooltip('Close').last);
    // no key added: the note couldn't go, and a card above the composer says so and what would make it
    final problem = find.byKey(const ValueKey('problem'));
    await waitFor(
      tester,
      find.descendant(
        of: problem,
        matching: find.text(
          'Add an AI key or use AgentShot credits to send notes.',
        ),
      ),
    );
    expect(
      find.descendant(
        of: problem,
        matching: find.text('Your note didn’t send'),
      ),
      findsOneWidget,
    );
    await tester.tap(
      find.descendant(of: problem, matching: find.byTooltip('Dismiss')),
    );
    await settle(tester);
    expect(problem, findsNothing);

    // closing the question without a choice: the note can't go, and the card says what would make it
    await note('Mobile e2e: undecided');
    await closeSheet(tester);
    await waitFor(
      tester,
      find.descendant(
        of: problem,
        matching: find.textContaining('Choose AgentShot credits or an AI key'),
      ),
    );
    await tester.tap(
      find.descendant(of: problem, matching: find.byTooltip('Dismiss')),
    );
    await settle(tester);

    // an own key, added from the question: the note goes
    Finder keyTile() => find.byWidgetPredicate(
      (w) =>
          w is ListTile &&
          w.title is Text &&
          (w.title as Text).data == 'OpenAI',
    );
    await note('Mobile e2e: with my own key');
    await tester.tap(find.text('Use my own AI key'));
    await waitFor(tester, keyTile());
    await tester.tap(keyTile());
    await answer(tester, 'sk-e2e-not-a-real-key');
    await waitFor(
      tester,
      find.descendant(of: keyTile(), matching: find.text('Added')),
    );
    await closeSheet(tester);
    // with a key on the computer the note goes (what that model answers isn't the point here)
    await waitFor(tester, find.text('Mobile e2e: with my own key'));
    await agentDone(tester, timeout: const Duration(minutes: 1));

    // and removed again, in Settings → AI models, which says what the computer uses now
    await tester.pageBack();
    await waitFor(tester, find.byKey(const ValueKey('nav-Settings')));
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    final ai = find.byKey(const ValueKey('settings-ai'));
    await reveal(tester, ai);
    await waitFor(
      tester,
      find.descendant(of: ai, matching: find.text('Your OpenAI key')),
    );
    await press(tester, find.byKey(const ValueKey('settings-ai')));
    await waitFor(tester, keyTile());
    await tester.tap(keyTile());
    await waitFor(tester, find.text('Remove the OpenAI key?'));
    await tester.tap(find.text('Remove'));
    await waitFor(
      tester,
      find.descendant(of: keyTile(), matching: find.text('Add')),
    );
    await closeSheet(tester);
    await tester.tap(find.byKey(const ValueKey('nav-Projects')));
    await openProject(tester);

    await note('Mobile e2e: with credits');
    await tester.tap(find.text('Use AgentShot credits'));
    // ignore: avoid_print
    print('SIGNING_IN');
    await waitFor(
      tester,
      find.text('Your computer now uses your AgentShot credits.'),
      timeout: const Duration(seconds: 90),
    );
    await waitFor(tester, find.text('Mobile e2e: with credits'));
  });
}
