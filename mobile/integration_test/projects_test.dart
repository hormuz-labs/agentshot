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

    await tester.enterText(
      find.widgetWithText(TextField, 'Search projects'),
      'no such project',
    );
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.text(project), findsNothing);
    await reveal(tester, find.text('A home for your films'));
    await tester.enterText(
      find.widgetWithText(TextField, 'Search projects'),
      project.substring(0, 3),
    );
    await reveal(tester, find.text(project));

    await openProject(tester);
    expect(find.widgetWithText(AppBar, project), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('tab-Film')));
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );

    await tester.tap(find.byKey(const ValueKey('tab-Files')));
    await waitFor(tester, find.text('Project files'));
    await waitFor(tester, find.textContaining('.mp4'));

    await tester.pageBack();
    await waitFor(tester, find.text('What are we making?'));
  });

  testWidgets('refreshes, and moves a project to the Trash after asking', (
    tester,
  ) async {
    await launchPaired(tester);
    const throwaway = 'Mobile e2e throwaway';

    // Refresh, and pulling the list down
    await tester.tap(find.byTooltip('Refresh'));
    await settle(tester);
    await reveal(tester, find.text('What are we making?'));
    await tester.fling(
      find.text('What are we making?'),
      const Offset(0, 400),
      1000,
    );
    await settle(tester, const Duration(seconds: 2));
    expect(find.byType(SnackBar), findsNothing);

    // the + in the bar offers the ways to start; changing one's mind leaves things as they were
    await tester.tap(find.byTooltip('Start something new'));
    await waitFor(tester, find.text('Start something new'));
    final sheet = find.byKey(const ValueKey('start-sheet'));
    for (final option in [
      'Import footage',
      'Record',
      'Start from an idea',
      'Film a walkthrough',
    ]) {
      expect(
        find.descendant(of: sheet, matching: find.text(option)),
        findsOneWidget,
      );
    }
    await tester.tap(
      find.descendant(of: sheet, matching: find.text('Start from an idea')),
    );
    await answer(tester, null);
    expect(sheet, findsNothing);

    // a project to throw away: an idea, in 16:9
    await start(tester, 'Start from an idea');
    await answer(tester, throwaway);
    await waitFor(tester, find.text('Choose a format'));
    await tester.tap(find.text('16:9'));
    await waitFor(
      tester,
      find.widgetWithText(AppBar, throwaway),
      timeout: const Duration(minutes: 2),
    );
    await tester.pageBack();
    await waitGone(tester, find.widgetWithText(AppBar, throwaway));
    await settle(tester);

    // Move to Trash asks first: Cancel keeps it, Confirm removes it
    final row = find.widgetWithText(ListTile, throwaway);
    Future<void> trash() async {
      // nothing in front of the row (a message from creating the project)
      if (find.byType(SnackBar).evaluate().isNotEmpty) {
        ScaffoldMessenger.of(
          tester.element(find.byType(SnackBar).first),
        ).clearSnackBars();
        await settle(tester);
      }
      await reveal(tester, row);
      await tester.tap(
        find.descendant(of: row, matching: find.byTooltip('Project actions')),
      );
      await settle(tester);
      await tester.tap(find.text('Move to Trash'));
      await waitFor(tester, find.text('Delete project?'));
    }

    await trash();
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(row, findsOneWidget);
    await trash();
    await tester.tap(find.text('Confirm'));
    await waitGone(tester, row);
  });
}
