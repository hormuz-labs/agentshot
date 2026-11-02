// Editing from the phone: a note asks for an edit, the desktop agent cuts the film and proposes it, and the
// conversation says so with a card. The first cut goes back with feedback, right from the card; the second the phone
// downloads from its card, opens on the film, compares before/after there and keeps.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('asks for an edit, compares the new cut and keeps it', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);
    await newConversation(tester);

    final card = find.byKey(const ValueKey('proposal-card'));
    Future<void> askForTheEdit() async {
      await sendNote(tester, 'Mobile e2e: tighten the opening');
      // what the agent is doing shows as a line of words (its tools stay out of the chat), then its reply and the card
      await waitFor(tester, card, timeout: const Duration(minutes: 3));
      expect(find.text('edit_timeline'), findsNothing);
      expect(
        find.descendant(of: card, matching: find.text('Opening tightened')),
        findsOneWidget,
      );
      // the agent's steps, one card in words (from the computer, as on the desktop), the commands only under details
      final steps = find.byKey(const ValueKey('steps'));
      // up from the card to this turn's steps (the list builds what's near the screen), the latest of them
      await reveal(tester, steps);
      await Scrollable.ensureVisible(steps.evaluate().last, alignment: .5);
      await settle(tester);
      // folded to one line once done: a tap opens it
      await tester.tap(
        find.descendant(
          of: steps.last,
          matching: find.byKey(const ValueKey('steps-summary')),
        ),
      );
      await settle(tester);
      expect(
        find.descendant(of: steps.last, matching: find.textContaining('Edited the cut')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: steps.last, matching: find.text('Rendered the film')),
        findsOneWidget,
      );
      expect(find.text('edit_timeline'), findsNothing);
    }

    // not this one: back it goes, with a word for the agent, and the card goes
    await askForTheEdit();
    await press(
      tester,
      find.descendant(of: card, matching: find.text('Send back')),
    );
    await answer(tester, 'Mobile e2e: keep the pause before the title');
    await waitGone(tester, card);
    await waitFor(
      tester,
      find.text('Mobile e2e: keep the pause before the title'),
    );
    await agentDone(tester, timeout: const Duration(minutes: 1));

    // this one: it downloads from its card (to the share sheet, which the runner closes), and the card opens it on
    // the film, with Before and After right there, then Keep
    await askForTheEdit();
    await press(
      tester,
      find.descendant(of: card, matching: find.byTooltip('Download')),
    );
    cue('back');
    await waitFor(
      tester,
      find.descendant(of: card, matching: find.byTooltip('Download')),
      timeout: const Duration(minutes: 2),
    );
    await settle(tester, const Duration(seconds: 2));
    await press(
      tester,
      find.descendant(
        of: card,
        matching: find.byKey(const ValueKey('cut-play')),
      ),
    );
    await waitGone(tester, composer);
    final choice = find.byKey(const ValueKey('editor-before-after'));
    await waitFor(tester, choice);
    await waitFor(tester, filmPicture, timeout: const Duration(minutes: 1));
    bool showingAfter() =>
        tester.widget<SegmentedButton<bool>>(choice).selected.single;
    expect(showingAfter(), isTrue);
    await tester.tap(find.text('Before'));
    await settle(tester);
    expect(showingAfter(), isFalse);
    await tester.tap(find.text('After'));
    await settle(tester);
    expect(showingAfter(), isTrue);
    await tester.tap(find.byKey(const ValueKey('editor-keep')));
    await waitGone(tester, choice);
    await openConversation(tester);
    await waitFor(tester, find.text('Opening tightened'));
    await settle(tester, const Duration(seconds: 2));
    expect(find.text('New cut'), findsNothing);
    expect(card, findsNothing);

    // the kept cut is in Versions; choosing it there closes the list
    await projectMenu(tester, 'Versions');
    await waitFor(tester, find.text('Every cut you kept'));
    await tester.tap(find.widgetWithText(ListTile, 'Opening tightened'));
    await waitGone(tester, find.text('Every cut you kept'));
  });
}
