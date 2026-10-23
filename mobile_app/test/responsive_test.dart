import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:manul_mobile/main.dart';
import 'package:manul_mobile/bridge/client.dart';
import 'package:manul_mobile/bridge/store.dart';
import 'package:manul_mobile/ui/home.dart';
import 'package:manul_mobile/ui/pair.dart';
import 'package:manul_mobile/ui/project.dart';
import 'package:manul_mobile/ui/settings.dart';

class FakeClient extends BridgeClient {
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
      _ => [],
    };
  }
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
          theme: manulTheme(Brightness.light),
          builder: (context, widget) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: widget!,
          ),
          home: child,
        );
        await tester.pumpWidget(
          host(PairScreen(client: client, onPaired: () {})),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(
          host(
            HomeScreen(
              store: store,
              theme: ThemeMode.system,
              onTheme: (_) {},
              onDisconnect: () async {},
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
          'versions': [],
          'current': '',
          'proposal': 'pending',
          'notes': [
            {
              'text':
                  'Keep the opening shot a little longer before the title appears.',
              'status': 'open',
              'anchor': {'t0': 2},
            },
          ],
          'media': {},
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
        // Simulate keyboard in a short viewport; composer must remain scrollable.
        tester.view.viewInsets = FakeViewPadding(bottom: size.height * .42);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        tester.view.resetViewInsets();
        await tester.pumpAndSettle();
        for (final label in ['Film', 'Files']) {
          final chip = find.widgetWithText(ChoiceChip, label);
          if (chip.evaluate().isEmpty) continue;
          await tester.ensureVisible(chip);
          await tester.tap(chip);
          await tester.pumpAndSettle();
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
