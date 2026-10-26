// Tells the person when something on the computer is done or needs them, so they don't have to keep the app open
// and watch: the agent finished (its reply, or a new cut to look at), it asks a question or for an OK, a render or
// export is ready or failed. Only when they aren't looking (the app in the background, or another project open).
// While work runs, an ongoing notification keeps the app connected should it go to the background (an Android
// foreground service, started while the app is still in front), so the end is heard; it goes once nothing runs.
import 'dart:async';
import 'dart:io';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'store.dart';

class Notifier with WidgetsBindingObserver {
  final BridgeStore store;

  /// Opens a project, from a notification about it.
  void Function(String dir)? onOpen;
  Notifier(this.store);

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false, _away = false, _following = false, _asked = false;
  int _next = 100;

  /// What was so the last time the store changed: per project, whether the agent was working; per job, its status;
  /// the OKs already asked for.
  final _busy = <String, bool>{};
  final _jobs = <String, String>{};
  final _consents = <String>{};

  static const _work = AndroidNotificationDetails(
    'work',
    'Work on your computer',
    channelDescription:
        'When the agent, a render or an export is done, or needs you',
    importance: Importance.high,
    priority: Priority.high,
  );
  static const _ongoing = AndroidNotificationDetails(
    'following',
    'Following work',
    channelDescription:
        'While AgentShot follows work on your computer in the background',
    importance: Importance.low,
    priority: Priority.low,
    ongoing: true,
    showWhen: false,
  );

