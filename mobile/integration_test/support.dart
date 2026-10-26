// Shared steps for the mobile end-to-end tests. They run on a real device or emulator against a real desktop
// AgentShot that test/e2e/mobile.e2e.mjs starts and passes in with --dart-define:
//   E2E_PAIR     what the desktop's pairing QR carries (agentshot://pair?d=…), with a fresh code (one per test
//                file; a code pairs one device once) and the address this device reaches the desktop at
//   E2E_PROJECT  the title of the project the desktop made for the tests
//   E2E_REPLY    what the desktop's scripted model answers to every message
import 'dart:convert';
import 'dart:io';
import 'package:agentshot_mobile/bridge/pick.dart';
import 'package:agentshot_mobile/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider/path_provider.dart';

const pairLink = String.fromEnvironment('E2E_PAIR');
const project = String.fromEnvironment('E2E_PROJECT');
const reply = String.fromEnvironment('E2E_REPLY');
const fixtures = String.fromEnvironment('E2E_FIXTURES');

/// Asks the runner to do something only it can (it watches for DESKTOP lines): take the phone offline (stop) and
/// back (start), remove the phone on the desktop (revoke), press the phone's Back key once a system screen such as
/// the share sheet covers the app (back), allow the camera (camera), sign the desktop out (signout) and in (signin).
void cue(String what) {
  // ignore: avoid_print
  print('DESKTOP $what');
}

/// The runner's test media, downloaded to the phone as the picker would have returned them.
Future<List<Picked>> media(List<String> names) async {
  final dir = await getTemporaryDirectory();
  final http = HttpClient();
  try {
    return [
      for (final name in names)
        await () async {
          final res = await (await http.getUrl(
            Uri.parse('$fixtures/${Uri.encodeComponent(name)}'),
          )).close();
          final file = File('${dir.path}/$name');
          await res.pipe(file.openWrite());
          return Picked(file, name);
        }(),
    ];
  } finally {
    http.close();
  }
}

/// Taps what [finder] finds, scrolling to it first.
Future<void> press(WidgetTester tester, Finder finder) async {
  await reveal(tester, finder);
  await tester.tap(finder.first);
  await settle(tester, const Duration(milliseconds: 500));
}

/// Answers the text question on screen ([askText]) with [value]: Save, or Cancel when [value] is null.
Future<void> answer(WidgetTester tester, String? value) async {
  await waitFor(tester, find.byType(AlertDialog));
  if (value != null) {
    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      value,
    );
  }
  await tester.tap(find.text(value == null ? 'Cancel' : 'Save').last);
  await settle(tester);
}

/// The snack bar on screen says [text]; then it goes, so the next one can be read.
Future<void> snack(WidgetTester tester, Pattern text) async {
  await waitFor(
    tester,
    find.descendant(
      of: find.byType(SnackBar),
      matching: find.textContaining(text),
    ),
  );
  ScaffoldMessenger.of(
    tester.element(find.byType(SnackBar).first),
  ).clearSnackBars();
  await settle(tester);
}

/// Closes the sheet on top: its Close button, or the phone's Back when the sheet has scrolled it away.
Future<void> closeSheet(WidgetTester tester) async {
  final window =
      Offset.zero & (tester.view.physicalSize / tester.view.devicePixelRatio);
  final close = find.byTooltip('Close');
  final shown = [
    for (var i = 0; i < close.evaluate().length; i++)
      if (window.contains(tester.getCenter(close.at(i)))) close.at(i),
  ];
  if (shown.isNotEmpty) {
    await tester.tap(shown.last);
  } else {
    await tester.binding.handlePopRoute();
  }
  await settle(tester);
}

