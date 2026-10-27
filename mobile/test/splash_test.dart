import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:agentshot_mobile/ui/splash.dart';

void main() {
  testWidgets('the splash says what this is, which version, and who makes it', (tester) async {
    PackageInfo.setMockInitialValues(
      appName: 'AgentShot',
      packageName: 'si.agentshot.app',
      version: '0.1.0',
      buildNumber: '7',
      buildSignature: '',
    );
    await tester.pumpWidget(const MaterialApp(home: Splash()));
    await tester.pump();
    expect(find.text('AgentShot'), findsOneWidget);
    expect(find.text('Version 0.1.0'), findsOneWidget);
    expect(find.text('A Hormuz Labs product'), findsOneWidget);
  });
}
