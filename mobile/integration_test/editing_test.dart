// Editing from the phone: a note asks for an edit, the desktop agent cuts the film and proposes it, and the
// conversation says so with a card. The first cut goes back with feedback, right from the card; the second the phone
// watches (the card takes it to the Film tab, whose dot said a cut was waiting), compares before/after and keeps.
import 'package:agentshot_mobile/ui/player.dart';
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
    final dot = find.byKey(const ValueKey('tab-Film-dot'));
    Future<void> askForTheEdit() async {
      await sendNote(tester, 'Mobile e2e: tighten the opening');
      // what the agent is doing shows as a line of words (its tools stay out of the chat), then its reply and the card
      await waitFor(tester, card, timeout: const Duration(minutes: 3));
      expect(find.text('edit_timeline'), findsNothing);
      expect(
        find.descendant(of: card, matching: find.text('Opening tightened')),
        findsOneWidget,
      );
      expect(tester.widget<Badge>(dot).isLabelVisible, isTrue);
      // the agent's steps, one card in words (from the computer, as on the desktop), the commands only under details
      final steps = find.byKey(const ValueKey('steps'));
      // up from the card to this turn's steps (the list builds what's near the screen), the latest of them
      await reveal(tester, steps);
      await Scrollable.ensureVisible(steps.evaluate().last, alignment: .5);
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

    // this one: it plays right there in the conversation, and downloads from there (to the share sheet, which the
    // runner closes); Before / after opens the Film tab on it, then Keep
    await askForTheEdit();
    await press(
      tester,
      find.descendant(
        of: card,
        matching: find.byKey(const ValueKey('cut-play')),
      ),
    );
    // loaded: its controls are there
    await waitFor(
      tester,
      find.descendant(
        of: find.descendant(of: card, matching: find.byType(RemotePlayer)),
        matching: find.byTooltip('Mute'),
      ),
      timeout: const Duration(minutes: 1),
    );
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
    await press(
      tester,
      find.descendant(of: card, matching: find.text('Before / after')),
    );
    await waitFor(tester, find.text('A new cut is ready'));
    expect(tester.widget<Badge>(dot).isLabelVisible, isFalse);
    expect(
      tester
          .widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'After'))
          .selected,
      isTrue,
    );
    await tester.tap(find.widgetWithText(ChoiceChip, 'Before'));
    await settle(tester);
    await tester.tap(find.widgetWithText(ChoiceChip, 'After'));
    await waitFor(tester, find.text('Opening tightened'));
    await tester.tap(find.widgetWithText(FilledButton, 'Keep'));
    await waitFor(tester, find.text('Opening tightened'));
    await settle(tester, const Duration(seconds: 2));
    expect(find.text('A new cut is ready'), findsNothing);
    expect(card, findsNothing);

    // the kept cut is in Versions; choosing it there closes the list
    await projectMenu(tester, 'Versions');
    await waitFor(tester, find.text('Every cut you kept'));
    await tester.tap(find.widgetWithText(ListTile, 'Opening tightened'));
    await waitGone(tester, find.text('Every cut you kept'));
  });
}
