// The Examples tab with the desktop's gallery: searching, filtering by category, opening an example (its preview),
// and starting a project from it (square, 1:1), which the agent picks up.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('searches, filters, plays and uses an example', (tester) async {
    await launchPaired(tester);
    await tester.tap(find.byKey(const ValueKey('nav-Examples')));
    final search = find.widgetWithText(TextField, 'Search examples');
    await waitFor(tester, search);
    final tiles = find.descendant(
      of: find.byType(Card),
      matching: find.byWidgetPredicate(
        (w) =>
            w is ListTile &&
            w.leading is Icon &&
            (w.leading as Icon).icon == Icons.play_circle_outline,
      ),
    );
    await waitFor(tester, tiles);
    String titleOf(Finder tile) => tester
        .widget<Text>(
          find.descendant(of: tile, matching: find.byType(Text)).first,
        )
        .data!;
    final first = titleOf(tiles.first);

    // search: nothing for nonsense, the example for part of its title
    await tester.enterText(search, 'no such example anywhere');
    await settle(tester);
    expect(tiles, findsNothing);
    await tester.enterText(search, first.substring(0, first.length ~/ 2));
    await settle(tester);
    expect(find.text(first), findsOneWidget);
    await tester.enterText(search, '');
    await settle(tester);

    // a category narrows the list; All brings everything back
    final all = tiles.evaluate().length;
    await press(
      tester,
      find.widgetWithText(DropdownButtonFormField<String>, 'All'),
    );
    final tags = tester
        .widgetList<DropdownMenuItem<String>>(
          find.byType(DropdownMenuItem<String>),
        )
        .map((i) => i.value!)
        .where((t) => t != 'All')
        .toSet();
    expect(tags, isNotEmpty);
    await tester.tap(find.text(tags.first).last);
    await settle(tester);
    expect(tiles.evaluate().length, inInclusiveRange(1, all));
    await press(tester, find.text(tags.first).first);
    await tester.tap(find.text('All').last);
    await settle(tester);
    expect(tiles.evaluate().length, all);

    // an example: its video plays, and it starts a project
    await press(tester, find.text(first));
    await waitFor(tester, find.text('Use this example'));
    // the preview streams from the internet: it plays when the emulator is online (play and pause are the film
    // test's; here only that the sheet doesn't hang on it)
    await waitFor(
      tester,
      find.byWidgetPredicate(
        (w) =>
            (w is Tooltip && w.message == 'Play') ||
            (w is Text && w.data == 'Retry preview'),
      ),
      timeout: const Duration(seconds: 60),
    );
    if (find.byTooltip('Play').evaluate().isNotEmpty) {
      await tester.tap(find.byTooltip('Play'));
      await waitFor(tester, find.byTooltip('Pause'));
      await tester.tap(find.byTooltip('Pause'));
    }
    await press(tester, find.text('Use this example'));
    await answer(tester, 'Mobile e2e from an example');
    await waitFor(tester, find.text('Choose a format'));
    await tester.tap(find.text('1:1'));
    await waitFor(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e from an example'),
      timeout: const Duration(minutes: 2),
    );
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 2),
    );
  });
}
