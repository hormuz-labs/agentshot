// Every screen with real desktop data at phone, small-phone, landscape and tablet sizes, with normal and very large
// text: nothing may overflow (Flutter reports an overflow as an error, which fails the test) and every screen still
// shows what it is for. test/responsive_test.dart covers the same sizes with fake data, fast; this one runs on the
// device against the real desktop.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

const sizes = {
  'small phone': Size(320, 568),
  'phone': Size(393, 852),
  'phone landscape': Size(852, 393),
  'tablet': Size(820, 1180),
  'tablet landscape': Size(1180, 820),
};

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // a tap on something covered or off screen fails, rather than silently missing
  WidgetController.hitTestWarningShouldBeFatal = true;

  // The widget behind an overflow (Flutter names it and where it was created), for the failure message.
  var culprit = '';
  Future<void> visit(WidgetTester tester, String where) async {
    final report = FlutterError.onError;
    FlutterError.onError = (details) {
      culprit = details
          .toString()
          .split('\n')
          .where(
            (l) =>
                l.contains('relevant error-causing widget') ||
                l.contains('.dart:'),
          )
          .take(3)
          .join(' ');
      report?.call(details);
    };
    try {
      await settle(tester);
    } finally {
      FlutterError.onError = report;
    }
    final error = tester.takeException();
    if (error != null) fail('$where: $error $culprit');
  }

  // A place in the app: an icon in the bar at the bottom of a phone, its name in the side bar of a wide screen.
  Finder place(String name) {
    final icon = find.byKey(ValueKey('nav-$name'));
    return icon.evaluate().isNotEmpty ? icon : find.text(name).last;
  }

  // The section chips scroll sideways when they don't fit (large text on a phone), as a person would swipe them.
  Future<void> sheet(WidgetTester tester, String menu, String where) async {
    await backToFilm(tester);
    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester, const Duration(milliseconds: 500));
    // a short screen scrolls the menu
    await tester.ensureVisible(find.text(menu).last);
    await settle(tester, const Duration(milliseconds: 300));
    await tester.tap(find.text(menu).last);
    await visit(tester, '$where, $menu');
    if (find.byTooltip('Close').evaluate().isNotEmpty) {
      await tester.tap(find.byTooltip('Close').last);
    } else {
      await tester.tapAt(const Offset(4, 4)); // outside the sheet
    }
    await settle(tester);
  }

  for (final MapEntry(key: name, value: size) in sizes.entries) {
    for (final scale in [1.0, 2.0]) {
      final where =
          '$name ${size.width.round()}×${size.height.round()}, text ×$scale';
      testWidgets(where, (tester) async {
        binding.platformDispatcher.textScaleFactorTestValue = scale;
        tester.view.physicalSize = size * tester.view.devicePixelRatio;
        addTearDown(binding.platformDispatcher.clearTextScaleFactorTestValue);
        addTearDown(tester.view.resetPhysicalSize);

        await launchPaired(tester);
        await visit(tester, '$where, Projects');

        for (final tab in ['Examples', 'Activity', 'Settings']) {
          // on wide screens the side bar scrolls when the text is large
          await tester.ensureVisible(place(tab));
          await tester.tap(place(tab));
          await visit(tester, '$where, $tab');
        }
        for (final panel in [
          'Model providers',
          'AI',
          'Skills & profiles',
          'Memory',
        ]) {
          await reveal(tester, find.text(panel));
          // up from under the + and the bar
          await Scrollable.ensureVisible(find.text(panel).evaluate().first, alignment: .3);
          await settle(tester, const Duration(milliseconds: 300));
          await tester.tap(find.text(panel));
          await visit(tester, '$where, Settings → $panel');
          if (find.byTooltip('Close').evaluate().isNotEmpty) {
            await tester.tap(find.byTooltip('Close').last);
          }
          await settle(tester);
        }

        await tester.ensureVisible(place('Projects'));
        await tester.tap(place('Projects'));
        await reveal(tester, projectCard);
        await openProject(tester);
        await visit(tester, '$where, project conversation');
        // Wide screens show the conversation and the film side by side; narrow ones have the conversation over the film.
        if (filmActivity.evaluate().isNotEmpty) {
          await backToFilm(tester);
          await visit(tester, '$where, project film');
          await openFiles(tester);
          await visit(tester, '$where, project files');
          await closeSheet(tester);
        }
        for (final menu in [
          'Conversations',
          'Versions',
          'Timeline & mix',
          'Choose model',
          'History',
          'Transcript',
        ]) {
          await sheet(tester, menu, where);
        }
        await openConversation(tester);
        await tester.enterText(
          composer,
          'A long note that wraps over several lines on a small phone with very large text',
        );
        await visit(tester, '$where, typing a note');
        await leaveProject(tester);
        await waitFor(tester, find.byTooltip('Start something new')); // home again
      });
    }
  }
}
