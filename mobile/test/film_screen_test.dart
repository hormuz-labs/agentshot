// The film full screen: what's chosen there (a note at the moment, a box, Keep, the menu) comes back to the
// conversation; a new cut has Before / After and Keep / Send back; swiping down goes back with nothing.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/ui/film_screen.dart';

void main() {
  late FilmChoice? chosen;
  late bool closed;

  Widget host({bool newCut = false}) => MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () async {
              chosen = await Navigator.of(context).push<FilmChoice>(
                MaterialPageRoute(
                  builder: (_) => FilmScreen(
                    // no video in a test: the screen still offers everything around the picture
                    film: () async => Uri.parse('http://127.0.0.1:1/film.mp4'),
                    proposal: newCut ? () async => Uri.parse('http://127.0.0.1:1/new.mp4') : null,
                    startAt: 3,
                    menu: const [('files', 'Files', Icons.folder_outlined)],
                  ),
                ),
              );
              closed = true;
            },
            child: const Text('Watch'),
          ),
        ),
      ),
    ),
  );

  // the picture's spinner never stops without a video: frames, not "settled"
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  setUp(() {
    chosen = null;
    closed = false;
  });

  Future<void> open(WidgetTester tester, {bool newCut = false}) async {
    await tester.pumpWidget(host(newCut: newCut));
    await tester.tap(find.text('Watch'));
    await settle(tester);
  }

  testWidgets('Note comes back as a note at the moment, the menu as its key', (tester) async {
    await open(tester);
    expect(find.byKey(const ValueKey('film-keep')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('film-note')));
    await settle(tester);
    expect(closed, isTrue);
    expect(chosen?.what, 'note');

    await tester.tap(find.text('Watch'));
    await settle(tester);
    await tester.tap(find.text('More'));
    await settle(tester);
    await tester.tap(find.text('Files'));
    await settle(tester);
    expect(chosen?.what, 'files');
  });

  testWidgets('a new cut: Before / After, and Keep comes back as keep', (tester) async {
    await open(tester, newCut: true);
    expect(find.byKey(const ValueKey('film-before-after')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('film-keep')));
    await settle(tester);
    expect(chosen?.what, 'keep');
  });

  testWidgets('swiping down goes back with nothing chosen', (tester) async {
    await open(tester);
    await tester.drag(find.byType(FilmScreen), const Offset(0, 300));
    await settle(tester);
    expect(closed, isTrue);
    expect(chosen, isNull);
  });
}
