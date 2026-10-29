// Store screenshots from the real app, against the real desktop: not part of the suite. Run through
// MOBILE_E2E_SHOTS=<folder> MOBILE_E2E_ONLY=store_screenshots node test/e2e/mobile.e2e.mjs, which seeds a few projects,
// and captures the device screen whenever this prints "SHOT <name>".
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

/// Lets the screen settle, asks the runner to capture it, and waits while it does.
Future<void> shot(WidgetTester tester, String name) async {
  await settle(tester, const Duration(seconds: 2));
  // ignore: avoid_print
  print('SHOT $name');
  await settle(tester, const Duration(seconds: 4));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('store screenshots', (tester) async {
    await launch(tester);
    await shot(tester, '1-pair');
    await enterCode(tester, pairLink);
    await waitFor(tester, home);
    await reveal(tester, projectCard.first);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await shot(tester, '2-projects');

    await openProject(tester);
    await tester.enterText(
      find.byKey(const ValueKey('composer')),
      'Cut the ums and tighten the opening',
    );
    await tester.pump(); // Send turns on once there is text
    await tester.tap(find.byTooltip('Send'));
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 1),
    );
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
    // up to the start, so the note shows above the agent's steps and reply (not pinned over them)
    await tester.drag(find.byType(ListView).first, const Offset(0, 900));
    await shot(tester, '3-conversation');

    // a tablet shows the film beside the conversation, so the shot above has the before and after too
    if (find.byKey(const ValueKey('open-edit')).evaluate().isNotEmpty) {
      await waitFor(tester, find.text('New cut'));
      await tester.tap(find.widgetWithText(ChoiceChip, 'After'));
      await waitFor(
        tester,
        find.byTooltip('Play'),
        timeout: const Duration(seconds: 60),
      );
      await shot(tester, '4-before-after');
    }

    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Timeline & mix').last);
    await shot(tester, '5-timeline');
    await tester.tap(find.byTooltip('Close').last);
    await settle(tester);
    await tester.pageBack();
    await waitFor(tester, find.byTooltip('Start something new'));

    await start(tester, 'Describe it');
    await waitFor(tester, find.text('Describe your video…'));
    await tester.enterText(
      find.byKey(const ValueKey('create-idea')),
      'A 15-second launch teaser for our new running shoes, bold type, upbeat',
    );
    await shot(tester, '6-idea');
    await describe(tester, null);

    // the same conversation in the dark theme, switched in Settings → Appearance
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    final appearance = find.byKey(const ValueKey('appearance'));
    await reveal(tester, appearance);
    await tester.tap(
      find.descendant(of: appearance, matching: find.byTooltip('Dark')),
    );
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('nav-Projects')));
    await reveal(tester, projectCard.first);
    await openProject(tester);
    await waitFor(tester, find.text(reply));
    await tester.drag(find.byType(ListView).first, const Offset(0, 260));
    await shot(tester, '7-conversation-dark');
  });
}
