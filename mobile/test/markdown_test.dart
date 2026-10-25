import 'package:agentshot_mobile/ui/markdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders the agent\'s Markdown without its markup', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Markdown(
            '## Done\n\nYou can:\n- **Describe an animation** to make\n- Drop in *files*\n1. Run `export`\n\n```\nffmpeg -i in.mp4\n```\nSee [the docs](https://agentshot.si).',
          ),
        ),
      ),
    );
    final shown = tester
        .widgetList<RichText>(find.byType(RichText))
        .map((t) => t.text.toPlainText())
        .join('\n');
    expect(shown, contains('Done'));
    expect(shown, contains('Describe an animation to make'));
    expect(shown, contains('Drop in files'));
    expect(shown, contains('ffmpeg -i in.mp4'));
    expect(shown, contains('See the docs.'));
    expect(shown, isNot(contains('**')));
    expect(shown, isNot(contains('##')));
    expect(shown, isNot(contains('](')));
    expect(find.text('•'), findsNWidgets(2));
    expect(find.text('1.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
