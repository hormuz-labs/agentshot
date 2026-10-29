// What the phone keeps of the computer's projects: the list and a project with its conversation open at once, and
// offline, from what was there last; the computer's answer replaces them.
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/snapshots.dart';
import 'package:agentshot_mobile/bridge/store.dart';

/// A computer that answers while [online], and can't be reached otherwise.
class Reachable extends BridgeClient {
  Reachable() {
    // the computer's identity: what's kept is kept under it
    connection = Connection(
      Uri.parse('https://192.168.1.20:47821'),
      'a' * 64,
      'token',
    );
  }
  bool online = true;

  /// What came over whole, by method (an unchanged answer, tagged, doesn't count).
  final sent = <String>[];
  @override
  Future<({bool unchanged, dynamic value, String? tag})> callKept(
    String method,
    List<dynamic> args, {
    String? have,
  }) async {
    final value = await call(method, args);
    // the computer's tag: the answer's own content
    final tag = '"${jsonEncode(value).hashCode}"';
    if (have == tag) return (unchanged: true, value: null, tag: tag);
    sent.add(args.isEmpty ? method : '$method ${args.first}');
    return (unchanged: false, value: value, tag: tag);
  }

  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    if (!online) throw BridgeException('Couldn’t reach your computer.');
    return switch (method) {
      'project:recent' => [
        {'dir': '/p', 'title': 'Harbour walk'},
        {'dir': '/q', 'title': 'Market day'},
      ],
      'project:open' || 'project:peek' => {
        'dir': args[0],
        'title': args[0] == '/p' ? 'Harbour walk' : 'Market day',
        'versions': [],
        'current': 'v1',
      },
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
  setUp(
    () async => root = await Directory.systemTemp.createTemp('snapshots-test-'),
  );
  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  Snapshots kept() => Snapshots(root: () async => root)..computer = 'a' * 64;

  test(
    'projects and a conversation open from what was kept, with the computer out of reach',
    () async {
      final client = Reachable();
      final first = BridgeStore(client, saved: kept());
      await first.refresh();
      await first.open('/p');
      // the rest of the list is kept behind it
      for (var i = 0; i < 50 && !client.sent.contains('project:peek /q'); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      await first.saved.flush();
      first.dispose();

      client.online = false;
      final later = BridgeStore(client, saved: kept());
      await later.restoreSaved();
      expect(later.projects.first['title'], 'Harbour walk');
      // opens offline, on what was there
      await later.open('/p');
      expect(later.project?['title'], 'Harbour walk');
      final said = later.agent('/p');
      expect(said.messages.single['content'], 'Tighten the opening');
      // never a run that looks like it's still going
      expect(said.busy, isFalse);
      // never opened here, but kept ahead of a tap: opens offline too
      await later.open('/q');
      expect(later.project?['title'], 'Market day');
      // nothing kept: opening fails as before
      await expectLater(
        later.open('/elsewhere'),
        throwsA(isA<BridgeException>()),
      );
      later.dispose();
    },
  );

  test('asked again, only what changed comes over', () async {
    final client = Reachable();
    final store = BridgeStore(client, saved: kept());
    await store.refresh();
    await store.open('/p');
    for (var i = 0; i < 50 && !client.sent.contains('project:peek /q'); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(
      client.sent,
      containsAll([
        'project:recent',
        'jobs:list',
        'consent:list',
        'project:open /p',
        'project:peek /q',
      ]),
    );
    await store.saved.flush();
    store.dispose();

    // the app again, nothing changed on the computer: everything is "unchanged", nothing comes over whole
    client.sent.clear();
    final again = BridgeStore(client, saved: kept());
    await again.restoreSaved();
    await again.refresh();
    await again.open('/p');
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(client.sent, ['jobs:list', 'consent:list']);
    expect(again.project?['title'], 'Harbour walk');
    again.dispose();
  });

  test(
    'nothing is kept without a computer, and all of it goes on forgetting',
    () async {
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
    },
  );
}
