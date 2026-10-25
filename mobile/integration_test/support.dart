// Shared steps for the mobile end-to-end tests. They run on a real device or emulator against a real desktop
// AgentShot that test/e2e/mobile.e2e.mjs starts and passes in with --dart-define:
//   E2E_PAIR     what the desktop's pairing QR carries (agentshot://pair?d=…), with a fresh code (one per test
//                file; a code pairs one device once) and the address this device reaches the desktop at
//   E2E_PROJECT  the title of the project the desktop made for the tests
//   E2E_REPLY    what the desktop's scripted model answers to every message
import 'dart:convert';
import 'package:agentshot_mobile/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const pairLink = String.fromEnvironment('E2E_PAIR');
const project = String.fromEnvironment('E2E_PROJECT');
const reply = String.fromEnvironment('E2E_REPLY');

/// Pumps real frames until [finder] matches, or fails after [timeout]. The app talks to a real desktop over the
/// network, so pumpAndSettle can't be used: progress indicators never settle.
Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  throw TestFailure(
    'Timed out after $timeout waiting for $finder\nOn screen: ${visibleText().join(' | ')}',
  );
}

/// The text on screen, for failure messages.
List<String> visibleText() => [
  for (final e in find.byType(Text).evaluate())
    if ((e.widget as Text).data case final data? when data.trim().isNotEmpty)
      data.trim(),
];

