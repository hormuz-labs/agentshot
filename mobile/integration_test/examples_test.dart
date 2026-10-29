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
    final search = find.byKey(const ValueKey('search-examples'));
    await waitFor(tester, search);
    final tiles = find.byWidgetPredicate(
      (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('example-'),
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
    final chips = find.descendant(
      of: find.byKey(const ValueKey('example-tags')),
      matching: find.byType(ChoiceChip),
    );
    final tags = tester
        .widgetList<ChoiceChip>(chips)
        .map((c) => (c.label as Text).data!)
        .where((t) => t != 'All')
        .toList();
    expect(tags, isNotEmpty);
    await press(tester, find.widgetWithText(ChoiceChip, tags.first));
    expect(tiles.evaluate().length, inInclusiveRange(1, all));
    await press(tester, find.widgetWithText(ChoiceChip, 'All'));
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
    await describe(tester, 'Mobile e2e from an example', format: '1:1');
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
