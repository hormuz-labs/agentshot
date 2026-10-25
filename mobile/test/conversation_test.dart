import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/main.dart';
import 'package:agentshot_mobile/ui/project.dart';

class HistoryClient extends BridgeClient {
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    return switch (method) {
      'project:open' => {
        'dir': args[0],
        'title': 'Saved film',
        'versions': [],
        'media': {},
        'files': {},
      },
      'agent:attach' => {
        'messages': [
          {
            'id': 'previous',
            'role': 'user',
            'content': 'Keep my earlier conversation',
          },
        ],
        'pending': {},
        'busy': false,
        'cost': 0,
      },
      _ => [],
    };
  }
}

void main() {
  testWidgets(
    'saved conversation loads without an SSE event; loading is not empty history',
    (tester) async {
      final client = HistoryClient();
      final store = BridgeStore(client)
        ..project = {'dir': '/saved', 'title': 'Saved film'};
      addTearDown(client.dispose);
      addTearDown(store.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: agentShotTheme(Brightness.dark),
          home: ProjectScreen(store: store),
        ),
      );
      expect(find.text('Loading conversation…'), findsOneWidget);
      expect(find.text('Give notes. Get cuts.'), findsNothing);
      await store.open('/saved');
      await tester.pump();
      expect(store.agent('/saved').loaded, isTrue);
      expect(find.text('Keep my earlier conversation'), findsOneWidget);
      expect(find.text('Loading conversation…'), findsNothing);
    },
  );
}
