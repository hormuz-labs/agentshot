import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/ui/common.dart';
import 'package:agentshot_mobile/ui/project.dart';

/// A computer whose sending fails the way the test says.
class Failing extends BridgeClient {
  Failing(this.failure);
  Object? failure;
  int sends = 0;
  @override
  Connection? get connection => Connection(
    Uri.parse('https://x:1'),
    'a' * 64,
    't',
    [],
    'm',
    'Studio iMac',
  );
  @override
  Future<Uri> media(String project, String file) async =>
      throw BridgeException('No film here');
  @override
  Future<Uri> thumbnail(String project, String file) async =>
      throw BridgeException('No picture here');
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    if (method == 'agent:send') {
      sends++;
      if (failure != null) throw failure!;
      return null;
    }
    return [];
  }
}

/// The app as the tests see it: still (reduced motion), so pumpAndSettle settles.
Widget app(Widget home) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(disableAnimations: true),
    child: child!,
  ),
  home: home,
);

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;

  test('errors read as what to do, never as the raw exception', () {
    expect(
      plain(BridgeException('Your AgentShot space is full.')),
      'Your AgentShot space is full.',
    );
    for (final raw in <Object>[
      const SocketException(
        'Connection refused',
        osError: OSError('Connection refused', 111),
      ),
      TimeoutException('x'),
      const HttpException('Connection closed before full header was received'),
      const HandshakeException('WRONG_VERSION_NUMBER'),
    ]) {
      final said = plain(raw, where: 'Studio iMac');
      expect(said, startsWith('Couldn’t reach Studio iMac.'));
      expect(said, isNot(contains('Exception')));
    }
    expect(
      plain(const SocketException('x'), where: 'AgentShot Cloud'),
      contains('this phone’s internet connection'),
    );
    expect(
      plain(const FormatException('Unexpected character')),
      contains('couldn’t read'),
    );
    expect(
      plain(StateError('Bad state: No element')),
      'Something went wrong. Try again in a moment.',
    );
  });

  testWidgets(
    'a note that didn\'t send: a card above the composer says why, keeps the note, and tries again',
    (tester) async {
      final client = Failing(
        BridgeException(
          'Couldn’t send your note. The AI service is busy right now. Wait a minute, then try again.',
        ),
      );
      final store = BridgeStore(client)..connected = true;
      store.project = {
        'dir': '/p',
        'title': 'Harbour walk',
        'notes': [],
        'media': {},
        'files': {},
        'versions': [],
        'current': '',
      };
      store.agent('/p').snapshot({'messages': []});
      await tester.pumpWidget(app(ProjectScreen(store: store)));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('composer')),
        'Tighten the opening',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pumpAndSettle();
      final problem = find.byKey(const ValueKey('problem'));
      expect(
        find.descendant(
          of: problem,
          matching: find.text('Your note didn’t send'),
        ),
        findsOneWidget,
      );
      // the reason, without the "Couldn't send your note." the title already says
      expect(
        find.descendant(
          of: problem,
          matching: find.text(
            'The AI service is busy right now. Wait a minute, then try again.',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.text('Tighten the opening'),
        findsOneWidget,
        reason: 'the note stays, to send again',
      );
      expect(find.byType(SnackBar), findsNothing);
      // the computer is fine again: Try again sends it, and the card goes
      client.failure = null;
      await tester.tap(
        find.descendant(of: problem, matching: find.text('Try again')),
      );
      await tester.pumpAndSettle();
      expect(client.sends, 2);
      expect(problem, findsNothing);
    },
  );

  testWidgets('the network\'s own error reaches the person as what to check', (
    tester,
  ) async {
    final client = Failing(const SocketException('Connection reset by peer'));
    final store = BridgeStore(client)..connected = true;
    store.project = {
      'dir': '/p',
      'title': 'Harbour walk',
      'notes': [],
      'media': {},
      'files': {},
      'versions': [],
      'current': '',
    };
    store.agent('/p').snapshot({'messages': []});
    await tester.pumpWidget(app(ProjectScreen(store: store)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('composer')), 'Hi');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Couldn’t reach your computer'), findsOneWidget);
    expect(find.textContaining('SocketException'), findsNothing);
  });

  testWidgets(
    'every file in Files has its picture spot and length; one with no picture shows its kind',
    (tester) async {
      final store = BridgeStore(Failing(null))..connected = true;
      store.project = {
        'dir': '/p',
        'title': 'Harbour walk',
        'notes': [],
        'media': {
          'media/surf.mp4': {'duration': 12.4, 'width': 1280, 'height': 720},
          'media/song.mp3': {'duration': 64},
        },
        'files': {
          'media/surf.mp4': {
            'kind': 'video',
            'summary': 'video 1280×720, 0:12',
          },
          'media/song.mp3': {'kind': 'audio', 'summary': 'audio 1:04'},
          'media/notes.md': {'kind': 'text', 'summary': 'a note'},
        },
        'versions': [],
        'current': '',
      };
      store.agent('/p').snapshot({'messages': []});
      await tester.pumpWidget(app(ProjectScreen(store: store)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('tab-Files')));
      await tester.pumpAndSettle();
      for (final rel in [
        'media/surf.mp4',
        'media/song.mp3',
        'media/notes.md',
      ]) {
        expect(
          find.descendant(
            of: find.byKey(ValueKey('file-$rel')),
            matching: find.byType(FileThumb),
          ),
          findsOneWidget,
          reason: rel,
        );
      }
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('file-media/surf.mp4')),
          matching: find.text('0:12'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('file-media/song.mp3')),
          matching: find.text('1:04'),
        ),
        findsOneWidget,
      );
      // no picture could come (here): the kind's icon in its place, nothing broken
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('file-media/surf.mp4')),
          matching: find.byIcon(Icons.movie_outlined),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('file-media/notes.md')),
          matching: find.byIcon(Icons.insert_drive_file_outlined),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a problem card: what, why, Try again, Dismiss', (tester) async {
    var retried = 0, dismissed = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProblemCard(
            title: 'Couldn’t add clip.mov',
            error: BridgeException(
              'Couldn’t add the file. This file can’t be read: it may be damaged.',
            ),
            onRetry: () => retried++,
            onDismiss: () => dismissed++,
          ),
        ),
      ),
    );
    expect(find.text('Couldn’t add clip.mov'), findsOneWidget);
    expect(
      find.text('This file can’t be read: it may be damaged.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Try again'));
    await tester.tap(find.byTooltip('Dismiss'));
    expect((retried, dismissed), (1, 1));
  });
}
