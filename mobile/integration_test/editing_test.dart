// Editing from the phone: a note asks for an edit, the desktop agent cuts the film and proposes it, and the phone
// compares before/after and keeps it.
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

    await tester.enterText(
      find.widgetWithText(TextField, 'Your notes'),
      'Mobile e2e: tighten the opening',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    // The agent's steps show up as they happen and the chat follows them down to its reply, without scrolling.
    await waitFor(
      tester,
      find.text('edit_timeline'),
      timeout: const Duration(minutes: 1),
    );
    await waitFor(
      tester,
      find.text('rerender_timeline'),
      timeout: const Duration(minutes: 3),
    );
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 1),
    );

    await tester.tap(find.widgetWithText(ChoiceChip, 'Film'));
    await waitFor(tester, find.text('A new cut is ready'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'After'));
    await waitFor(tester, find.text('Opening tightened'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'Before'));
    await settle(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Keep'));
    await waitFor(tester, find.text('Opening tightened'));
    await settle(tester, const Duration(seconds: 2));
    expect(find.text('A new cut is ready'), findsNothing);

    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Versions').last);
    await waitFor(tester, find.text('Opening tightened'));
  });
}
