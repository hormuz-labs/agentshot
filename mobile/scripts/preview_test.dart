// Render design QA screenshots without a device: flutter test scripts/preview_test.dart
// Outputs are ignored under build/brand-preview; data is an explicit fixture.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/main.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/ui/home.dart';
import 'package:agentshot_mobile/ui/project.dart';
import '../test/responsive_test.dart' show FakeClient;

/// The fake computer, with something in it: examples, a render running, a question waiting.
class ShowcaseClient extends FakeClient {
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async => switch (method) {
    'gallery:list' => [
      for (final (id, title, tag, who) in const [
        ('a', 'Product launch in 15 seconds', 'Launch', 'Lena Park'),
        ('b', 'Kinetic quote, bold type', 'Typography', 'Studio Ono'),
        ('c', 'App walkthrough with zooms', 'Walkthrough', 'Ravi'),
        ('d', 'Podcast clip with captions', 'Captions', 'Mia Chen'),
      ])
        {
          'id': id,
          'title': title,
          'tags': [
            {'name': tag},
          ],
          'creator': {'name': who},
          'video': 'manul://gallery/media/$id.mp4',
          'poster': 'manul://gallery/posters/$id.jpg',
          'prompt': 'Make it punchy.',
        },
    ],
    _ => super.call(method, args),
  };
}

void main() {
  testWidgets('capture light and dark design previews', (tester) async {
    await tester.runAsync(
      () => (FontLoader('MaterialIcons')..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load(),
    );
    for (final family in ['Inter', 'SourceSerif4']) {
      await tester.runAsync(
        () => (FontLoader(family)..addFont(rootBundle.load('assets/fonts/$family.ttf'))).load(),
      );
    }
    tester.view.devicePixelRatio = 2;
    tester.view.physicalSize = const Size(780, 1688);
    // a phone's notch at the top and its home-indicator strip at the bottom (where the system's swipe-up lives)
    tester.view.padding = const FakeViewPadding(top: 94, bottom: 68);
    tester.view.viewPadding = const FakeViewPadding(top: 94, bottom: 68);
    addTearDown(tester.view.resetPadding);
    addTearDown(tester.view.resetViewPadding);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = ShowcaseClient();
    final store = BridgeStore(client)..connected = true;
    addTearDown(store.dispose);
    addTearDown(client.dispose);
    final now = DateTime.now().millisecondsSinceEpoch;
    store.projects = [
      {'dir': '/one', 'title': 'Weekend in the mountains', 'openedAt': now - 3600e3},
      {'dir': '/two', 'title': 'Launch teaser — v2', 'openedAt': now - 86400e3},
      {'dir': '/three', 'title': 'Podcast ep. 14 highlights', 'openedAt': now - 3 * 86400e3},
      {'dir': '/four', 'title': 'Onboarding walkthrough', 'openedAt': now - 9 * 86400e3},
    ];
    store.agent('/two').busy = true;
    store.consents = [
      {
        'id': 'c1',
        'project': '/three',
        'title': 'Download the speech model?',
        'body': 'Transcribing needs a 140 MB model on your computer.',
        'confirm': 'Download',
        'sizeMB': 140,
      },
    ];
    store.jobs = [
      {'title': 'Rendering “Launch teaser — v2”', 'status': 'running', 'progress': .62, 'detail': '1080p · 62%'},
      {'title': 'Transcribing', 'doneTitle': 'Transcribed the interview', 'status': 'done', 'detail': '12 min of speech'},
    ];
    store.project = {
      'dir': '/one',
      'title': 'Weekend in the mountains',
      'versions': [
        {'id': 'v1', 'title': 'First cut', 'path': 'renders/v1.mp4', 'by': 'agent'},
        {'id': 'v2', 'title': 'Tighter, music earlier', 'path': 'renders/v2.mp4', 'by': 'agent'},
      ],
      'current': 'v1',
      'proposal': 'v2',
      'notes': [],
      'media': {},
      'files': {},
      'timeline': {'items': []},
    };
    store.agent('/one')
      ..loaded = true
      ..messages = [
        {
          'id': '1',
          'role': 'user',
          'content': 'Make a 30-second film. Open on the mountain, then bring in the music.',
        },
        {
          'id': '2',
          'role': 'assistant',
          'content':
              'The first cut is ready. I kept the **wide opening shot** and brought the music in as the trail comes into view.',
        },
        {'id': '3', 'role': 'user', 'content': 'Tighter please, and the music a beat earlier.'},
        {
          'id': '4',
          'role': 'assistant',
          'content': 'Done — trimmed 4 seconds from the middle and moved the music to 0:02. Have a look.',
        },
      ];
    for (final brightness in Brightness.values) {
      final screens = <String, Widget Function()>{
        'home': () => HomeScreen(
          store: store,
          theme: ThemeMode.system,
          onTheme: (_) {},
          onDisconnect: () async {},
          onSignOut: () async {},
        ),
        'examples': () => HomeScreen(
          store: store,
          theme: ThemeMode.system,
          onTheme: (_) {},
          onDisconnect: () async {},
          onSignOut: () async {},
          initialSection: 1,
        ),
        'activity': () => HomeScreen(
          store: store,
          theme: ThemeMode.system,
          onTheme: (_) {},
          onDisconnect: () async {},
          onSignOut: () async {},
          initialSection: 2,
        ),
        'project': () => ProjectScreen(store: store),
        'project-edit': () => ProjectScreen(store: store),
      };
      // what to open before the picture is taken
      final then = <String, String>{'project-edit': 'open-edit'};
      for (final entry in screens.entries) {
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: MaterialApp(
              theme: agentShotTheme(brightness),
              debugShowCheckedModeBanner: false,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(disableAnimations: true),
                child: child!,
              ),
              home: entry.value(),
            ),
          ),
        );
        await tester.runAsync(() => precacheImage(const AssetImage('assets/manul.png'), key.currentContext!));
        if (then[entry.key] case final button?) {
          await tester.pump();
          await tester.tap(find.byKey(ValueKey(button)));
        }
        for (var i = 0; i < 10; i++) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
          await tester.pump(const Duration(milliseconds: 100));
        }
        tester.takeException();
        await tester.runAsync(() async {
          final image = await (key.currentContext!.findRenderObject() as RenderRepaintBoundary).toImage(
            pixelRatio: 2,
          );
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('build/brand-preview/${entry.key}-${brightness.name}.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
    }
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 5));
  });
}
