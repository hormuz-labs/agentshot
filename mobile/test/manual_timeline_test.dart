import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/manual_timeline.dart';

void main() {
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets('$platform manual clip actions trim, split, remove and move', (
      tester,
    ) async {
      final sent = <Json>[];
      final items = <Json>[
        {'id': 'a', 'kind': 'media', 'src': 'a.mp4', 'in': 0, 'out': 4},
        {'id': 'b', 'kind': 'media', 'src': 'b.mp4', 'in': 1, 'out': 3},
      ];
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: platform),
          home: Scaffold(
            body: ManualTimeline(
              items: items,
              media: {
                'a.mp4': {'duration': 8},
                'b.mp4': {'duration': 6},
              },
              clips: {},
              position: () => 2,
              fps: 25,
              onEdit: (edit) async {
                sent.add(edit);
              },
            ),
          ),
        ),
      );
      Future<void> open() async {
        await tester.tap(find.text('a.mp4'));
        await tester.pumpAndSettle();
      }

      await open();
      await tester.enterText(
        find.widgetWithText(TextField, 'Trim start seconds'),
        '1',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Trim end seconds'),
        '3',
      );
      await tester.pump();
      await tester.tap(find.text('Apply trim'));
      await tester.pumpAndSettle();
      expect(sent.last, {'op': 'trim', 'id': 'a', 'in': 1.0, 'out': 3.0});
      await open();
      await tester.tap(find.text('Split at playhead'));
      await tester.pumpAndSettle();
      expect(sent.last, {'op': 'split', 'at': 2.0});
      await open();
      await tester.tap(find.text('Remove clip'));
      await tester.pumpAndSettle();
      expect(sent.last, {
        'op': 'delete',
        'ids': ['a'],
      });
      await open();
      await tester.tap(find.text('Move later'));
      await tester.pumpAndSettle();
      expect(sent.last, {'op': 'move', 'id': 'a'});
      await open();
      await tester.enterText(
        find.widgetWithText(TextField, 'Trim end seconds'),
        '99',
      );
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Apply trim'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('Close clip actions'));
      await tester.pumpAndSettle();
      final grip = find.byIcon(Icons.drag_indicator).first;
      final gesture = await tester.startGesture(tester.getCenter(grip));
      await tester.pump(const Duration(milliseconds: 600));
      await gesture.moveBy(const Offset(290, 0));
      await tester.pump(const Duration(milliseconds: 600));
      await gesture.up();
      await tester.pumpAndSettle();
      expect(sent.last, {'op': 'move', 'id': 'a'});
      expect(tester.takeException(), isNull);
    });
  }
}
