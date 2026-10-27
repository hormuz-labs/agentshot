import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/steps.dart';
import 'package:agentshot_mobile/ui/mascot.dart';

Json call(String id, String name, String title, {String? detail}) => {
  'id': id,
  'type': 'function',
  'function': {'name': name, 'arguments': '{}'},
  'title': title,
  'detail': ?detail,
};

final turn = <Json>[
  {'id': 'u1', 'role': 'user', 'content': 'How many bugs did we run?'},
  {
    'id': 'a1',
    'role': 'assistant',
    'toolCalls': [
      call(
        'c1',
        'bash',
        'grep batches',
        detail: r'$ grep -E "=== batch" log.txt',
      ),
    ],
  },
  {
    'id': 't1',
    'role': 'tool',
    'toolCallId': 'c1',
    'content': '=== batch 1/36: 10 bugs\n=== batch 2/36: 10 bugs',
  },
  {
    'id': 'a2',
    'role': 'assistant',
    'toolCalls': [
      call('c2', 'read', 'Read results.json'),
      call('c3', 'look', 'Looked at IMG_1.jpg'),
    ],
  },
  {
    'id': 't2',
    'role': 'tool',
    'toolCallId': 'c2',
    'content': '{"plausible": 55}',
  },
  {
    'id': 't3',
    'role': 'tool',
    'toolCallId': 'c3',
    'content': 'no such file',
    'error': 'tool error',
    'hint': 'That picture isn’t in the project.',
  },
  {
    'id': 'a3',
    'role': 'assistant',
    'content': '71 distinct bugs have run.',
    'toolCalls': [call('c4', 'project_state', 'Looked at the project')],
  },
  {'id': 't4', 'role': 'tool', 'toolCallId': 'c4', 'content': 'ok'},
  {'id': 'a4', 'role': 'assistant', 'content': 'Done.'},
];

void main() {
  test(
    'the steps between two things said fold into one run; what was said stays in order',
    () {
      final items = fold(turn);
      expect(
        items.map(
          (i) => i is Steps
              ? 'steps×${i.steps.length}'
              : (i as Said).message['id'],
        ),
        ['u1', 'steps×3', 'a3', 'steps×1', 'a4'],
      );
      final first = (items[1] as Steps).steps;
      expect(first.map((s) => s.title), [
        'grep batches',
        'Read results.json',
        'Looked at IMG_1.jpg',
      ]);
      expect(first[0].detail, r'$ grep -E "=== batch" log.txt');
      expect(first[0].result, contains('batch 2/36'));
      expect(first[2].failed, isTrue);
      expect(first[2].hint, 'That picture isn’t in the project.');
      // a step from a computer that sends no title: its tool's name in words
      expect(
        fold([
          {
            'role': 'assistant',
            'toolCalls': [
              {
                'id': 'x',
                'function': {'name': 'brand_new_tool'},
              },
            ],
          },
        ]).whereType<Steps>().single.steps.single.title,
        'brand new tool',
      );
    },
  );

  testWidgets(
    'a run reads as the work done, in words; what went wrong says why; the commands only under Show details',
    (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (c) async {
          if (c.method == 'Clipboard.setData') {
            copied.add((c.arguments as Map)['text'] as String);
          }
          return null;
        },
      );
      final steps = (fold(turn)[1] as Steps).steps;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: StepsRow(steps: steps)),
          ),
        ),
      );
      for (final t in [
        'grep batches',
        'Read results.json',
        'Looked at IMG_1.jpg',
      ]) {
        expect(find.text(t), findsOneWidget);
      }
      expect(find.byIcon(Icons.check_rounded), findsNWidgets(2));
      expect(find.byIcon(Icons.close_rounded), findsOneWidget);
      expect(
        find.text('That picture isn’t in the project.'),
        findsOneWidget,
        reason: 'a failed step says why',
      );
      expect(
        find.textContaining('grep -E'),
        findsNothing,
        reason: 'no commands up front',
      );
      // details: each step opens to the command and its output, monospace, with Copy
      await tester.tap(find.text('Show details'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('grep batches').last);
      await tester.pumpAndSettle();
      expect(find.text(r'$ grep -E "=== batch" log.txt'), findsOneWidget);
      expect(find.textContaining('batch 2/36'), findsOneWidget);
      await tester.tap(find.byTooltip('Copy').first);
      expect(copied, [r'$ grep -E "=== batch" log.txt']);
      await tester.tap(find.text('Hide details'));
      await tester.pumpAndSettle();
      expect(find.textContaining('grep -E'), findsNothing);
    },
  );

  testWidgets(
    'while the agent works, what it does now comes first, then what it has done',
    (tester) async {
      final steps = (fold(turn)[1] as Steps).steps
        ..last.result = null
        ..last.failed = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StepsRow(steps: steps, now: 'Watching the footage'),
          ),
        ),
      );
      expect(find.text('Watching the footage…'), findsOneWidget);
      expect(
        find.byType(Mascot),
        findsOneWidget,
        reason: 'Manul runs on the now line',
      );
      expect(find.text('Looked at IMG_1.jpg'), findsNothing);
      expect(
        tester.getTopLeft(find.text('Watching the footage…')).dy,
        lessThan(tester.getTopLeft(find.text('grep batches')).dy),
      );
    },
  );
}
