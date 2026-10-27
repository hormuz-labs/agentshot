import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/ask_card.dart';
import 'package:agentshot_mobile/ui/steps.dart';

Json ask(String id, String args) => {
  'id': 'a$id',
  'role': 'assistant',
  'toolCalls': [
    {
      'id': id,
      'type': 'function',
      'function': {'name': 'ask_user', 'arguments': args},
    },
  ],
};

Future<List<String>> show(WidgetTester tester, List<Question> qs, {bool answered = false}) async {
  final sent = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: AskCard(questions: qs, answered: answered, onAnswer: sent.add),
        ),
      ),
    ),
  );
  return sent;
}

void main() {
  test('the conversation shows what the agent asks, answered once a note follows', () {
    final chat = fold([
      {'id': 'u1', 'role': 'user', 'content': 'Make it punchier'},
      ask('c1', '{"question":"How short?","options":[{"label":"30s"},{"label":"60s"}]}'),
      {'id': 'u2', 'role': 'user', 'content': '30s'},
      ask('c2', '{"questions":[{"question":"Music?","options":[{"label":"Yes"},{"label":"No"}]},'
          '{"question":"Captions?","options":[{"label":"Yes"},{"label":"No"}]}]}'),
    ]);
    final asked = chat.whereType<Asked>().toList();
    expect(asked, hasLength(2));
    expect(chat.whereType<Steps>(), isEmpty); // not a step
    expect(asked[0].questions.single.options.map((o) => o.$1), ['30s', '60s']);
    expect(asked[0].answered, isTrue);
    expect(asked[1].answered, isFalse);
    expect(asked[1].questions.map((q) => q.question), ['Music?', 'Captions?']);
  });

  test('a demo layout that comes back with questions asks them', () {
    final chat = fold([
      {
        'id': 'a1',
        'role': 'assistant',
        'toolCalls': [
          {'id': 'd1', 'function': {'name': 'demo_layout', 'arguments': '{}'}},
        ],
      },
      {
        'id': 't1',
        'role': 'tool',
        'toolCallId': 'd1',
        'content': '{"questions":[{"question":"Camera where?","options":[{"label":"Left"},{"label":"Right"}]}]}',
      },
    ]);
    expect(chat.whereType<Asked>().single.questions.single.question, 'Camera where?');
  });

  testWidgets('one plain question answers with a tap', (tester) async {
    final sent = await show(tester, [
      const Question('How short?', [('30s', null), ('60s', 'Room to breathe')]),
    ]);
    await tester.tap(find.text('60s'));
    expect(sent, ['60s']);
    await tester.tap(find.text('You decide'));
    expect(sent.last, youDecide);
  });

  testWidgets('a checklist starts all ticked; Apply sends what stays ticked', (tester) async {
    final sent = await show(tester, [
      const Question('Which fixes?', [('Trim', null), ('Music', null), ('Captions', null)], multiple: true),
    ]);
    expect(find.text('Apply all'), findsOneWidget);
    await tester.tap(find.text('Music'));
    await tester.pump();
    await tester.tap(find.text('Apply 2'));
    expect(sent, ['Apply: Trim; Captions']);
    await tester.tap(find.text('None'));
    expect(sent.last, 'None of these.');
  });

  testWidgets('several questions: a pick each, then Go', (tester) async {
    final sent = await show(tester, [
      const Question('Music?', [('Yes', null), ('No', null)]),
      const Question('Captions?', [('On', null), ('Off', null)]),
    ]);
    await tester.tap(find.text('Off'));
    await tester.pump();
    await tester.tap(find.text('Go'));
    expect(sent, ['Music? → Yes\nCaptions? → Off']);
  });

  testWidgets('answered: shown, nothing to answer again', (tester) async {
    final sent = await show(tester, [
      const Question('How short?', [('30s', null), ('60s', null)]),
    ], answered: true);
    expect(find.text('You decide'), findsNothing);
    await tester.tap(find.text('30s'));
    expect(sent, isEmpty);
  });
}
