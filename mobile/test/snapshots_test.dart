// What the phone keeps of the computer's projects: the list and a project with its conversation open at once, and
// offline, from what was there last; the computer's answer replaces them.
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/snapshots.dart';
import 'package:agentshot_mobile/bridge/store.dart';

/// A computer that answers while [online], and can't be reached otherwise.
class Reachable extends BridgeClient {
  Reachable() {
    // the computer's identity: what's kept is kept under it
    connection = Connection(Uri.parse('https://192.168.1.20:47821'), 'a' * 64, 'token');
  }
  bool online = true;
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    if (!online) throw BridgeException('Couldn’t reach your computer.');
    return switch (method) {
      'project:recent' => [
        {'dir': '/p', 'title': 'Harbour walk'},
      ],
      'project:open' => {'dir': '/p', 'title': 'Harbour walk', 'versions': [], 'current': 'v1'},
      'agent:attach' => {
        'messages': [
          {'id': '1', 'role': 'user', 'content': 'Tighten the opening'},
        ],
        'busy': true,
      },
      _ => [],
    };
  }
}

void main() {
  late Directory root;
  setUp(() async => root = await Directory.systemTemp.createTemp('snapshots-test-'));
  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  Snapshots kept() => Snapshots(root: () async => root)..computer = 'a' * 64;

  test('projects and a conversation open from what was kept, with the computer out of reach', () async {
    final client = Reachable();
    final first = BridgeStore(client, saved: kept());
    await first.refresh();
    await first.open('/p');
    await first.saved.flush();
    first.dispose();

    client.online = false;
    final later = BridgeStore(client, saved: kept());
    await later.restoreSaved();
    expect(later.projects.single['title'], 'Harbour walk');
    // opens offline, on what was there
    await later.open('/p');
    expect(later.project?['title'], 'Harbour walk');
    final said = later.agent('/p');
    expect(said.messages.single['content'], 'Tighten the opening');
    // never a run that looks like it's still going
    expect(said.busy, isFalse);
    // nothing kept: opening fails as before
    await expectLater(later.open('/elsewhere'), throwsA(isA<BridgeException>()));
    later.dispose();
  });

  test('nothing is kept without a computer, and all of it goes on forgetting', () async {
    final unnamed = Snapshots(root: () async => root);
    unnamed.write('projects', [1]);
    await unnamed.flush();
    expect(await unnamed.read('projects'), isNull);

    final store = BridgeStore(Reachable(), saved: kept());
    await store.refresh();
    await store.saved.flush();
    expect(await store.saved.read('projects'), isNotEmpty);
    await store.forgetSaved();
    expect(store.projects, isEmpty);
    final again = kept();
    expect(await again.read('projects'), isNull);
    store.dispose();
  });
}
