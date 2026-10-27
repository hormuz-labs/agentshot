import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/player.dart';
import 'package:agentshot_mobile/ui/project.dart';
import 'package:agentshot_mobile/ui/range_notes.dart';
import 'chat_extras_test.dart' show Quiet, storeWith;

class RetryClient extends Quiet {
  bool fail = true;
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    if (method == 'agent:send' && fail) throw BridgeException('Offline');
    return super.call(method, args);
  }
}

void main() {
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    for (final pointer in [PointerDeviceKind.touch, PointerDeviceKind.mouse]) {
      testWidgets(
        '$platform $pointer: drags append, reverse and clamp; tap/cancel add nothing',
        (tester) async {
          final notes = <RangeDraft>[];
          double? seek;
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(platform: platform),
              home: Scaffold(
                body: StatefulBuilder(
                  builder: (context, set) => SizedBox(
                    width: 300,
                    child: RangeTimeline(
                      duration: 10,
                      position: 0,
                      notes: notes,
                      onSeek: (v) => seek = v,
                      onRange: (a, b) => set(() => notes.add(RangeDraft(a, b))),
                    ),
                  ),
                ),
              ),
            ),
          );
          final bar = find.byKey(const ValueKey('range-timeline'));
          final origin = tester.getTopLeft(bar);
          Future<void> drag(double a, double b, {bool cancel = false}) async {
            final g = await tester.startGesture(
              origin + Offset(a, 28),
              kind: pointer,
            );
            await g.moveTo(origin + Offset((a + b) / 2, 28));
            await g.moveTo(origin + Offset(b, 28));
            if (cancel) {
              await g.cancel();
            } else {
              await g.up();
            }
            await tester.pump();
          }

          await drag(30, 120);
          await drag(270, 180);
          expect(notes.length, 2);
          expect(notes[0].start, closeTo(1, .001));
          expect(notes[0].end, closeTo(4, .001));
          expect(notes[1].start, closeTo(6, .001));
          expect(notes[1].end, closeTo(9, .001));
          await tester.tapAt(origin + const Offset(150, 28));
          await tester.pump();
          expect(seek, closeTo(5, .001));
          await drag(60, 160, cancel: true);
          expect(notes.length, 2);
          await drag(240, 360);
          expect(notes.last.end, 10);
          expect(tester.takeException(), isNull);
        },
      );
    }

    testWidgets(
      '$platform: range text appends in one composer, stays editable and survives failed sends',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 1800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final client = RetryClient();
        final store = storeWith(client, []);
        store.project!['versions'] = [
          {'id': 'v1', 'path': 'media/a.mp4', 'title': 'Original'},
        ];
        store.project!['current'] = 'v1';
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: platform),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: true),
              child: child!,
            ),
            home: ProjectScreen(store: store),
          ),
        );
        await tester.pumpAndSettle();
        // The same callback the player's tested gesture surface calls.
        var player = tester.widget<RemotePlayer>(
          find.byType(RemotePlayer).first,
        );
        player.onRange!(1, 3);
        await tester.pumpAndSettle();
        final composer = find.byKey(const ValueKey('composer'));
        TextEditingController controller() =>
            tester.widget<TextField>(composer).controller!;
        expect(controller().text, 'From 1.000s to 3.000s: ');
        final span = controller().buildTextSpan(
          context: tester.element(composer),
          withComposing: false,
        );
        final stamp = span.children!.whereType<TextSpan>().firstWhere(
          (s) => s.text!.startsWith('From'),
        );
        expect(stamp.style!.fontWeight, FontWeight.bold);
        expect(stamp.style!.backgroundColor, const Color(0xFFF97316));
        await tester.enterText(composer, '${controller().text}Cut the pause');
        controller().selection = const TextSelection.collapsed(offset: 0);
        player = tester.widget<RemotePlayer>(find.byType(RemotePlayer).first);
        player.onRange!(6, 9);
        await tester.pumpAndSettle();
        expect(
          controller().text,
          'From 1.000s to 3.000s: Cut the pause\nFrom 6.000s to 9.000s: ',
        );
        expect(controller().selection.baseOffset, controller().text.length);
        await tester.enterText(
          composer,
          '${controller().text}Brighten the shot',
        );
        await tester.pumpAndSettle();
        final draft = controller().text;
        // Failure keeps both instructions, allowing the exact batch to be retried.
        await tester.ensureVisible(find.byTooltip('Send'));
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(find.text('Your note didn’t send'), findsOneWidget);
        expect(controller().text, draft);
        // Edit timestamps and remove instructions directly in the same field.
        await tester.enterText(composer, '6.500:9.000 Brighten the shot');
        player = tester.widget<RemotePlayer>(find.byType(RemotePlayer).first);
        player.onRange!(2, 4);
        await tester.pumpAndSettle();
        expect(
          controller().text,
          '6.500:9.000 Brighten the shot\nFrom 2.000s to 4.000s: ',
        );
        await tester.enterText(composer, '${controller().text}Mute');
        await tester.pumpAndSettle();
        client.fail = false;
        await tester.ensureVisible(find.byTooltip('Send'));
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(client.sent.length, 1);
        expect(
          client.sent.single[1]['text'],
          '6.500:9.000 Brighten the shot\nFrom 2.000s to 4.000s: Mute',
        );
        expect(controller().text, isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  }

  test('appending and editing text keeps highlights in sync', () {
    final draft = appendRange('1:3 Cut the pause', 6.5, 9);
    expect(draft, '1:3 Cut the pause\nFrom 6.500s to 9.000s: ');
    expect(draftRanges(draft).map((r) => (r.start, r.end)), [
      (1.0, 3.0),
      (6.5, 9.0),
    ]);
    expect(draftRanges('6.500:9.000 Brighten').length, 1);
    expect(draftRanges('Plain text'), isEmpty);
  });
}
