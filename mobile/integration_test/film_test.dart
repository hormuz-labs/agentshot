// The film against the real desktop's. On a phone the film is the screen: playing, pausing and seeking it, and pointing
// a note at a moment, a box on the picture or a range on the strip (and changing one's mind); a box note goes to the
// agent and stays pinned on the film. On a wide screen the player beside the conversation: playing, pausing, muting and
// seeking the preview, and pointing the next note the same three ways (and taking that off again). Either way the
// timeline opens from there.
import 'package:agentshot_mobile/ui/player.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('on a phone, plays the film and pins notes on moments, boxes and ranges', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);
    await newConversation(tester);
    await backToFilm(tester);
    await waitFor(tester, filmPicture, timeout: const Duration(seconds: 60));

    final bubble = find.byKey(const ValueKey('editor-bubble'));
    final strip = find.byKey(const ValueKey('editor-strip'));
    final box = find.byKey(const ValueKey('editor-box-tool'));
    final range = find.byKey(const ValueKey('editor-range-tool'));
    Offset along(double share) {
      final bar = tester.getRect(strip);
      return Offset(bar.left + bar.width * share, bar.bottom - 10);
    }

    // play and pause
    await tester.tap(filmPicture);
    await waitFor(tester, find.byIcon(Icons.pause_rounded));
    await tester.tap(filmPicture);
    await waitFor(tester, find.byIcon(Icons.play_arrow_rounded));

    // seeking moves the playhead
    await tester.tapAt(along(.05));
    await waitFor(tester, find.textContaining(RegExp(r'^0:00 / ')));
    await tester.tapAt(along(.7));
    await waitFor(tester, find.textContaining(RegExp(r'^0:02 / ')));

    // Note: a bubble for the moment the film is at; closing it leaves things as they were
    await tester.tap(find.byKey(const ValueKey('editor-note-tool')));
    await waitFor(tester, bubble);
    expect(find.text('At 0:02'), findsOneWidget);
    await tester.tap(
      find.descendant(of: bubble, matching: find.byIcon(Icons.close_rounded)),
    );
    await settle(tester);
    expect(bubble, findsNothing);

    // a box on the picture: Box, Box again to change one's mind, then draw one for real
    await tester.tap(box);
    await waitFor(tester, find.text('Draw a box on the picture'));
    await tester.tap(box);
    await waitGone(tester, find.text('Draw a box on the picture'));
    await tester.tap(box);
    await waitFor(tester, find.text('Draw a box on the picture'));
    final picture = tester.getRect(filmPicture);
    await tester.dragFrom(
      picture.topLeft + Offset(picture.width * .3, picture.height * .3),
      Offset(picture.width * .3, picture.height * .4),
    );
    await waitFor(tester, bubble);
    expect(find.text('0:02 · on this box'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('editor-words')),
      'Mobile e2e: soften this corner',
    );
    await tester.tap(find.byKey(const ValueKey('editor-send')));
    await waitGone(tester, bubble);
    // the agent answers in the conversation; the note is kept with the film, a pin at its moment
    await openConversation(tester);
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 2),
    );
    await backToFilm(tester);
    final pin = find.byKey(const ValueKey('editor-pin-0'));
    await waitFor(tester, pin);
    await tester.tap(pin);
    final kept = find.byKey(const ValueKey('editor-note'));
    await waitFor(tester, kept);
    expect(
      find.descendant(
        of: kept,
        matching: find.text('Mobile e2e: soften this corner'),
      ),
      findsOneWidget,
    );
    await tester.tap(
      find.descendant(of: kept, matching: find.byIcon(Icons.close_rounded)),
    );
    await settle(tester);

    // a range on the strip: a touch too short to be one opens nothing, a real one opens the bubble for it, and
    // Range again leaves things as they were
    await tester.tap(range);
    await waitFor(tester, find.text('Drag across the strip'));
    await tester.dragFrom(along(.3), const Offset(24, 0));
    await settle(tester);
    expect(bubble, findsNothing);
    await tester.dragFrom(along(.1), Offset(along(.6).dx - along(.1).dx, 0));
    await waitFor(tester, bubble);
    expect(find.textContaining(RegExp(r'^0:\d\d–0:\d\d$')), findsOneWidget);
    await tester.tap(
      find.descendant(of: bubble, matching: find.byIcon(Icons.close_rounded)),
    );
    await settle(tester);
    expect(bubble, findsNothing);
    await tester.tap(range);
    await settle(tester);
    await tester.tap(range);
    await waitGone(tester, find.text('Drag across the strip'));
    expect(filmPicture, findsOneWidget); // still on the film

    // Timeline & mix, from the project's menu
    await projectMenu(tester, 'Timeline & mix');
    await waitFor(tester, find.text('Audio mix'));
    await closeSheet(tester);
  });

  testWidgets('on a wide screen, plays the film and points notes at moments, boxes and ranges', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1180, 820) * tester.view.devicePixelRatio;
    addTearDown(tester.view.resetPhysicalSize);
    await launchPaired(tester);
    await openProject(tester);
    await newConversation(tester);

    final note = find.byWidgetPredicate(
      (w) =>
          w is InputChip &&
          w.label is Text &&
          ((w.label as Text).data ?? '').startsWith('Note at'),
    );
    // the film is beside the conversation: loaded once its controls are there
    Future<void> film() async {
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
    expect(find.text('Drag to draw a box'), findsOneWidget);
    await press(tester, find.text('Cancel box'));
    expect(find.text('Drag to draw a box'), findsNothing);
    await press(tester, find.text('Draw a box'));
    // the picture in view again (the list scrolled down to the button)
    await tester.ensureVisible(find.byType(RemotePlayer));
    await settle(tester);
    final picture = tester.getRect(
      find
          .descendant(
            of: find.byType(RemotePlayer),
            matching: find.byType(AspectRatio),
          )
          .first,
    );
    // as a finger goes, a little at a time, and more across than down: down alone is the list here scrolling
    final finger = await tester.startGesture(
      picture.topLeft + Offset(picture.width * .3, picture.height * .3),
    );
    for (var i = 0; i < 12; i++) {
      await finger.moveBy(Offset(picture.width * .04, picture.height * .02));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await finger.up();
    await settle(tester);
    await waitFor(tester, composer);
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
    await reveal(
      tester,
      find.widgetWithText(ListTile, 'Mobile e2e: soften this corner'),
    );

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
    // the range starts the next note, in its words, to say what to do with it; taken off by clearing it
    String draft() => tester.widget<TextField>(composer).controller!.text;
    final end = DateTime.now().add(const Duration(seconds: 10));
    while (draft().isEmpty && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(draft(), 'From 0.500s to 1.500s: ');
    await tester.enterText(composer, '');
    await settle(tester);
    await film();
    await press(tester, find.text('Note a range'));
    await waitFor(tester, find.text('Note a time range'));
    await tester.tap(find.text('Cancel'));
    await waitGone(tester, find.text('Note a time range'));
    expect(find.byTooltip('Play'), findsOneWidget); // still on the film

    // Timeline & mix, from the list beside the conversation
    await press(tester, find.text('Timeline & mix'));
    await waitFor(tester, find.text('Audio mix'));
    await closeSheet(tester);
  });
}
