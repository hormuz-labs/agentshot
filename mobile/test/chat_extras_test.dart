import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/notify.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/ui/markdown.dart';
import 'package:agentshot_mobile/ui/project.dart';
import 'package:agentshot_mobile/ui/settings.dart';
import 'package:agentshot_mobile/ui/timed.dart';

class Quiet extends BridgeClient {
  final sent = <List<dynamic>>[];
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
  Future<Uri> media(String p, String f) async =>
      throw BridgeException('no film');
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    if (method == 'agent:send') sent.add(args);
    return [];
  }
}

Widget app(Widget home) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(disableAnimations: true),
    child: child!,
  ),
  home: home,
);

List<Json> talk(int turns) => [
  for (var i = 0; i < turns; i++) ...[
    {
      'id': 'u$i',
      'role': 'user',
      'content': 'Note number $i',
      'at': DateTime(2026, 10, 27, 9, i).millisecondsSinceEpoch,
    },
    {
      'id': 'a$i',
      'role': 'assistant',
      'content':
          'Reply number $i.\n\nA second paragraph so the reply takes some room on the screen.\n\nAnd a third.',
      'at': DateTime(2026, 10, 27, 9, i, 30).millisecondsSinceEpoch,
    },
  ],
];

BridgeStore storeWith(Quiet c, List<Json> messages, {bool busy = false}) {
  final store = BridgeStore(c)..connected = true;
  store.project = {
    'dir': '/p',
    'title': 'Harbour walk',
    'notes': [],
    'media': {},
    'files': {},
    'versions': [],
    'current': '',
  };
  store.agent('/p').snapshot({'messages': messages, 'busy': busy});
  return store;
}

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;

  testWidgets(
    'scrolled up: Jump to latest takes you back down; the note being answered is pinned on top',
    (tester) async {
      final store = storeWith(Quiet(), talk(10));
      await tester.pumpWidget(app(ProjectScreen(store: store)));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('jump-to-latest')),
        findsNothing,
        reason: 'at the end: no pill',
      );
      // reading further up
      await tester.drag(find.byType(ListView).first, const Offset(0, 900));
      await tester.pumpAndSettle();
      expect(find.text('Jump to latest'), findsOneWidget);
      // a reply's note scrolled off the top is pinned
      await tester.drag(find.byType(ListView).first, const Offset(0, -260));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('pinned-note')), findsOneWidget);
      await tester.tap(find.text('Jump to latest'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('jump-to-latest')), findsNothing);
      expect(find.text('Reply number 9.', findRichText: true), findsWidgets);
    },
  );

  testWidgets('swiping sideways shows when each was said', (tester) async {
    final store = storeWith(Quiet(), talk(1));
    await tester.pumpWidget(app(ProjectScreen(store: store)));
    await tester.pumpAndSettle();
    expect(find.text('09:00'), findsNothing);
    final swipe = await tester.startGesture(
      tester.getCenter(find.text('Note number 0')),
    );
    await swipe.moveBy(const Offset(-30, 0));
    await swipe.moveBy(const Offset(-80, 0));
    await tester.pump();
    // the note and its reply, both said at 9:00
    expect(find.text('09:00'), findsNWidgets(2));
    await swipe.up();
    await tester.pump();
    expect(find.text('09:00'), findsNothing, reason: 'let go: they slide back');
  });

  test('times read as today, this week, or a date', () {
    final now = DateTime(2026, 10, 27, 12);
    expect(Timed.when(DateTime(2026, 10, 27, 9, 5), now), '09:05');
    expect(Timed.when(DateTime(2026, 10, 25, 18, 0), now), 'Sun 18:00');
    expect(Timed.when(DateTime(2026, 10, 3, 7, 30), now), '3 Oct 07:30');
  });

  testWidgets(
    'a note sent while the agent works is queued until it shows in the conversation',
    (tester) async {
      final c = Quiet();
      final store = storeWith(c, talk(1), busy: true);
      await tester.pumpWidget(app(ProjectScreen(store: store)));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(
        find.byKey(const ValueKey('composer')),
        'Also warm up the colours',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(c.sent, hasLength(1));
      expect(find.text('Queued · the agent reads it next'), findsOneWidget);
      // it reached the conversation: just a note now
      store.agent('/p').snapshot({
        'messages': [
          ...talk(1),
          {'id': 'u9', 'role': 'user', 'content': 'Also warm up the colours'},
        ],
        'busy': true,
      });
      store.project = {...store.project!};
      await tester.pumpWidget(
        app(ProjectScreen(store: store, key: UniqueKey())),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Queued · the agent reads it next'), findsNothing);
    },
  );

  testWidgets('a code block: its language, Copy, and a long one in full', (
    tester,
  ) async {
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
    final code = List.generate(20, (i) => 'line $i').join('\n');
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Markdown('Here:\n\n```python\n$code\n```'),
          ),
        ),
      ),
    );
    expect(find.text('python'), findsOneWidget);
    expect(find.text('Show all 20 lines'), findsOneWidget);
    await tester.tap(find.byTooltip('Copy'));
    expect(copied.single, code);
    await tester.tap(find.text('Show all 20 lines'));
    await tester.pumpAndSettle();
    expect(find.textContaining('line 19'), findsOneWidget);
  });

  test('a project\'s status: needs an OK, working, a reply not seen yet', () {
    final store = BridgeStore(Quiet());
    store.agent('/a').snapshot({'messages': talk(1)});
    store.markSeen('/a');
    expect(store.statusOf('/a'), isNull);
    store.agent('/a').snapshot({'messages': talk(2)});
    expect(store.statusOf('/a'), 'New reply');
    store.agent('/a').snapshot({'messages': talk(2), 'busy': true});
    expect(store.statusOf('/a'), 'Working…');
    store.consents = [
      {'id': 'c', 'project': '/a', 'title': 'Download?'},
    ];
    expect(store.statusOf('/a'), 'Needs your OK');
    expect(store.statusOf('/never-heard-of'), isNull);
  });

  testWidgets(
    'notifications can be turned off one kind at a time, and stay so',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final store = BridgeStore(Quiet())..connected = true;
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(
        app(
          Scaffold(
            body: SettingsScreen(
              store: store,
              theme: ThemeMode.system,
              onTheme: (_) {},
              onDisconnect: () async {},
              onSignOut: () async {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Notifications'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('notify-jobs')));
      await tester.pumpAndSettle();
      expect(NotifyPrefs.on['jobs'], isFalse);
      expect(
        (await SharedPreferences.getInstance()).getBool('notify.jobs'),
        isFalse,
      );
      expect(NotifyPrefs.on['done'], isTrue);
    },
  );
}