/// Opens [item] in the project's ⋮ menu.
Future<void> projectMenu(WidgetTester tester, String item) async {
  final entry = find.descendant(
    of: find.byWidgetPredicate((w) => w is PopupMenuItem),
    matching: find.text(item),
  );
  for (var tries = 0; entry.evaluate().isEmpty; tries++) {
    if (tries == 3) fail('The project menu never showed $item');
    await tester.tap(find.byTooltip('Project actions').last);
    final end = DateTime.now().add(const Duration(seconds: 5));
    while (entry.evaluate().isEmpty && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }
  await settle(tester, const Duration(milliseconds: 300));
  await tester.tap(entry.last);
  await settle(tester);
}

/// Types [text] in the composer and sends it.
Future<void> sendNote(WidgetTester tester, String text) async {
  final composer = find.byKey(const ValueKey('composer'));
  // a snack bar over the composer would take the tap instead of Send
  await waitGone(tester, find.byType(SnackBar));
  await tester.enterText(composer, text);
  await tester.pump(); // Send turns on once there is text
  await tester.tap(find.byTooltip('Send'));
  await settle(tester, const Duration(milliseconds: 300));
  // sent: the composer is empty again (a tap that missed Send would leave the note there, and the test go on)
  await waitFor(
    tester,
    find.byWidgetPredicate(
      (w) =>
          w is TextField &&
          w.key == const ValueKey('composer') &&
          (w.controller?.text.isEmpty ?? true),
    ),
  );
}

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

/// Pumps real frames until [finder] matches nothing, or fails after [timeout].
Future<void> waitGone(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isEmpty) return;
  }
  throw TestFailure('Still showing after $timeout: $finder');
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
  // the welcome screen, home's Refresh (its heading may be scrolled away), or the signed-in computers list
  await waitFor(
    tester,
    find.byWidgetPredicate(
      (w) =>
          (w is Tooltip && w.message == 'Refresh') ||
          (w is Text &&
              (w.data == 'Continue with Google' || w.data == 'Your computers')),
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
///  3. typing the 6-digit code into the boxes, only with E2E_TYPE=true (on a phone on the same Wi-Fi)
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
    // a slow CI emulator can take a while to hand the link over, or drop it while busy: once more after a while
    if (await waitStarted(const Duration(seconds: 20))) return;
    // ignore: avoid_print
    print('PAIR_LINK $link');
    if (await waitStarted(const Duration(seconds: 30))) return;
    await Clipboard.setData(ClipboardData(text: link));
    await showCodes(tester);
    await reveal(tester, find.text('Paste code'));
    await tester.tap(find.text('Paste code'));
    if (await waitStarted(const Duration(seconds: 5))) return;
    // typing the code would send the phone looking for the computer on the network, which an emulator can't
    // do (and which would bury the link if it came after all): say what went wrong instead
    fail('Neither the pairing link nor Paste code reached the app');
  }
  final digits = codeOf(link);
  await showCodes(tester);
  for (var i = 0; i < 6; i++) {
    final box = find.byKey(ValueKey('otp-$i'));
    await reveal(tester, box);
    await tester.enterText(box, digits[i]);
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Opens "Other ways to connect" on the welcome screen, where the QR and 6-digit code wait.
Future<void> showCodes(WidgetTester tester) async {
  // the screen may rebuild just after (a refused code), folding them away again: open until they stay open
  for (var tries = 0; tries < 3; tries++) {
    await settle(tester, const Duration(milliseconds: 600));
    if (find.byKey(const ValueKey('scan')).evaluate().isNotEmpty) return;
    await reveal(tester, find.text('Other ways to connect'));
    await tester.tap(find.text('Other ways to connect'));
  }
  await waitFor(tester, find.byKey(const ValueKey('scan')));
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
  await waitFor(tester, find.byKey(const ValueKey('composer')));
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

/// Starts something from the + in the bar: [option] in its sheet.
Future<void> start(WidgetTester tester, String option) async {
  await tester.tap(find.byTooltip('Start something new'));
  final sheet = find.byKey(const ValueKey('start-sheet'));
  await waitFor(tester, sheet);
  await settle(tester);
  // on once the computer is connected
  await waitFor(
    tester,
    find.descendant(
      of: sheet,
      matching: find.byWidgetPredicate(
        (w) =>
            w is ListTile &&
            w.enabled &&
            w.title is Text &&
            (w.title as Text).data == option,
      ),
    ),
  );
  await tester.tap(find.descendant(of: sheet, matching: find.text(option)));
  await settle(tester);
}
