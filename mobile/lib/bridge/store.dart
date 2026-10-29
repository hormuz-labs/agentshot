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

/// A file's machine name (an id, a camera's numbering, a screen recording) rather than one a person gave it.
final _machineName = RegExp(
  r'^(?:[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{16,}$|(?:IMG|VID|PXL|MOV|DSC|DJI|MVI|GOPR?)_?\d|\d{6,}|Screen[ _]?Recording)',
  caseSensitive: false,
);

/// What to call a project: its title, unless that's only its footage's machine name; then its latest cut's name (from
/// [full], the whole project, when the list has only the title), else "Untitled film".
String projectName(Json p, {Json? full}) {
  final title = '${p['title'] ?? ''}'.trim();
  if (title.isNotEmpty && !_machineName.hasMatch(title)) return title;
  final cuts = objects((full ?? p)['versions'])
      .where(
        (v) => v['by'] == 'agent' && '${v['title'] ?? ''}'.trim().isNotEmpty,
      )
      .toList();
  if (cuts.isNotEmpty) return '${cuts.last['title']}'.trim();
  return 'Untitled film';
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
      // each kept project's own name (its cut's, when the title is only a file's), before the computer answers
      for (final p in projects) {
        if (p['dir'] case final String d) {
          _named(await saved.read('project:$d'));
        }
      }
      _notify();
    }
  }

  /// Lets go of everything kept of the computer the phone is leaving.
  Future<void> forgetSaved() async {
    await saved.clear();
    saved.computer = null;
    projects = [];
    _tags.clear();
  }

  /// Each project's name, from the whole project when the phone has it (see [projectName]): for the list, which has
  /// only titles.
  final _names = <String, String>{};
  String nameOf(Json p) => _names[p['dir']] ?? projectName(p);
  void _named(Object? full) {
    if (full is Map && full['dir'] is String) {
      _names[full['dir'] as String] = projectName(object(full));
    }
  }

  /// The computer's tag for what's kept under each name (see [BridgeClient.callKept]): sent back when asking again,
  /// so an unchanged answer isn't sent twice. Jobs and requests for an OK aren't kept on disk, only here.
  final _tags = <String, String?>{};

  Future<String?> _tag(String name) async {
    if (_tags.containsKey(name)) return _tags[name];
    final kept = await saved.read('tag:$name');
    return _tags[name] = kept is String ? kept : null;
  }

  /// Keeps [value] under [name] with the tag of the answer it is ([tag]); none when it changed here since (an event,
  /// an edit), so the next ask gets it whole.
  void _keep(String name, Object? value, [String? tag]) {
    if (name.startsWith('project:')) _named(value);
    saved.write(name, value);
    saved.write('tag:$name', tag);
    _tags[name] = tag;
  }

  /// A conversation as kept: what was said, never a run that looks like it's still going.
  void _keepConversation(String dir) {
    final a = agents[dir];
    if (a == null || !a.loaded) return;
    saved.write('agent:$dir', {'messages': a.messages, 'cost': a.cost});
  }

  /// The gallery's examples: the ones kept from last time at once (the computer's list replaces them behind, for next
  /// time), else the computer's.
  Future<List<Json>> examples() async {
    final kept = await saved.read('gallery');
    final fresh = client.call('gallery:list').then((list) {
      saved.write('gallery', objects(list));
      return objects(list);
    });
    if (kept is List && kept.isNotEmpty) {
      fresh.ignore();
      return objects(kept);
    }
    return fresh;
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
    final answers = await Future.wait([
      // the list showing is the kept one only when there is one (an empty list may just not be read yet)
      client.callKept(
        'project:recent',
        [],
        have: projects.isEmpty ? null : await _tag('projects'),
      ),
      client.callKept('jobs:list', [], have: _tags['jobs']),
      client.callKept('consent:list', [], have: _tags['consents']),
    ]);
    if (!answers[0].unchanged) {
      projects = objects(answers[0].value);
      _keep('projects', projects, answers[0].tag);
    }
    if (!answers[1].unchanged) {
      jobs = objects(answers[1].value);
      _tags['jobs'] = answers[1].tag;
    }
    if (!answers[2].unchanged) {
      consents = objects(answers[2].value);
      _tags['consents'] = answers[2].tag;
    }
    _notify();
    unawaited(_keepAhead());
  }

  bool _ahead = false;

  /// The latest projects, kept before they're tapped: each opens at once from the phone, even the first time.
  /// Only what changed comes over; a computer too old to hand a project over unopened is left be.
  Future<void> _keepAhead() async {
    if (_ahead) return;
    _ahead = true;
    try {
      for (final p in projects.take(12)) {
        final d = p['dir'];
        if (d is! String || d == dir) continue;
        final name = 'project:$d';
        final answer = await client.callKept('project:peek', [
          d,
        ], have: await _tag(name));
        if (!answer.unchanged && answer.value is Map) {
          _keep(name, answer.value, answer.tag);
        } else if (!_names.containsKey(d)) {
          _named(await saved.read(name));
        }
      }
    } catch (_) {
      // out of reach, or a computer from before peeking: the project comes when it's opened
    } finally {
      _ahead = false;
      _notify();
    }
  }

  /// Shows what the phone kept of a project (and its conversation), if it kept anything: true when it did.
  Future<bool> showSaved(String directory) async {
    final kept = await saved.read('project:$directory');
    if (kept is! Map) return false;
    project = object(kept);
    _named(kept);
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
      // what's showing is what's kept: unchanged on the computer, nothing more comes
      final answer = await client.callKept('project:open', [
        directory,
      ], have: kept ? await _tag('project:$directory') : null);
      if (!answer.unchanged) {
        project = object(answer.value);
        _keep('project:$directory', project, answer.tag);
      }
    } catch (_) {
      if (kept) return;
      rethrow;
    }
    _notify();
    final state = await client.call('agent:attach', [directory]);
    if (state is Map && state['messages'] is List) {
      agent(directory).snapshot(object(state));
      _keepConversation(directory);
      _notify();
    }
  }

  Future<void> update(String method, List<dynamic> args) async {
    final value = await client.call(method, args);
    if (value is Map && value.containsKey('versions')) {
      project = object(value);
      if (dir case final d?) _keep('project:$d', project);
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
          _keep('project:$dir', project);
        }
      case 'jobs':
        jobs = objects(args.first);
        _tags['jobs'] = null;
      case 'consent':
        consents = objects(args.first);
        _tags['consents'] = null;
      case 'agent:state':
        agent(args[0] as String).snapshot(object(args[1]));
        _keepConversation(args[0] as String);
        // what's there when the phone first hears of it counts as seen: only what comes after is new
        if (!seen.containsKey(args[0])) markSeen(args[0] as String);
      case 'agui':
        final event = object(args[1]);
        agent(args[0] as String).reduce(event);
        if (event['type'] == 'MESSAGES_SNAPSHOT' ||
            event['type'] == 'RUN_FINISHED') {
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
