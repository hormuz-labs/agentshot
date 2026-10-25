// Settings read from the desktop (model providers, keys), the other tabs, and disconnecting this device. Runs last:
// it unpairs the phone.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('shows desktop settings and disconnects', (tester) async {
    await launchPaired(tester);

    await tester.tap(find.widgetWithText(NavigationDestination, 'Activity'));
    await waitFor(tester, find.text('Activity'));
    await tester.tap(find.widgetWithText(NavigationDestination, 'Examples'));
    await waitFor(tester, find.text('Start with a little inspiration'));

    await tester.tap(find.widgetWithText(NavigationDestination, 'Settings'));
    await waitFor(tester, find.text('Connected desktop'));
    await tester.tap(find.text('Model providers'));
    await waitFor(tester, find.text('Scripted'));
    await tester.tap(find.byTooltip('Close'));
    await settle(tester);

    final disconnect = find.text('Disconnect this device');
    await reveal(tester, disconnect);
    await tester.tap(disconnect);
    await settle(tester);
    if (find.text('Confirm').evaluate().isNotEmpty) {
      await tester.tap(find.text('Confirm'));
    }
    await waitFor(tester, find.text('Connect to desktop'));
  });
}
