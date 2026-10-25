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

  // The section chips scroll sideways when they don't fit (large text on a phone), as a person would swipe them.
  Future<void> chip(WidgetTester tester, String label) async {
    final target = find.byKey(ValueKey('tab-$label'));
    await tester.ensureVisible(target);
    await settle(tester, const Duration(milliseconds: 300));
    await tester.tap(target);
  }

  Future<void> sheet(WidgetTester tester, String menu, String where) async {
    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester, const Duration(milliseconds: 500));
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
          await tester.ensureVisible(find.text(tab).last);
          await tester.tap(find.text(tab).last);
          await visit(tester, '$where, $tab');
        }
        for (final panel in [
          'Model providers',
          'AI keys',
          'Skills & profiles',
          'Memory',
        ]) {
          await reveal(tester, find.text(panel));
          await tester.tap(find.text(panel));
          await visit(tester, '$where, Settings → $panel');
          if (find.byTooltip('Close').evaluate().isNotEmpty) {
            await tester.tap(find.byTooltip('Close').last);
          }
          await settle(tester);
        }

        await tester.ensureVisible(find.text('Projects').last);
        await tester.tap(find.text('Projects').last);
        await reveal(tester, find.text('On your computer'));
        await openProject(tester);
        await visit(tester, '$where, project conversation');
        // Wide screens show the conversation and the film side by side; narrow ones switch between them.
        if (find.byKey(const ValueKey('tab-Film')).evaluate().isNotEmpty) {
          await chip(tester, 'Film');
          await visit(tester, '$where, project film');
          await chip(tester, 'Files');
          await visit(tester, '$where, project files');
          await chip(tester, 'Conversation');
          await settle(tester);
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
        await tester.enterText(
          find.byKey(const ValueKey('composer')),
          'A long note that wraps over several lines on a small phone with very large text',
        );
        await visit(tester, '$where, typing a note');
        await tester.pageBack();
        await waitFor(tester, find.byTooltip('Refresh')); // home again
      });
    }
  }
}
