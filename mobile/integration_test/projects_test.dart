// The desktop's projects on the phone: search, open one, see its film and its files.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('searches, opens a project and shows its film and files', (
    tester,
  ) async {
    await launchPaired(tester);

    // search is behind its icon
    await press(tester, find.byTooltip('Search projects'));
    await tester.enterText(
      find.byKey(const ValueKey('search-projects')),
      'no such project',
    );
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.text(project), findsNothing);
    await reveal(tester, find.text('No matches'));
    await tester.enterText(
      find.byKey(const ValueKey('search-projects')),
      project.substring(0, 3),
    );
    await reveal(tester, find.text(project));

    await openProject(tester);
    expect(find.widgetWithText(AppBar, project), findsOneWidget);

    // the film, above the conversation
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );

    await openFiles(tester);
    await waitFor(tester, find.text('Files'));
    await waitFor(tester, find.textContaining('.mp4'));

    await tester.pageBack();
    await waitFor(tester, home);
  });

  testWidgets('refreshes, and moves a project to the Trash after asking', (
    tester,
  ) async {
    await launchPaired(tester);
    const throwaway = 'Mobile e2e throwaway';

    // pulling the list down refreshes it
    await waitFor(tester, home);
    await pullToRefresh(tester);
    await settle(tester, const Duration(seconds: 2));
    expect(find.byType(SnackBar), findsNothing);

    // the + in the bar offers the ways to start; changing one's mind leaves things as they were
    await tester.tap(find.byTooltip('Start something new'));
    await waitFor(tester, find.text('Create'));
    final sheet = find.byKey(const ValueKey('start-sheet'));
    for (final option in [
      'Import',
      'Record',
      'Describe it',
      'Walkthrough',
    ]) {
      expect(
        find.descendant(of: sheet, matching: find.text(option)),
        findsOneWidget,
      );
    }
    await tester.tap(
      find.descendant(of: sheet, matching: find.text('Describe it')),
    );
    await describe(tester, null);
    expect(sheet, findsNothing);

    // a project to throw away: an idea, in 16:9
    await start(tester, 'Describe it');
    await describe(tester, throwaway, format: '16:9');
    await waitFor(
      tester,
      find.widgetWithText(AppBar, throwaway),
      timeout: const Duration(minutes: 2),
    );
    await tester.pageBack();
    await waitGone(tester, find.widgetWithText(AppBar, throwaway));
    await settle(tester);

    // Move to Trash (held: the project's actions) asks first: Cancel keeps it, Move to Trash removes it
    final row = find.text(throwaway);
    Future<void> trash() async {
      // nothing in front of the card (a message from creating the project)
      if (find.byType(SnackBar).evaluate().isNotEmpty) {
        ScaffoldMessenger.of(
          tester.element(find.byType(SnackBar).first),
        ).clearSnackBars();
        await settle(tester);
      }
      await reveal(tester, row);
      await tester.longPress(row);
      await settle(tester);
      await tester.tap(find.text('Move to Trash'));
      await waitFor(tester, find.text('Delete project?'));
    }

    await trash();
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(row, findsOneWidget);
    await trash();
    await tester.tap(find.text('Move to Trash').last);
    await waitGone(tester, row);
  });
}
