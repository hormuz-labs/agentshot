import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/ui/composer.dart';

/// A microphone that "records" a file and reports a steady level.
class FakeMic implements VoiceRecorder {
  FakeMic({this.allowed = true});
  final bool allowed;
  bool cancelled = false, stopped = false;
  final levels = StreamController<double>.broadcast();
  @override
  Future<bool> start() async {
    if (allowed) {
      Timer.periodic(
        const Duration(milliseconds: 90),
        (t) => levels.isClosed ? t.cancel() : levels.add(.6),
      );
    }
    return allowed;
  }

  @override
  Stream<double> get level => levels.stream;
  @override
  Future<File?> stop() async {
    stopped = true;
    final f = File(
      '${Directory.systemTemp.path}/note-${DateTime.now().microsecondsSinceEpoch}.m4a',
    )..writeAsStringSync('audio');
    return f;
  }

  @override
  Future<void> cancel() async => cancelled = true;
  @override
  void dispose() => levels.close();
}

void main() {
  late FakeMic mic;
  late TextEditingController text;
  late List<String> heard;
  Object? failure;
  final errors = <Object>[];
  var sent = 0, stopped = 0;

  Widget composer({bool busy = false, Future<String> Function(File)? hear}) =>
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: StatefulBuilder(
              builder: (context, set) => Composer(
                controller: text,
                header: const [Text('Automatic')],
                tray: [
                  ActionChip(
                    label: const Text('Attach files'),
                    onPressed: () {},
                  ),
                ],
                busy: busy,
                sending: false,
                canSend: true,
                onSend: () => sent++,
                onStop: () => stopped++,
                onChanged: (_) => set(() {}),
                hear:
                    hear ??
                    (f) async {
                      heard.add(f.path);
                      if (failure != null) throw failure!;
                      return 'Tighten the opening';
                    },
                onVoiceError: (e, _) => errors.add(e),
              ),
            ),
          ),
        ),
      );

  setUp(() {
    mic = FakeMic();
    VoiceRecorder.override = () => mic;
    text = TextEditingController();
    heard = [];
    failure = null;
    errors.clear();
    sent = stopped = 0;
  });
  tearDown(() => VoiceRecorder.override = null);

  testWidgets(
    'hold the mic, talk, let go: the words land in the field, to check before sending',
    (tester) async {
      await tester.pumpWidget(composer());
      expect(
        find.byTooltip('Send'),
        findsNothing,
        reason: 'nothing typed: the mic',
      );
      final hold = await tester.startGesture(
        tester.getCenter(find.byKey(const ValueKey('mic'))),
      );
      await tester.pump(const Duration(milliseconds: 600)); // a long press
      await tester.pump(const Duration(milliseconds: 900));
      expect(find.byKey(const ValueKey('recording')), findsOneWidget);
      expect(find.text('‹ Slide to cancel'), findsOneWidget);
      expect(find.byType(Waveform), findsOneWidget);
      await hold.up();
      await tester.pumpAndSettle();
      expect(mic.stopped, isTrue);
      expect(heard, hasLength(1));
      expect(text.text, 'Tighten the opening');
      expect(
        find.byTooltip('Send'),
        findsOneWidget,
        reason: 'now there is text: Send',
      );
      // a second note adds to what's there
      final again = await tester.startGesture(
        tester.getCenter(find.byTooltip('Send')),
      );
      await again.up();
      expect(sent, 1);
    },
  );

  testWidgets('slide left to cancel: nothing is sent to be heard', (
    tester,
  ) async {
    await tester.pumpWidget(composer());
    final hold = await tester.startGesture(
      tester.getCenter(find.byKey(const ValueKey('mic'))),
    );
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 900));
    await hold.moveBy(const Offset(-160, 0));
    await tester.pump();
    expect(find.text('Let go to cancel'), findsOneWidget);
    await hold.up();
    await tester.pumpAndSettle();
    expect(mic.cancelled, isTrue);
    expect(heard, isEmpty);
    expect(text.text, isEmpty);
  });

  testWidgets('a tap is not a note: it says how', (tester) async {
    await tester.pumpWidget(composer());
    final hold = await tester.startGesture(
      tester.getCenter(find.byKey(const ValueKey('mic'))),
    );
    await tester.pump(
      const Duration(milliseconds: 520),
    ); // just a long press, let go at once
    await hold.up();
    await tester.pumpAndSettle();
    expect(heard, isEmpty);
    expect(
      find.text('Hold the mic while you talk, then let go.'),
      findsOneWidget,
    );
  });

  testWidgets(
    'a note that couldn\'t be heard is handed back with why (to try again)',
    (tester) async {
      failure = Exception('speech recognition is not installed');
      await tester.pumpWidget(composer());
      final hold = await tester.startGesture(
        tester.getCenter(find.byKey(const ValueKey('mic'))),
      );
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 900));
      await hold.up();
      await tester.pumpAndSettle();
      expect(errors, hasLength(1));
      expect(text.text, isEmpty);
      // tried again (as the card's Try again does): heard this time
      failure = null;
      final state = tester.state<ComposerState>(find.byType(Composer));
      await state.hear(File(heard.single));
      await tester.pumpAndSettle();
      expect(text.text, 'Tighten the opening');
    },
  );

  testWidgets('no microphone allowed: it says so', (tester) async {
    mic = FakeMic(allowed: false);
    await tester.pumpWidget(composer());
    final hold = await tester.startGesture(
      tester.getCenter(find.byKey(const ValueKey('mic'))),
    );
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    await hold.up();
    await tester.pumpAndSettle();
    expect(find.textContaining('Allow the microphone'), findsOneWidget);
  });

  testWidgets('> opens the tray; while the agent works, Stop', (tester) async {
    await tester.pumpWidget(composer(busy: true));
    expect(find.text('Attach files'), findsNothing);
    await tester.tap(find.byTooltip('Add'));
    await tester.pumpAndSettle();
    expect(find.text('Attach files'), findsOneWidget);
    await tester.tap(find.byTooltip('Stop'));
    expect(stopped, 1);
  });
}
