import 'dart:async';
import 'package:flutter/foundation.dart';
import 'account.dart';
import 'client.dart';

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
  BridgeStore(this.client) {
    _subscription = client.events.listen(_event);
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
    _notify();
  }

  Future<void> open(String directory) async {
    project = object(await client.call('project:open', [directory]));
    _notify();
    final state = await client.call('agent:attach', [directory]);
    if (state is Map && state['messages'] is List) {
      agent(directory).snapshot(object(state));
      _notify();
    }
  }

  void useProject(Json value) {
    project = value;
    _notify();
  }

  Future<void> update(String method, List<dynamic> args) async {
    final value = await client.call(method, args);
    if (value is Map && value.containsKey('versions')) project = object(value);
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
        if (args.isNotEmpty && args[0]['dir'] == dir) project = object(args[0]);
      case 'jobs':
        jobs = objects(args.first);
      case 'consent':
        consents = objects(args.first);
      case 'agent:state':
        agent(args[0] as String).snapshot(object(args[1]));
      case 'agui':
        agent(args[0] as String).reduce(object(args[1]));
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
