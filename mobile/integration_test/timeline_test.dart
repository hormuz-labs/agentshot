// A project's files, timeline, mix, history and transcript from the phone, on a project of its own (two clips with
// sound, brought in from the phone): importing more files, attaching one, inserting one at the playhead (and being
// told when a file can't go in the film), sharing one, removing one (Cancel first; a file the film uses is
// protected); every timeline button (split, undo, redo, move, mute, trim with its check, remove, render); the mix
// with music; restoring a checkpoint; choosing a version; and transcribing, which asks to download speech
// recognition: declined in the conversation, accepted from Activity (the runner makes that download fail at once).
import 'package:agentshot_mobile/bridge/pick.dart';
import 'package:agentshot_mobile/ui/player.dart';
import 'package:agentshot_mobile/ui/project.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

const title = 'Pier jump';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final pieces = find.byType(ExpansionTile);
  Future<void> files(WidgetTester tester) async {
    await tester.tap(find.byKey(const ValueKey('tab-Files')));
    await waitFor(tester, find.text('Project files'));
  }

  /// The ⋮ menu of the file named [name] in the Files tab, then [item].
  Future<void> fileMenu(WidgetTester tester, String name, String item) async {
    final row = find.widgetWithText(Card, name);
    await reveal(tester, row);
    await tester.tap(
      find.descendant(of: row, matching: find.byTooltip('File actions')),
    );
    await settle(tester);
    await tester.tap(find.text(item).last);
    await settle(tester);
  }

  /// Waits until the timeline has [k] pieces.
  Future<void> count(WidgetTester tester, int k) async {
    final end = DateTime.now().add(const Duration(seconds: 30));
    while (pieces.evaluate().length != k) {
      if (DateTime.now().isAfter(end)) {
        fail('expected $k pieces, found ${pieces.evaluate().length}');
      }
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  testWidgets('works the files, timeline, mix and history of a new project', (
    tester,
  ) async {
    await launchPaired(tester);

    // a project from two clips
    Picker.override = (kind) {
      expect(kind, Pick.videos);
      return media(['$title.mp4', 'Gull flyby.mp4']);
    };
    await start(tester, 'Import footage');
    await waitFor(tester, find.text('What are you bringing in?'));
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('pick-videos')));
    await waitFor(
      tester,
      find.widgetWithText(AppBar, title),
      timeout: const Duration(minutes: 2),
    );

    // more files from inside the project: music, a text file and a photo (they wait on the next note; off again)
    await files(tester);
    Picker.override = (kind) {
      expect(kind, Pick.files);
      return media(['Theme music.m4a', 'Shot list.txt', 'Dunes 1.jpg']);
    };
    await press(tester, find.text('Import files'));
    await waitFor(tester, find.text('What are you bringing in?'));
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('pick-files')));
    for (final name in ['Theme music.m4a', 'Shot list.txt', 'Dunes 1.jpg']) {
      await waitFor(
        tester,
        find.text(name),
        timeout: const Duration(minutes: 1),
      );
    }
    await tester.tap(find.byKey(const ValueKey('tab-Conversation')));
    await settle(tester);
    while (find.byTooltip('Delete').evaluate().isNotEmpty) {
      await tester.tap(find.byTooltip('Delete').first);
      await settle(tester, const Duration(milliseconds: 300));
    }

    // a file's row attaches it to the next note
    await files(tester);
    await press(tester, find.text('Gull flyby.mp4'));
    await waitFor(tester, find.widgetWithText(InputChip, 'Gull flyby.mp4'));
    await tester.tap(find.byTooltip('Delete'));
    await settle(tester);

    // Insert at playhead: a text file can't go in the film; a clip can
    await files(tester);
    await fileMenu(tester, 'Shot list.txt', 'Insert at playhead');
    await snack(tester, 'Ask AgentShot how to use this file in the film.');
    await fileMenu(tester, 'Gull flyby.mp4', 'Insert at playhead');
    await settle(tester, const Duration(seconds: 2));
    expect(find.byType(SnackBar), findsNothing);

    // Download / share: the file comes to the phone and the share sheet opens over the app (the runner closes it)
    await fileMenu(tester, 'Dunes 1.jpg', 'Download / share');
    cue('back');
    await settle(tester, const Duration(seconds: 8));
    expect(find.byType(SnackBar), findsNothing);

    // Remove: Cancel keeps it, Confirm removes it; a clip the film uses stays
    await fileMenu(tester, 'Dunes 1.jpg', 'Remove');
    await waitFor(tester, find.text('Remove file?'));
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(find.text('Dunes 1.jpg'), findsOneWidget);
    await fileMenu(tester, 'Dunes 1.jpg', 'Remove');
    await waitFor(tester, find.text('Remove file?'));
    await tester.tap(find.text('Confirm'));
    await waitGone(tester, find.text('Dunes 1.jpg'));
    await fileMenu(tester, '$title.mp4', 'Remove');
    await waitFor(tester, find.text('Remove file?'));
    await tester.tap(find.text('Confirm'));
    await waitFor(tester, find.byType(SnackBar));
    await settle(tester);
    expect(find.text('$title.mp4'), findsOneWidget);
    ScaffoldMessenger.of(
      tester.element(find.byType(SnackBar).first),
    ).clearSnackBars();

    // the playhead into the film, for splitting there
    await tester.tap(find.byKey(const ValueKey('tab-Film')));
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );
    final bar = tester.getRect(
      find.descendant(
        of: find.byType(RemotePlayer),
        matching: find.byType(Slider),
      ),
    );
    await tester.tapAt(Offset(bar.left + bar.width * .2, bar.center.dy));
    await settle(tester);

    // the timeline
    await projectMenu(tester, 'Timeline & mix');
    await waitFor(tester, find.text('Audio mix'));
    await waitFor(tester, pieces);
    final n = pieces.evaluate().length; // the first clip, and the one inserted
    expect(n, greaterThanOrEqualTo(2));
    Future<void> button(String label) async {
      await press(tester, find.text(label).first);
      await settle(tester, const Duration(seconds: 1));
      expect(find.byType(SnackBar), findsNothing, reason: label);
    }

    await button('Split at playhead');
    await count(tester, n + 1);
    await button('Undo');
    await count(tester, n);
    await button('Redo');
    await count(tester, n + 1);

    // a piece's own buttons
    String name(int i) => tester
        .widget<Text>(
          find.descendant(of: pieces.at(i), matching: find.byType(Text)).first,
        )
        .data!
        .replaceFirst(RegExp(r'^\d+\. '), '');
    Future<void> open(int i) async {
      await reveal(tester, pieces.at(i));
      await tester.tap(
        find.descendant(of: pieces.at(i), matching: find.byType(ListTile)),
      );
      await settle(tester);
    }

    final second = name(1);
    await open(1);
    await button('Move earlier');
    await waitFor(tester, find.textContaining('1. $second'));
    await open(0);
    await button('Move later');
    await waitFor(tester, find.textContaining('2. $second'));
    await open(0);
    await button('Mute');
    await waitFor(tester, find.text('Unmute'));
    await button('Unmute');
    await waitFor(tester, find.text('Mute'));
    await press(tester, find.text('Trim').first);
    await answer(tester, 'from the start');
    await snack(tester, 'Enter two valid seconds: start, end.');
    await open(0);
    await press(tester, find.text('Trim').first);
    await answer(tester, '0, 1');
    await waitFor(tester, find.text('0:00 – 0:01'));
    await open(n);
    await button('Remove piece');
    await count(tester, n);

    // the mix: the film's level, then music under it, ducked under speech
    await reveal(tester, find.text('Film 0 dB'));
    final sliders = find.descendant(
      of: find.byType(MixEditor),
      matching: find.byType(Slider),
    );
    final film = sliders.first;
    final music = find.text('No music');
    await tester.tap(film);
    await settle(tester);
    expect(find.text('Film 0 dB'), findsNothing);
    await press(tester, music);
    await tester.tap(find.text('Theme music.m4a').last);
    await settle(tester);
    await reveal(tester, find.textContaining('Duck under speech'));
    for (final i in [1, 2]) {
      await tester.tap(sliders.at(i));
      await settle(tester, const Duration(milliseconds: 300));
    }
    await button('Save mix');
    await button('Render preview');
    await waitFor(
      tester,
      find.text('Render preview'),
      timeout: const Duration(minutes: 2),
    );
    await closeSheet(tester);

    // history: a checkpoint, Cancel first, then restored
    await projectMenu(tester, 'History');
    await waitFor(tester, find.text('Project history'));
    final point = find.descendant(
      of: find.ancestor(
        of: find.text('Project history'),
        matching: find.byType(ListView),
      ),
      matching: find.byType(ListTile),
    );
    await waitFor(tester, point);
    await tester.tap(point.first);
    await waitFor(tester, find.text('Restore this checkpoint?'));
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    await tester.tap(point.first);
    await waitFor(tester, find.text('Restore this checkpoint?'));
    await tester.tap(find.text('Confirm'));
    await settle(tester, const Duration(seconds: 2));
    expect(find.byType(SnackBar), findsNothing);
    await closeSheet(tester);

    // versions: choosing one closes the list
    await projectMenu(tester, 'Versions');
    await waitFor(tester, find.text('Every cut you kept'));
    await tester.tap(
      find
          .descendant(
            of: find.ancestor(
              of: find.text('Every cut you kept'),
              matching: find.byType(ListView),
            ),
            matching: find.byType(ListTile),
          )
          .first,
    );
    await waitGone(tester, find.text('Every cut you kept'));

    // transcribing asks the computer to download speech recognition: no, from the card in the conversation
    Future<void> transcribe() async {
      await projectMenu(tester, 'Transcript');
      await waitFor(tester, find.text('Transcript'));
      await tester.tap(find.text('$title.mp4').last);
      await waitFor(tester, find.text('Transcribe on desktop'));
      await tester.tap(find.text('Transcribe on desktop'));
      await settle(tester);
      await closeSheet(tester);
    }

    await tester.tap(find.byKey(const ValueKey('tab-Conversation')));
    await transcribe();
    await waitFor(tester, find.text('Decline'));
    await tester.tap(find.text('Decline'));
    await waitGone(tester, find.text('Decline'));

    // yes, from Activity: the card goes and the download starts (and here fails at once)
    await transcribe();
    await tester.pageBack();
    await waitFor(tester, find.text('What are we making?'));
    // the question waits in Activity: its tab says so
    await waitFor(
      tester,
      find.descendant(
        of: find.byKey(const ValueKey('nav-Activity')),
        matching: find.text('1'),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('nav-Activity')));
    await waitFor(tester, find.textContaining('Download '));
    await tester.tap(
      find.byWidgetPredicate(
        (w) =>
            w is FilledButton &&
            w.child is Text &&
            ((w.child as Text).data ?? '').startsWith('Download '),
      ),
    );
    await waitGone(tester, find.text('Decline'));
  });
}
