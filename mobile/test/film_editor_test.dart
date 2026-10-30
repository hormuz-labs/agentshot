// The film as the project's screen on a phone: a note is written in a small bubble right where it points and goes to
// the agent with its moment; notes are pins that open to the agent's answer; a new cut is kept or sent back on the
// film; the conversation is one tap away.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/ui/film_editor.dart';
import 'package:agentshot_mobile/ui/steps.dart';

void main() {
  late List<(String, Json?)> notes;
  late List<List<(String, Json?)>> batches;
  late List<String> did;

  Widget editor({
    bool newCut = false,
    List<Json> given = const [],
    String? working,
    List<String> suggestions = const [],
  }) => MaterialApp(
    home: Scaffold(
      body: FilmEditor(
        title: 'Harbour walk',
        // no video in a test: everything around the picture still works
        film: () async => Uri.parse('http://127.0.0.1:1/film.mp4'),
        proposal: newCut
            ? () async => Uri.parse('http://127.0.0.1:1/new.mp4')
            : null,
        notes: given,
        working: working,
        suggestions: suggestions,
        onNote: (text, at) async => notes.add((text, at)),
        onBatch: (all) async => batches.add(all),
        onActivity: () => did.add('activity'),
        onKeep: () => did.add('keep'),
        onSendBack: () => did.add('sendBack'),
        onBack: () => did.add('back'),
        menu: const [('files', 'Files', Icons.folder_outlined)],
        onAction: did.add,
      ),
    ),
  );

  // the picture's spinner never stops without a video: frames, not "settled"
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  setUp(() {
    notes = [];
    batches = [];
    did = [];
  });

  testWidgets(
    'Note: a small bubble at the moment, sent with it, pinned at once',
    (tester) async {
      await tester.pumpWidget(editor());
      await settle(tester);
      expect(find.byKey(const ValueKey('editor-bubble')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('editor-note-tool')));
      await settle(tester);
      expect(find.byKey(const ValueKey('editor-bubble')), findsOneWidget);
      expect(find.text('At 0:00'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('editor-words')),
        'Hold this shot longer',
      );
      await tester.tap(find.byKey(const ValueKey('editor-send')));
      await settle(tester);
      expect(notes.single.$1, 'Hold this shot longer');
      expect(notes.single.$2, {'t0': 0.0});
      // the bubble closes; the note is a pin already
      expect(find.byKey(const ValueKey('editor-bubble')), findsNothing);
      expect(find.byKey(const ValueKey('editor-pin-0')), findsOneWidget);
    },
  );

  testWidgets('Ask: a note for the whole film, with no moment', (tester) async {
    await tester.pumpWidget(editor());
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('editor-ask-tool')));
    await settle(tester);
    expect(find.text('The whole film'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('editor-words')),
      'Make it shorter',
    );
    await tester.tap(find.byKey(const ValueKey('editor-send')));
    await settle(tester);
    expect(notes.single, ('Make it shorter', null));
  });

  testWidgets('a pin opens to what was asked and the agent\'s answer', (
    tester,
  ) async {
    await tester.pumpWidget(
      editor(
        given: [
          {
            'text': 'Blur the laptop',
            'anchor': {'t0': 2},
            'status': 'resolved',
            'reply': 'Blurred it from 0:02 to 0:05.',
          },
        ],
      ),
    );
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('editor-pin-0')));
    await settle(tester);
    expect(find.byKey(const ValueKey('editor-note')), findsOneWidget);
    expect(find.text('Blur the laptop'), findsOneWidget);
    expect(find.text('Blurred it from 0:02 to 0:05.'), findsOneWidget);
    expect(find.text('0:02 · Done'), findsOneWidget);
  });

  testWidgets('a new cut: Before / After, Keep and Send back on the film', (
    tester,
  ) async {
    await tester.pumpWidget(editor(newCut: true));
    await settle(tester);
    expect(find.byKey(const ValueKey('editor-before-after')), findsOneWidget);
    expect(find.byKey(const ValueKey('editor-note-tool')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('editor-keep')));
    await tester.tap(find.byKey(const ValueKey('editor-send-back')));
    expect(did, ['keep', 'sendBack']);
  });

  testWidgets(
    'what the agent is doing shows at the top, and opens the conversation',
    (tester) async {
      await tester.pumpWidget(editor(working: 'Rendering the new cut'));
      await settle(tester);
      expect(find.text('Rendering the new cut'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('editor-activity')));
      expect(did, ['activity']);
    },
  );

  test(
    'a box is at its moment only: gone a frame on, and across its range',
    () {
      expect(atItsMoment({'t0': 4}, 4.0), isTrue);
      expect(
        atItsMoment({'t0': 4}, 4.04),
        isTrue,
        reason: 'where the seek landed',
      );
      expect(atItsMoment({'t0': 4}, 4.2), isFalse, reason: 'the next frames');
      expect(atItsMoment({'t0': 4}, 3.8), isFalse);
      expect(atItsMoment({'t0': 4, 't1': 6}, 5.0), isTrue);
      expect(atItsMoment({'t0': 4, 't1': 6}, 6.2), isFalse);
    },
  );

  testWidgets('notes kept with + wait in the tray, and go together', (
    tester,
  ) async {
    await tester.pumpWidget(editor());
    await settle(tester);
    expect(find.byKey(const ValueKey('editor-tray')), findsNothing);

    Future<void> note(String words) async {
      await tester.tap(find.byKey(const ValueKey('editor-note-tool')));
      await settle(tester);
      await tester.enterText(find.byKey(const ValueKey('editor-words')), words);
      await tester.tap(find.byKey(const ValueKey('editor-add')));
      await settle(tester);
    }

    await note('Hold this shot');
    await note('Brighter here');
    expect(find.text('2 notes ready'), findsOneWidget);
    expect(notes, isEmpty, reason: 'nothing sent yet');
    // each is pinned already, and can be taken out
    await tester.tap(find.byKey(const ValueKey('editor-pin-1')));
    await settle(tester);
    expect(find.text('Brighter here'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('editor-remove-note')));
    await settle(tester);
    expect(find.text('1 note ready'), findsOneWidget);

    await note('Warmer colours');
    await tester.tap(find.byKey(const ValueKey('editor-send-all')));
    await settle(tester);
    expect(batches.single.map((n) => n.$1), [
      'Hold this shot',
      'Warmer colours',
    ]);
    expect(find.byKey(const ValueKey('editor-tray')), findsNothing);
  });

  testWidgets('a note sent with some kept goes with them', (tester) async {
    await tester.pumpWidget(editor());
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('editor-note-tool')));
    await settle(tester);
    await tester.enterText(find.byKey(const ValueKey('editor-words')), 'One');
    await tester.tap(find.byKey(const ValueKey('editor-add')));
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('editor-ask-tool')));
    await settle(tester);
    await tester.enterText(find.byKey(const ValueKey('editor-words')), 'Two');
    await tester.tap(find.byKey(const ValueKey('editor-send')));
    await settle(tester);
    expect(batches.single.map((n) => n.$1), ['One', 'Two']);
  });

  testWidgets('what the agent offers: a tap sends it, and it goes', (
    tester,
  ) async {
    await tester.pumpWidget(editor(suggestions: ['Tighten the long pauses']));
    await settle(tester);
    await tester.tap(find.text('Tighten the long pauses'));
    await settle(tester);
    expect(notes.single, ('Tighten the long pauses', null));
    expect(find.text('Tighten the long pauses'), findsNothing);
  });

  testWidgets('nothing offered while the agent works', (tester) async {
    await tester.pumpWidget(
      editor(suggestions: ['Add captions'], working: 'Rendering'),
    );
    await settle(tester);
    expect(find.text('Add captions'), findsNothing);
  });

  test(
    'offers come from the agent\'s latest turn, until the person speaks',
    () {
      Json offered(List<String> s) => {
        'role': 'assistant',
        'toolCalls': [
          {
            'id': 'c1',
            'function': {
              'name': 'suggest_next',
              'arguments': '{"suggestions":${s.map((x) => '"$x"').toList()}}',
            },
          },
        ],
      };
      final turn = offered(['Tighten the pauses', 'Add captions']);
      expect(suggestionsOf([turn]), ['Tighten the pauses', 'Add captions']);
      expect(
        suggestionsOf([
          turn,
          {'role': 'assistant', 'content': 'Done.'},
        ]),
        ['Tighten the pauses', 'Add captions'],
        reason: 'the reply after it',
      );
      expect(
        suggestionsOf([
          turn,
          {'role': 'user', 'content': 'Keep the first one'},
        ]),
        isEmpty,
      );
    },
  );

  test('notes given together read as they were written', () {
    expect(
      asSaid(
        'These notes go together: make all of them, then one new cut.\n'
        '[note ab1 @ 0:04, box 0.1,0.1,0.2,0.2] Blur this\nMake it shorter',
      ),
      '0:04, box 0.1,0.1,0.2,0.2: Blur this\nMake it shorter',
    );
    expect(asSaid('Plain words'), 'Plain words');
  });
}
