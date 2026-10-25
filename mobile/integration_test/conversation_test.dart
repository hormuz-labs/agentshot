// Talking to the desktop's agent from the phone: a note goes to the desktop, its reply streams back, and a new
// conversation starts empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('sends a note and shows the desktop agent reply', (tester) async {
    await launchPaired(tester);
    await openProject(tester);

    const note = 'Mobile e2e: hello from the phone';
    await tester.enterText(find.widgetWithText(TextField, 'Your notes'), note);
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await waitFor(tester, find.text(note));
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(seconds: 90),
    );
    expect(find.text('You'), findsWidgets);
    expect(find.text('AgentShot'), findsWidgets);

    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Conversations').last);
    await settle(tester);
    await tester.tap(find.text('New conversation'));
    // The list keeps both: the new one, and the first one named after its first message.
    await waitFor(tester, find.text('New conversation').at(1));
    expect(find.widgetWithText(ListTile, note), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await waitFor(tester, find.text('Give notes. Get cuts.'));
    expect(find.text(reply), findsNothing);

    // Switching back brings that conversation back.
    await tester.tap(find.byTooltip('Project actions').last);
    await settle(tester);
    await tester.tap(find.text('Conversations').last);
    await settle(tester);
    await tester.tap(find.widgetWithText(ListTile, note));
    await settle(tester);
    await tester.tap(find.byTooltip('Close'));
    await waitFor(tester, find.text(reply));
  });
}