  Future<void> start() async {
    if (!Platform.isAndroid && !Platform.isIOS) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('ic_launcher_monochrome'),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: false,
            requestBadgePermission: false,
            requestSoundPermission: false,
          ),
        ),
        onDidReceiveNotificationResponse: (response) {
          final dir = response.payload;
          if (dir != null && dir.isNotEmpty) onOpen?.call(dir);
        },
      );
    } catch (e) {
      debugPrint('AgentShot: notifications unavailable: $e');
      return;
    }
    _ready = true;
    _remember();
    WidgetsBinding.instance.addObserver(this);
    store.addListener(_changed);
  }

  /// Asks once to send notifications, when the person first sets work going (not at launch, out of the blue).
  Future<void> askPermission() async {
    if (!_ready || _asked) return;
    _asked = true;
    try {
      await _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.requestNotificationsPermission();
      await _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >()
          ?.requestPermissions(alert: true, sound: true);
    } catch (_) {
      // declined, or not asked on this system: the app works as before
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _away = state != AppLifecycleState.resumed;
    _follow();
  }

  /// The state as it is now, so that only what changes from here is announced.
  void _remember() {
    for (final e in store.agents.entries) {
      _busy[e.key] = e.value.busy;
    }
    for (final j in store.jobs) {
      _jobs['${j['id']}'] = '${j['status']}';
    }
    _consents.addAll(store.consents.map((c) => '${c['id']}'));
  }

  /// Not in front of it: the app in the background, or another project open.
  bool _unseen(String? dir) => _away || (dir != null && store.dir != dir);

  String _title(String dir) {
    final listed = store.projects.where((p) => p['dir'] == dir).firstOrNull;
    final open = store.dir == dir ? store.project : null;
    final title = listed?['title'] ?? open?['title'];
    return '${title ?? 'AgentShot'}';
  }

  void _changed() {
    for (final e in store.agents.entries) {
      final was = _busy[e.key] ?? false, now = e.value.busy;
      _busy[e.key] = now;
      if (was && !now) _finished(e.key, e.value);
    }
    for (final j in store.jobs) {
      final id = '${j['id']}', status = '${j['status']}';
      final was = _jobs[id];
      _jobs[id] = status;
      if (was != 'running' || status == 'running') continue;
      final dir = j['project'] as String?;
      if (!_unseen(dir)) continue;
      if (status == 'done') {
        _show(
          '${j['doneTitle'] ?? j['title'] ?? 'Done'}',
          dir != null ? _title(dir) : 'Ready on your computer',
          dir,
        );
      } else if (status == 'failed') {
        _show(
          '${j['title'] ?? 'A job'} didn’t finish',
          '${j['detail'] ?? 'Open AgentShot to see why.'}',
          dir,
        );
      }
    }
    for (final c in store.consents) {
      final id = '${c['id']}';
      if (!_consents.add(id) || !_away) continue;
      _show(
        'AgentShot needs your OK',
        '${c['title'] ?? c['body'] ?? 'Open AgentShot to answer.'}',
        c['dir'] as String?,
      );
    }
    _follow();
  }

  /// The agent's turn ended: what it said, a new cut to look at, or a question for the person.
  void _finished(String dir, AgentState state) {
    if (!_unseen(dir)) return;
    final title = _title(dir);
    if (state.error != null) {
      _show('$title: something went wrong', state.error!, dir);
      return;
    }
    final said = state.messages
        .where(
          (m) =>
              m['role'] == 'assistant' &&
              '${m['content'] ?? ''}'.trim().isNotEmpty,
        )
        .lastOrNull?['content'];
    final reply = '${said ?? ''}'
        .replaceAll(RegExp(r'[*_`#>]'), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final cut = store.dir == dir && store.project?['proposal'] != null;
    final asks = reply.endsWith('?');
    _show(
      cut
          ? 'A new cut is ready'
          : asks
          ? 'AgentShot has a question'
          : 'AgentShot is done',
      reply.isEmpty
          ? title
          : '$title: ${reply.length > 160 ? '${reply.substring(0, 157)}…' : reply}',
      dir,
    );
  }

  void _show(String title, String body, String? dir) {
    if (!_ready) return;
    _plugin
        .show(
          id: _next++,
          title: title,
          body: body,
          notificationDetails: const NotificationDetails(
            android: _work,
            iOS: DarwinNotificationDetails(),
          ),
          payload: dir ?? '',
        )
        .catchError((Object e) => debugPrint('AgentShot: notification: $e'));
  }

  /// While work runs: an ongoing notification that keeps the app connected if it goes to the background, so the end
  /// of the work is heard. It starts as the work starts, with the app still in front (Android lets an app in the
  /// background start none), and goes once nothing runs.
  void _follow() {
    if (!_ready || !Platform.isAndroid) return;
    final want =
        store.connected && store.running.isNotEmpty && (!_away || _following);
    if (want) {
      _stopping?.cancel();
      _stopping = null;
      // only work that lasts: a job over in a moment needs no following, and Android ends an app whose service is
      // stopped before it has finished starting
      if (!_following && !_away) {
        _starting ??= Timer(const Duration(seconds: 1), () {
          _starting = null;
          if (store.connected && store.running.isNotEmpty && !_away) _start();
        });
      }
    } else {
      _starting?.cancel();
      _starting = null;
      if (_following) {
        // never within a few seconds of starting (the same rule)
        final left =
            const Duration(seconds: 5) - DateTime.now().difference(_since);
        _stopping ??= Timer(left.isNegative ? Duration.zero : left, () {
          _stopping = null;
          _stop();
        });
      }
    }
  }

  Timer? _starting, _stopping;
  DateTime _since = DateTime.now();

  AndroidFlutterLocalNotificationsPlugin? get _android => _plugin
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();

  void _start() {
    final android = _android;
    if (android == null || _following) return;
    _following = true;
    _since = DateTime.now();
    android
        .startForegroundService(
          id: 1,
          title: 'AgentShot is working',
          body:
              '${store.running.join(', ')} on ${store.client.connection?.name ?? 'your computer'}',
          notificationDetails: _ongoing,
          startType: AndroidServiceStartType.startNotSticky,
          foregroundServiceTypes: {
            AndroidServiceForegroundType.foregroundServiceTypeDataSync,
          },
        )
        .catchError((Object e) => debugPrint('AgentShot: following work: $e'));
  }

  void _stop() {
    final android = _android;
    if (android == null || !_following) return;
    // work again meanwhile: keep following
    if (store.connected && store.running.isNotEmpty) return;
    _following = false;
    android.stopForegroundService().catchError(
      (Object e) => debugPrint('AgentShot: following work: $e'),
    );
  }

  void dispose() {
    _starting?.cancel();
    _stopping?.cancel();
    if (!_ready) return;
    WidgetsBinding.instance.removeObserver(this);
    store.removeListener(_changed);
  }
}
