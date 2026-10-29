import 'dart:async';
import 'package:flutter/foundation.dart';
import 'account.dart';
import 'client.dart';
import 'snapshots.dart';

class AgentState {
  bool loaded = false;
  List<Json> messages = [];
  String streaming = '';
  bool busy = false;
  String? error;
  double cost = 0;
  Map<String, String> tools = {};
  void snapshot(Json state) {
    loaded = true;
    messages = objects(state['messages']);
    streaming = state['streaming']?['text'] as String? ?? '';
    busy = state['busy'] == true;
    error = state['error'] as String?;
    cost = (state['cost'] as num? ?? 0).toDouble();
    tools = {
      for (final entry in object(state['pending'] ?? {}).entries)
        entry.key: '${entry.value['name']}',
    };
  }

  void reduce(Json event) {
    switch (event['type']) {
      case 'RUN_STARTED':
        busy = true;
        error = null;
      case 'RUN_FINISHED':
        busy = false;
        streaming = '';
        tools.clear();
      case 'RUN_ERROR':
        error = '${event['message']}';
        busy = false;
        streaming = '';
        tools.clear();
      case 'MESSAGES_SNAPSHOT':
        loaded = true;
        messages = objects(event['messages']);
      case 'TEXT_MESSAGE_START':
        streaming = '';
      case 'TEXT_MESSAGE_CONTENT':
        streaming += '${event['delta'] ?? ''}';
      case 'TEXT_MESSAGE_END':
        streaming = '';
      case 'TOOL_CALL_START':
        tools['${event['toolCallId']}'] = '${event['toolCallName']}';
      case 'TOOL_CALL_END':
        tools.remove(event['toolCallId']);
      case 'CUSTOM':
        if (event['name'] == 'manul.usage') {
          cost = (event['value']?['cost'] as num? ?? 0).toDouble();
        }
    }
  }
}

class BridgeStore extends ChangeNotifier {
  final BridgeClient client;
  late final StreamSubscription<Json> _subscription;
  List<Json> projects = [], jobs = [], consents = [];
  final Map<String, AgentState> agents = {};
  Json? project;

  /// The AgentShot account this phone signed in with, if it did.
  Account? account;
  bool connected = false;

  /// The computer turned this phone away for good (not just out of reach): time to connect again.
  bool revoked = false;
  String? connectionError;
  bool _disposed = false;

  /// The last of what the computer said, kept on the phone (see [Snapshots]).
  final Snapshots saved;
  BridgeStore(this.client, {Snapshots? saved}) : saved = saved ?? Snapshots() {
    _subscription = client.events.listen(_event);
  }

  /// Opens on what the phone kept of this computer's projects, before (or without) hearing from it.
  Future<void> restoreSaved() async {
    saved.computer = client.connection?.fingerprint;
    final list = await saved.read('projects');
    if (list is List && projects.isEmpty) {
      projects = objects(list);
      _notify();
    }
  }

  /// Lets go of everything kept of the computer the phone is leaving.
  Future<void> forgetSaved() async {
    await saved.clear();
    saved.computer = null;
    projects = [];
  }

  /// A conversation as kept: what was said, never a run that looks like it's still going.
  void _keepConversation(String dir) {
    final a = agents[dir];
    if (a == null || !a.loaded) return;
    saved.write('agent:$dir', {'messages': a.messages, 'cost': a.cost});
  }

  /// The gallery's examples: the computer's list, or the one kept from last time when it can't be reached.
  Future<List<Json>> examples() async {
    try {
      final list = objects(await client.call('gallery:list'));
      saved.write('gallery', list);
      return list;
    } catch (_) {
      final kept = await saved.read('gallery');
      if (kept is List) return objects(kept);
      rethrow;
    }
  }
  String? get dir => project?['dir'] as String?;

  /// What is still working on the computer: jobs (a render, a transcription) by name, and the agent.
  List<String> get running => [
    for (final j in jobs)
      if (j['status'] == 'running') '${j['title'] ?? 'A job'}',
    if (agents.values.any((a) => a.busy)) 'The agent',
  ];

  /// On AgentShot Cloud (a leased worker), not one of the person's own computers.
  bool get onCloud =>
      account?.leased != null && client.connection?.machine == account?.leased;
  AgentState agent(String dir) => agents.putIfAbsent(dir, AgentState.new);

  /// How many of each project's messages the person has seen (counted as they leave its conversation).
  final seen = <String, int>{};

