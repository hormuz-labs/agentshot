// Render brand QA screenshots without a device: flutter test scripts/preview_test.dart
// Outputs are ignored under build/brand-preview; data is an explicit fixture.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:manul_mobile/main.dart';
import 'package:manul_mobile/bridge/store.dart';
import 'package:manul_mobile/ui/home.dart';
import 'package:manul_mobile/ui/pair.dart';
import 'package:manul_mobile/ui/project.dart';
import '../test/responsive_test.dart' show FakeClient;

void main() {
  testWidgets('capture light and dark mobile brand previews', (tester) async {
    await tester.runAsync(
      () => (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load(),
    );
    for (final family in ['Inter', 'SourceSerif4']) {
      await tester.runAsync(
        () => (FontLoader(
          family,
        )..addFont(rootBundle.load('assets/fonts/$family.ttf'))).load(),
      );
    }
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = FakeClient();
    final store = BridgeStore(client)..connected = true;
    addTearDown(store.dispose);
    addTearDown(client.dispose);
    for (final brightness in Brightness.values) {
      final screens = <String, Widget>{
        'pair': PairScreen(client: client, onPaired: () {}),
        'home': HomeScreen(
          store: store,
          theme: ThemeMode.system,
          onTheme: (_) {},
          onDisconnect: () async {},
        ),
        'project': ProjectScreen(store: store),
      };
      store.project = {
        'dir': '/fixture',
        'title': 'Weekend in the mountains',
        'versions': [],
        'current': '',
        'notes': [],
        'media': {},
        'files': {},
        'timeline': {'items': []},
      };
      store.agent('/fixture').loaded = true;
      store.agent('/fixture').messages = [
        {
          'id': '1',
          'role': 'user',
          'content':
              'Make a 30-second film. Open on the mountain, then bring in the music.',
        },
        {
          'id': '2',
          'role': 'assistant',
          'content':
              'The first cut is ready. I kept the wide opening shot and brought the music in as the trail comes into view.',
        },
      ];
      for (final entry in screens.entries) {
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: MaterialApp(
              theme: manulTheme(brightness),
              debugShowCheckedModeBanner: false,
              home: entry.value,
            ),
          ),
        );
        await tester.runAsync(
          () => precacheImage(
            const AssetImage('assets/manul.png'),
            key.currentContext!,
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.runAsync(() async {
          final image =
              await (key.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File(
            'build/brand-preview/${entry.key}-${brightness.name}.png',
          );
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
    }
    await tester.pumpWidget(const SizedBox());
  });
}
