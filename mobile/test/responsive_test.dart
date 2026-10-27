import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/main.dart';
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/ui/computers.dart';
import 'package:agentshot_mobile/ui/home.dart';
import 'package:agentshot_mobile/ui/pair.dart';
import 'package:agentshot_mobile/ui/project.dart';
import 'package:agentshot_mobile/ui/settings.dart';

class FakeClient extends BridgeClient {
  // no film to stream here: the players say so (and offer to retry)
  @override
  Future<Uri> media(String project, String file) async =>
      throw BridgeException('No film in this test');
  @override
  Future<Uri> thumbnail(String project, String file) async =>
      throw BridgeException('No pictures in this test');
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    return switch (method) {
      'skills:state' => {
        'profile': {'id': 'default'},
        'profiles': [
          {'id': 'default', 'name': 'Default'},
        ],
        'skills': [],
        'enabled': [],
      },
      'browser:state' => {
        'tabs': [],
        'bsk': {'status': 'connected'},
      },
      'browser:mode' => 'manul',
      'providers:list' => {'providers': []},
      'account:status' => {'available': false},
      'whisper:status' => {'active': null},
      'account:balance' => {'credits': 716824},
      // a model whose name is far too long for the composer: it must be cut short, not overflow
      'agent:models' => {
        'current': {'modelId': 'long'},
        'models': [
          {
            'modelId': 'long',
            'name': 'A Remarkably Long Experimental Model Name Preview 2026',
          },
        ],
      },
      _ => [],
    };
  }
}

/// Signed in, with two computers on (one with a long name) and no network.
class FakeAccount extends Account {
  FakeAccount() : super(browser: (_) async => '') {
    email = 'maya@example.com';
    key = 'k';
  }
  @override
  Future<Json> balance() async => {
    'credits': 12345,
    'plan': {'name': 'Pro'},
  };

  /// How leasing AgentShot Cloud goes: never answering (the finding step stays up) or busy.
  Future<Computer> Function() leasing = () => Completer<Computer>().future;
  @override
  Future<Computer> lease() => leasing();

  @override
  Future<List<Computer>> computers() async {
    poolFree = 2;
    return _computers();
  }