/// Pumps real frames for [duration] (animations, sheets and route changes finish).
Future<void> settle(
  WidgetTester tester, [
  Duration duration = const Duration(milliseconds: 800),
]) async {
  final end = DateTime.now().add(duration);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Scrolls the page (the largest vertical list on screen) until [finder] is built and visible, the way a person
/// scrolls to something off screen on a small phone or with large text: down to the end, then back up. Keeps going
/// for up to [timeout], since what it looks for may still be loading from the desktop.
Future<void> reveal(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  ScrollableState? page() {
    final lists =
        tester
            .stateList<ScrollableState>(find.byType(Scrollable))
            .where(
              (s) =>
                  s.position.axis == Axis.vertical &&
                  s.context.findRenderObject() is RenderBox &&
                  (s.context.findRenderObject() as RenderBox).hasSize,
            )
            .toList()
          ..sort((a, b) => area(b).compareTo(area(a)));
    return lists.firstOrNull;
  }

  final window =
      Offset.zero & (tester.view.physicalSize / tester.view.devicePixelRatio);
  // On screen, and inside the list it scrolls in (not under the app bar or a bottom bar).
  bool shown() {
    if (finder.evaluate().isEmpty) return false;
    final element = finder.evaluate().first;
    final center = tester.getRect(finder.first).center;
    final list = Scrollable.maybeOf(element)?.context.findRenderObject();
    final area = list is RenderBox && list.hasSize
        ? list.localToGlobal(Offset.zero) & list.size
        : window;
    return window.contains(center) && area.contains(center);
  }

  final end = DateTime.now().add(timeout);
  var step = -250.0;
  while (!shown() && DateTime.now().isBefore(end)) {
    if (finder.evaluate().isNotEmpty) {
      // to mid-screen, clear of the app bar and anything pinned at the edges
      await Scrollable.ensureVisible(finder.evaluate().first, alignment: .5);
      await settle(tester, const Duration(milliseconds: 300));
    } else if (page() case final list?) {
      final before = list.position.pixels;
      await tester.dragFrom(
        tester.getCenter(find.byWidget(list.widget)),
        Offset(0, step),
      );
      await settle(tester, const Duration(milliseconds: 300));
      if (list.position.pixels == before) {
        step = -step; // at an end: turn around
      }
    } else {
      await settle(tester, const Duration(milliseconds: 300));
    }
  }
  if (!shown()) {
    fail(
      'Could not scroll to $finder. On screen: ${visibleText().join(' | ')}',
    );
  }
}

double area(ScrollableState s) {
  final size = (s.context.findRenderObject() as RenderBox).size;
  return size.width * size.height;
}

/// Starts the app and waits for either the pair screen or the home screen.
Future<void> launch(WidgetTester tester) async {
  expect(pairLink, isNotEmpty, reason: 'Run through test/e2e/mobile.e2e.mjs');
  app.main();
  // the pair screen's Scan button, or home's Refresh (its heading may be scrolled away)
  await waitFor(
    tester,
    find.byWidgetPredicate(
      (w) =>
          (w is Tooltip && w.message == 'Refresh') ||
          (w is Text && w.data == 'Scan QR code'),
    ),
  );
}

/// The same pairing link with another code, as if someone typed a wrong or stale one.
String withCode(String link, String code) {
  final data =
      jsonDecode(
            utf8.decode(
              base64Url.decode(
                base64Url.normalize(Uri.parse(link).queryParameters['d']!),
              ),
            ),
          )
          as Map<String, dynamic>;
  data['code'] = code;
  return 'agentshot://pair?d=${base64Url.encode(utf8.encode(jsonEncode(data))).replaceAll('=', '')}';
}

String codeOf(String link) =>
    (jsonDecode(
              utf8.decode(
                base64Url.decode(
                  base64Url.normalize(Uri.parse(link).queryParameters['d']!),
                ),
              ),
            )
            as Map<String, dynamic>)['code']
        as String;

/// Pairs with a link from the desktop's QR, the ways a person brings it over, most direct first:
///  1. as if the phone's camera scanned it: the runner opens the agentshot://pair link on the device (it watches for
///     the PAIR_LINK line), and Android hands it to the app
///  2. Paste code (Android only lets the app in focus read the clipboard, which a CI emulator may not allow)
///  3. typing the 6-digit code into the boxes (E2E_TYPE=true goes straight to this)
Future<void> enterCode(WidgetTester tester, String link) async {
  String? error() => find
      .textContaining(RegExp('Invalid|Could not|Try pairing'))
      .evaluate()
      .map((e) => (e.widget as Text).data)
      .firstOrNull;
  final before = error();
  bool started() =>
      find.text('Connecting…').evaluate().isNotEmpty ||
      find.text('What are we making?').evaluate().isNotEmpty ||
      (error() != null && error() != before);
  Future<bool> waitStarted(Duration timeout) async {
    final end = DateTime.now().add(timeout);
    while (!started() && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    return started();
  }

  if (!const bool.fromEnvironment('E2E_TYPE')) {
    // ignore: avoid_print
    print('PAIR_LINK $link');
    if (await waitStarted(const Duration(seconds: 10))) return;
    await Clipboard.setData(ClipboardData(text: link));
    await reveal(tester, find.text('Paste code'));
    await tester.tap(find.text('Paste code'));
    if (await waitStarted(const Duration(seconds: 3))) return;
  }
  final digits = codeOf(link);
  for (var i = 0; i < 6; i++) {
    final box = find.byKey(ValueKey('otp-$i'));
    await reveal(tester, box);
    await tester.enterText(box, digits[i]);
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Starts the app paired with the desktop: pairs with [pairLink] unless an earlier test file already did.
Future<void> launchPaired(WidgetTester tester) async {
  await launch(tester);
  if (find.text('What are we making?').evaluate().isEmpty) {
    await enterCode(tester, pairLink);
  }
  await waitFor(tester, find.text('What are we making?'));
  // the desktop's projects have loaded (below the fold on a small phone)
  await reveal(tester, find.text('On your computer'));
}

/// Opens the desktop's test project from the Projects list.
Future<void> openProject(WidgetTester tester) async {
  await reveal(tester, find.text(project));
  await tester.tap(find.text(project));
  await waitFor(tester, find.widgetWithText(TextField, 'Your notes'));
  // the conversation has loaded: either its messages or the empty-chat hint, no longer "Loading…"
  final end = DateTime.now().add(const Duration(seconds: 30));
  while (find.text('Loading conversation…').evaluate().isNotEmpty) {
    if (DateTime.now().isAfter(end)) fail('The conversation never loaded');
    await tester.pump(const Duration(milliseconds: 200));
  }
}

/// Starts a new, empty conversation in the open project (earlier tests may have talked in it).
Future<void> newConversation(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Project actions').last);
  await settle(tester);
  await tester.tap(find.text('Conversations').last);
  await settle(tester);
  await tester.tap(find.text('New conversation').first);
  await settle(tester);
  await tester.tap(find.byTooltip('Close'));
  await waitFor(tester, find.text('Give notes. Get cuts.'));
}
