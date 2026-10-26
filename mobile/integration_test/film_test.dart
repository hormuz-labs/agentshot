// The Film tab against the real desktop's film: playing, pausing, muting and seeking the preview, and pointing the
// next note at a moment, a box on the picture or a time range (and taking that off again). A box note goes to the
// agent and shows up under the film. The Timeline & mix button opens the timeline.
import 'package:agentshot_mobile/ui/player.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('plays the film and points notes at moments, boxes and ranges', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);
    await newConversation(tester);

    final note = find.byWidgetPredicate(
      (w) =>
          w is InputChip &&
          w.label is Text &&
          ((w.label as Text).data ?? '').startsWith('Note at'),
    );
    Future<void> film() async {
      await tester.tap(find.byKey(const ValueKey('tab-Film')));
      await waitFor(
        tester,
        find.byTooltip('Play'),
        timeout: const Duration(seconds: 60),
      );
    }

    await film();

    // play and pause, mute and unmute
    await tester.tap(find.byTooltip('Play'));
    await waitFor(tester, find.byTooltip('Pause'));
    await tester.tap(find.byTooltip('Pause'));
    await waitFor(tester, find.byTooltip('Play'));
    await tester.tap(find.byTooltip('Mute'));
    await waitFor(tester, find.byTooltip('Unmute'));
    await tester.tap(find.byTooltip('Unmute'));
    await waitFor(tester, find.byTooltip('Mute'));

    // seeking moves the playhead
    final slider = find.descendant(
      of: find.byType(RemotePlayer),
      matching: find.byType(Slider),
    );
    // (the playhead itself, not the clock: on a film a second long, both ends read 0:00)
    final before = tester.widget<Slider>(slider).value;
    final bar = tester.getRect(slider);
    await tester.tapAt(Offset(bar.left + bar.width * .6, bar.center.dy));
    await settle(tester, const Duration(seconds: 1));
    expect(tester.widget<Slider>(slider).value, isNot(before));

    // Note here: the next note points at the playhead; its chip takes that off again
    await press(tester, find.text('Note here'));
    await waitFor(tester, note);
    await tester.tap(
      find.descendant(of: note, matching: find.byTooltip('Delete')),
    );
    await settle(tester);
    expect(note, findsNothing);

    // a box on the picture: Draw a box, then Cancel box, then draw one for real
    await film();
    await press(tester, find.text('Draw a box'));
    expect(
      find.text(
        'Drag over the picture to attach a precise box to your next note.',
      ),
      findsOneWidget,
    );
    await press(tester, find.text('Cancel box'));
    expect(find.text('Draw a box'), findsOneWidget);
    await press(tester, find.text('Draw a box'));
    final picture = tester.getRect(find.byType(RemotePlayer));
    await tester.dragFrom(
      picture.topLeft + Offset(picture.width * .3, picture.width * .15),
      Offset(picture.width * .3, picture.width * .2),
    );
    await waitFor(tester, find.byKey(const ValueKey('composer')));
    await waitFor(tester, note);
    expect(
      ((tester.widget<InputChip>(note).label as Text).data!),
      endsWith('· box'),
    );
    await sendNote(tester, 'Mobile e2e: soften this corner');
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 2),
    );
    // the note is kept with the film, at its moment
    await film();
    await reveal(tester, find.text('Mobile e2e: soften this corner'));

    // a time range: a wrong one is caught, a right one goes on the next note; Cancel leaves things as they were
    await press(tester, find.text('Note a range'));
    await waitFor(tester, find.text('Note a time range'));
    await tester.enterText(
      find.widgetWithText(TextField, 'Start (seconds)'),
      'soon',
    );
    await tester.tap(find.text('Attach range'));
    await waitFor(tester, find.text('Enter a valid start and a later end.'));
    await tester.enterText(
      find.widgetWithText(TextField, 'Start (seconds)'),
      '0.5',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'End (seconds)'),
      '1.5',
    );
    await tester.tap(find.text('Attach range'));
    await waitFor(tester, note);
    await tester.tap(
      find.descendant(of: note, matching: find.byTooltip('Delete')),
    );
    await settle(tester);
    await film();
    await press(tester, find.text('Note a range'));
    await waitFor(tester, find.text('Note a time range'));
    await tester.tap(find.text('Cancel'));
    await waitGone(tester, find.text('Note a time range'));
    expect(find.byTooltip('Play'), findsOneWidget); // still on the film

    // Timeline & mix, from the button under the film
    await press(tester, find.widgetWithText(OutlinedButton, 'Timeline & mix'));
    await waitFor(tester, find.text('Audio mix'));
    await closeSheet(tester);
  });
}
