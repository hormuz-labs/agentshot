// Talking to the desktop's agent from the phone: a note goes to the desktop, its reply streams back, and a new
// conversation starts empty. Then the rest of the composer: renaming a conversation, picking the model, mentioning a
// file or version (by typing @ or from the + menu) and taking it off again, and stopping a turn that takes long.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('sends a note and shows the desktop agent reply', (tester) async {
    await launchPaired(tester);
    await openProject(tester);

    const note = 'Mobile e2e: hello from the phone';
    await tester.enterText(find.byKey(const ValueKey('composer')), note);
    await tester.pump(); // Send turns on once there is text
    await tester.tap(find.byTooltip('Send'));
    await waitFor(tester, find.text(note));
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(seconds: 90),
    );
    // no tool calls or labels in the conversation: the note, then the reply

    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Conversations').last);
    await settle(tester);
    await tester.tap(find.text('New conversation'));
    // The list keeps both: the new one, and the first one named after its first message.
    await waitFor(tester, find.text('New conversation').at(1));
    expect(find.widgetWithText(ListTile, note), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await waitFor(tester, find.text('Give notes. Get cuts.'));
    expect(find.text(reply), findsNothing);

    // Switching back brings that conversation back.
    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Conversations').last);
    await settle(tester);
    await tester.tap(find.widgetWithText(ListTile, note));
    await settle(tester);
    await tester.tap(find.byTooltip('Close'));
    await waitFor(tester, find.text(reply));
  });

  testWidgets('renames, picks a model, mentions files and stops a slow turn', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);
    final composer = find.byKey(const ValueKey('composer'));
    final model = find.byKey(const ValueKey('model'));

    // rename the conversation
    await projectMenu(tester, 'Conversations');
    await tester.tap(find.byTooltip('Rename conversation').first);
    await answer(tester, 'Renamed on the phone');
    await waitFor(tester, find.text('Renamed on the phone'));
    await closeSheet(tester);

    // the model: one of the desktop's (the chip then names it), then back to Automatic; each closes the picker
    await press(tester, model);
    await waitFor(tester, find.text('Choose a model'));
    final scripted = find.widgetWithText(ListTile, 'Scripted');
    await waitFor(tester, scripted);
    final name = tester
        .widget<Text>(
          find.descendant(of: scripted, matching: find.byType(Text)).first,
        )
        .data!;
    await tester.tap(scripted);
    await waitGone(tester, find.text('Choose a model'));
    await waitFor(
      tester,
      find.descendant(of: model, matching: find.text(name)),
    );
    await press(tester, model);
    await waitFor(tester, find.widgetWithText(ListTile, 'Automatic'));
    await tester.tap(find.widgetWithText(ListTile, 'Automatic'));
    await waitGone(tester, find.text('Choose a model'));
    expect(find.byType(SnackBar), findsNothing); // no error

    // typing @ offers the project's files; picking one attaches it, and its chip takes it off again
    await tester.enterText(composer, 'Look at @');
    await waitFor(tester, find.text('Mention a file, version or clip'));
    await settle(tester);
    await tester.tap(find.widgetWithText(ListTile, '$project.mp4').last);
    await settle(tester);
    expect(
      tester.widget<TextField>(composer).controller!.text,
      'Look at @$project.mp4 ',
    );
    final chip = find.widgetWithText(InputChip, '$project.mp4');
    expect(chip, findsOneWidget);
    await tester.tap(
      find.descendant(of: chip, matching: find.byTooltip('Delete')),
    );
    await settle(tester);
    expect(chip, findsNothing);

    // the same from the + menu, with a version of the film
    await tester.tap(find.byTooltip('Add'));
    await waitFor(tester, find.text('Mention a file, version or clip'));
    await settle(tester);
    await tester.tap(find.text('Mention a file, version or clip'));
    await settle(tester);
    final sheet = find.ancestor(
      of: find.text('Mention a file, version or clip').last,
      matching: find.byType(ListView),
    );
    final items = find.descendant(of: sheet, matching: find.byType(ListTile));
    await tester.tap(items.last); // the newest version
    await settle(tester);
    expect(find.byType(InputChip), findsOneWidget);
    await tester.tap(find.byTooltip('Delete').first);
    await settle(tester);
    expect(find.byType(InputChip), findsNothing);

    // a turn that takes long: Stop ends it, and the composer is ready again well before it would have finished
    final started = DateTime.now();
    await sendNote(tester, 'Mobile e2e slow: take your time');
    await waitFor(tester, find.byTooltip('Stop'));
    await tester.tap(find.byTooltip('Stop'));
    await waitFor(tester, find.byTooltip('Send'));
    expect(
      DateTime.now().difference(started),
      lessThan(const Duration(seconds: 18)),
    );

    // the app in the background while the agent works: an ongoing notification says it's following the work (and
    // keeps it connected), and when the turn ends a notification says so, with the reply. The runner reads both.
    await sendNote(tester, 'Mobile e2e slow: tell me when you are done');
    await waitFor(tester, find.byTooltip('Stop'));
    // (work that lasts is followed: past its first second)
    await settle(tester, const Duration(seconds: 3));
    cue('home');
    // (Android shows a new ongoing notification after up to 10 s)
    await Future<void>.delayed(const Duration(seconds: 12));
    cue('notifications');
    await Future<void>.delayed(const Duration(seconds: 24));
    cue('notifications');
    cue('front');
    await waitFor(tester, find.byTooltip('Send'), timeout: const Duration(minutes: 1));
  });
}