  List<Computer> _computers() => [
    for (final (id, name, platform) in [
      ('a', 'Studio iMac', 'darwin'),
      (
        'b',
        'Maya’s very long named Windows workstation in the edit suite',
        'win32',
      ),
    ])
      Computer.fromJson({
        'id': id,
        'name': name,
        'urls': ['https://192.168.1.20:47821'],
        'fingerprint': 'a' * 64,
        'token': 'lease.1.x.y',
        'capabilities': {'platform': platform},
      }),
  ];
}

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;
  for (final size in [
    const Size(320, 568),
    const Size(390, 844),
    const Size(844, 390),
    const Size(768, 1024),
    const Size(1366, 768),
  ]) {
    for (final scale in [1.0, 2.0, 3.0]) {
      testWidgets('pair/home/project ${size.width}x${size.height} text $scale', (
        tester,
      ) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final client = FakeClient();
        final store = BridgeStore(client)..connected = true;
        addTearDown(store.dispose);
        addTearDown(client.dispose);
        Widget host(Widget child) => MaterialApp(
          theme: agentShotTheme(Brightness.light),
          builder: (context, widget) => MediaQuery(
            data:
                MediaQuery.of(
                  context,
                  // still Manul (reduced motion): pumpAndSettle can settle
                ).copyWith(
                  textScaler: TextScaler.linear(scale),
                  disableAnimations: true,
                ),
            child: widget!,
          ),
          home: child,
        );
        await tester.pumpWidget(
          host(
            PairScreen(
              client: client,
              onPaired: () {},
              onSignIn: () async {},
              codes: true,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(
          host(
            ComputersScreen(
              account: FakeAccount(),
              client: client,
              onConnected: () {},
              onSignOut: () async {},
              onCodes: () {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'Your computers');
        expect(find.text('12,345 credits · Pro plan'), findsOneWidget);
        // tiny phones with large text scroll to the computers
        await tester.scrollUntilVisible(find.text('Studio iMac'), 120);
        expect(tester.takeException(), isNull);
        // AgentShot Cloud: the card, then its steps (finding a spot; and when it's busy, why, and Try again)
        final cloud = find.byKey(const ValueKey('agentshot-cloud'));
        // on a tiny phone with huge text the card is taller than the screen: its title is what's tapped
        final title = find.descendant(
          of: cloud,
          matching: find.text('AgentShot Cloud'),
        );
        await tester.scrollUntilVisible(title, 120);
        await tester.ensureVisible(title);
        await tester.pumpAndSettle();
        await tester.tap(title);
        // a progress bar runs while it looks: frames, not settling
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(find.text('Finding a spot in AgentShot Cloud…'), findsOneWidget);
        expect(
          tester.takeException(),
          isNull,
          reason: 'AgentShot Cloud, finding',
        );
        // a fresh app for the next screen (the one above stays pushed otherwise)
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(
          host(
            CloudScreen(
              account: FakeAccount()
                ..leasing = () async => throw BridgeException(
                  'AgentShot Cloud is busy right now. Try again in a minute.',
                  404,
                ),
              client: client,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Try again'), findsOneWidget);
        expect(tester.takeException(), isNull, reason: 'AgentShot Cloud, busy');
        await tester.pumpWidget(
          host(
            HomeScreen(
              store: store,
              theme: ThemeMode.system,
              onTheme: (_) {},
              onDisconnect: () async {},
              onSignOut: () async {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final label in ['Examples', 'Activity', 'Settings']) {
          final destination = find.text(label).last;
          await tester.ensureVisible(destination);
          await tester.tap(destination);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: label);
        }
        store.project = {
          'dir': '/project',
          'title': 'A very long project title that must fit small screens',
          'notes': [
            {
              'text':
                  'Keep the opening shot a little longer before the title appears.',
              'status': 'open',
              'anchor': {'t0': 2},
            },
          ],
          'media': {},
          // a new cut waiting: the conversation shows it, the Film tab has a dot
          'versions': [
            {
              'id': 'v1',
              'title': 'Original',
              'path': 'media/opening.mp4',
              'by': 'import',
            },
            {
              'id': 'v2',
              'title':
                  'Cut the ums, tightened the opening and moved the title card',
              'path': 'renders/v2.mp4',
              'by': 'agent',
            },
          ],
          'current': 'v1',
          'proposal': 'v2',
          'files': {
            'media/a-long-original-filename-for-the-opening-shot.mp4': {
              'kind': 'video',
              'summary': 'Opening shot from the original camera footage.',
            },
          },
          'timeline': {
            'items': [
              {
                'id': 'one',
                'kind': 'media',
                'src': 'media/opening.mp4',
                'in': 0,
                'out': 10,
              },
            ],
          },
        };
        await tester.pumpWidget(host(ProjectScreen(store: store)));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const ValueKey('proposal-card')), findsOneWidget);
        // to watch and download right there
        expect(find.byKey(const ValueKey('cut-play')), findsOneWidget);
        expect(find.byKey(const ValueKey('cut-download')), findsOneWidget);
        final dot = find.byKey(const ValueKey('tab-Film-dot'));
        if (dot.evaluate().isNotEmpty) {
          expect(tester.widget<Badge>(dot).isLabelVisible, isTrue);
        }
        // the model and credits sit in the top row, above the field, the model's long name cut short; with
        // nothing typed the button on the right is the mic (hold to talk)
        final model = tester.getRect(find.byKey(const ValueKey('model')));
        final field = tester.getRect(find.byKey(const ValueKey('composer')));
        expect(model.width, lessThanOrEqualTo(200));
        expect(model.bottom, lessThanOrEqualTo(field.top + 1));
        expect(find.byKey(const ValueKey('mic')), findsOneWidget);
        expect(find.byTooltip('Send'), findsNothing);
        // picking a model works: the picker closes cleanly with no error
        // (with very large text on a short screen the composer scrolls)
        await tester.ensureVisible(find.byKey(const ValueKey('model')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('model')));
        await tester.pumpAndSettle();
        // the picker scrolls too, when the text is very large
        await tester.scrollUntilVisible(
          find.text('Automatic'),
          100,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Automatic').last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'Choosing a model');
        // picked: the picker closed
        expect(find.text('Choose a model'), findsNothing);
        // Simulate keyboard in a short viewport; composer must remain scrollable.
        tester.view.viewInsets = FakeViewPadding(bottom: size.height * .42);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        tester.view.resetViewInsets();
        await tester.pumpAndSettle();
        for (final label in ['Film', 'Files']) {
          final chip = find.byKey(ValueKey('tab-$label'));
          if (chip.evaluate().isEmpty) continue;
          await tester.ensureVisible(chip);
          await tester.tap(chip);
          // the film loads (its spinner never settles here): frames instead
          for (var i = 0; i < 5; i++) {
            await tester.pump(const Duration(milliseconds: 100));
          }
          expect(tester.takeException(), isNull, reason: label);
        }
        await tester.pumpWidget(
          host(
            Scaffold(
              body: SingleChildScrollView(
                child: TimelinePanel(store: store, position: () => 0),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'Timeline and mix');
        // Exercise modal layouts independently of scrolling navigation positions.
        final settings = SettingsScreen(
          store: store,
          theme: ThemeMode.system,
          onTheme: (_) {},
          onDisconnect: () async {},
          onSignOut: () async {},
        );
        for (final open in [
          settings.keys,
          settings.skills,
          settings.memory,
          settings.tools,
          settings.browser,
        ]) {
          await tester.pumpWidget(
            host(
              Scaffold(
                body: Builder(
                  builder: (context) => TextButton(
                    onPressed: () => open(context),
                    child: const Text('Open panel'),
                  ),
                ),
              ),
            ),
          );
          await tester.tap(find.text('Open panel'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'Settings panel');
          await tester.ensureVisible(find.byTooltip('Close'));
          await tester.tap(find.byTooltip('Close'));
          await tester.pumpAndSettle();
        }
        await tester.pumpWidget(const SizedBox());
      });
    }
  }
  test('AG-UI snapshots, streaming, failures and tool cleanup', () {
    final state = AgentState();
    state.reduce({'type': 'RUN_STARTED'});
    state.reduce({'type': 'TEXT_MESSAGE_CONTENT', 'delta': 'Hello '});
    state.reduce({'type': 'TEXT_MESSAGE_CONTENT', 'delta': 'world'});
    expect(state.streaming, 'Hello world');
    state.reduce({
      'type': 'TOOL_CALL_START',
      'toolCallId': 'x',
      'toolCallName': 'render',
    });
    expect(state.tools['x'], 'render');
    state.reduce({'type': 'RUN_ERROR', 'message': 'No key'});
    expect(state.busy, false);
    expect(state.tools, isEmpty);
    expect(state.streaming, isEmpty);
    state.snapshot({
      'messages': [
        {'id': '1', 'role': 'user', 'content': 'Edit'},
      ],
      'busy': true,
      'pending': {},
      'cost': 1.25,
    });
    expect(state.messages.single['content'], 'Edit');
    state.reduce({'type': 'RUN_FINISHED'});
    expect(state.tools, isEmpty);
    expect(state.streaming, isEmpty);
  });
  test(
    'connection rejects non-TLS, credentials and malformed fingerprints',
    () {
      for (final url in [
        'http://192.168.1.2',
        'https://user:pass@host',
        'https://host/path',
        'https://host?token=secret',
      ]) {
        expect(
          () => Connection.fromJson({'url': url, 'fingerprint': 'a' * 64}),
          throwsA(isA<BridgeException>()),
        );
      }
      expect(
        () =>
            Connection.fromJson({'url': 'https://host', 'fingerprint': 'bad'}),
        throwsA(isA<BridgeException>()),
      );
    },
  );
}