  /// A project's state in a word, for the list: working, waiting for an OK, a reply not seen yet, or null.
  String? statusOf(String dir) {
    final a = agents[dir];
    if (consents.any((c) => c['project'] == dir)) return 'Needs your OK';
    if (a?.busy == true) return 'Working…';
    final said =
        a?.messages
            .where(
              (m) =>
                  m['role'] == 'assistant' &&
                  '${m['content'] ?? ''}'.trim().isNotEmpty,
            )
            .length ??
        0;
    final before = seen[dir];
    if (before != null && said > before) return 'New reply';
    return null;
  }

  /// The person has read this project's conversation as it is now.
  void markSeen(String dir) {
    seen[dir] =
        agents[dir]?.messages
            .where(
              (m) =>
                  m['role'] == 'assistant' &&
                  '${m['content'] ?? ''}'.trim().isNotEmpty,
            )
            .length ??
        0;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    final data = await Future.wait([
      client.call('project:recent'),
      client.call('jobs:list'),
      client.call('consent:list'),
    ]);
    projects = objects(data[0]);
    jobs = objects(data[1]);
    consents = objects(data[2]);
    saved.write('projects', projects);
    _notify();
  }

  /// Shows what the phone kept of a project (and its conversation), if it kept anything: true when it did.
  Future<bool> showSaved(String directory) async {
    final kept = await saved.read('project:$directory');
    if (kept is! Map) return false;
    project = object(kept);
    final said = await saved.read('agent:$directory');
    if (said is Map && !(agents[directory]?.loaded ?? false)) {
      agent(directory).snapshot(object(said));
    }
    _notify();
    return true;
  }

  /// Opens a project: at once from what the phone kept of it (when it has been opened here before), then as the
  /// computer has it. Offline, what was kept is what shows, until the computer is back.
  Future<void> open(String directory) async {
    final kept = dir == directory || await showSaved(directory);
    try {
      project = object(await client.call('project:open', [directory]));
    } catch (_) {
      if (kept) return;
      rethrow;
    }
    saved.write('project:$directory', project);
    _notify();
    final state = await client.call('agent:attach', [directory]);
    if (state is Map && state['messages'] is List) {
      agent(directory).snapshot(object(state));
      _keepConversation(directory);
      _notify();
    }
  }

  void useProject(Json value) {
    project = value;
    _notify();
  }

  Future<void> update(String method, List<dynamic> args) async {
    final value = await client.call(method, args);
    if (value is Map && value.containsKey('versions')) {
      project = object(value);
      if (dir case final d?) saved.write('project:$d', project);
    }
    _notify();
  }

  void _event(Json event) {
    final args = event['args'] as List? ?? [];
    switch (event['channel']) {
      case 'connection':
        connected = args.first == true;
        revoked = !connected && args.length > 2 && args[2] == 'revoked';
        connectionError = connected
            ? null
            : (args.length > 1 ? '${args[1]}' : 'Disconnected');
        if (connected) {
          // AgentShot Cloud: a worker taken anew doesn't have the person's credits yet; hand them over again
          final a = account;
          if (onCloud && a != null && a.cloudCredits && a.key != null) {
            unawaited(
              client
                  .call('account:adopt', [
                    {'key': a.key, 'keyId': ?a.keyId, 'email': ?a.email},
                  ])
                  .then<void>((_) {}, onError: (Object _) {}),
            );
          }
          unawaited(
            refresh().catchError((Object e) {
              connectionError = plain(e, where: client.connection?.name);
              _notify();
            }),
          );
          if (dir != null) {
            unawaited(
              open(dir!).catchError((Object e) {
                connectionError = plain(e, where: client.connection?.name);
                _notify();
              }),
            );
          }
        }
      case 'project':
        if (args.isNotEmpty && args[0]['dir'] == dir) {
          project = object(args[0]);
          saved.write('project:$dir', project);
        }
      case 'jobs':
        jobs = objects(args.first);
      case 'consent':
        consents = objects(args.first);
      case 'agent:state':
        agent(args[0] as String).snapshot(object(args[1]));
        _keepConversation(args[0] as String);
        // what's there when the phone first hears of it counts as seen: only what comes after is new
        if (!seen.containsKey(args[0])) markSeen(args[0] as String);
      case 'agui':
        final event = object(args[1]);
        agent(args[0] as String).reduce(event);
        if (event['type'] == 'MESSAGES_SNAPSHOT' || event['type'] == 'RUN_FINISHED') {
          _keepConversation(args[0] as String);
        }
    }
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _subscription.cancel();
    super.dispose();
  }
}
