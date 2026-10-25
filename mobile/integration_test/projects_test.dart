// The desktop's projects on the phone: search, open one, see its film and its files.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('searches, opens a project and shows its film and files', (
    tester,
  ) async {
    await launchPaired(tester);

    await tester.enterText(
      find.widgetWithText(TextField, 'Search projects'),
      'no such project',
    );
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.text(project), findsNothing);
    expect(find.text('A home for your films'), findsOneWidget);
    await tester.enterText(
      find.widgetWithText(TextField, 'Search projects'),
      project.substring(0, 3),
    );
    await reveal(tester, find.text(project));

    await openProject(tester);
    expect(find.widgetWithText(AppBar, project), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Film'));
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );

    await tester.tap(find.widgetWithText(ChoiceChip, 'Files'));
    await waitFor(tester, find.text('Project files'));
    await waitFor(tester, find.textContaining('.mp4'));

    await tester.pageBack();
    await waitFor(tester, find.text('What are we making?'));
  });
}
