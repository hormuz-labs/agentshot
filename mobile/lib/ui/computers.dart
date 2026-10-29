import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import '../bridge/account.dart';
import '../bridge/client.dart';
import 'common.dart';
import 'mascot.dart';
import 'settings.dart' show Credits;

/// After signing in: the person's computers that have AgentShot open and signed in to the same account. Tap one to
/// open it; nothing to pair.
class ComputersScreen extends StatefulWidget {
  final Account account;
  final BridgeClient client;
  final VoidCallback onConnected;
  final Future<void> Function() onSignOut;

  /// Pair with a code instead (a computer that isn't signed in).
  final VoidCallback onCodes;

  /// Why the phone is here again (the computer ended the connection).
  final String? notice;
  const ComputersScreen({
    super.key,
    required this.account,
    required this.client,
    required this.onConnected,
    required this.onSignOut,
    required this.onCodes,
    this.notice,
  });
  @override
  State<ComputersScreen> createState() => _ComputersScreenState();
}

class _ComputersScreenState extends State<ComputersScreen> {
  List<Computer>? computers;
  String? opening;
  bool away = false;
  String? error;
  bool checking = false;
  DateTime? checked;
  Timer? timer;
  late final Future<Json> credits = widget.account.balance();

  @override
  void initState() {
    super.initState();
    load();
    // a computer that signs in shows up by itself: look again every few seconds while there is none, now and
    // then once there are some (and keep "checked … ago" current)
    timer = Timer.periodic(const Duration(seconds: 5), (_) {
      final every = (computers?.isEmpty ?? true) ? 5 : 30;
      final since = checked == null
          ? every
          : DateTime.now().difference(checked!).inSeconds;
      if (opening == null && since >= every) {
        load(quiet: true);
      } else if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  /// [quiet]: a background check, which leaves a message from opening a computer on screen.
  Future<void> load({bool quiet = false}) async {
    if (checking) return;
    setState(() {
      checking = true;
      if (!quiet) error = null;
    });
    try {
      final found = await widget.account.computers();
      if (mounted) setState(() => computers = found);
    } catch (e) {
      if (mounted) {
        setState(() {
          computers ??= [];
          error = plain(e);
        });
      }
      if (!widget.account.signedIn) await widget.onSignOut();
    } finally {
      if (mounted) {
        setState(() {
          checking = false;
          checked = DateTime.now();
        });
      }
    }
  }

  String get lastChecked {
    if (checked == null) return '';
    final seconds = DateTime.now().difference(checked!).inSeconds;
    return seconds < 5 ? 'Checked just now' : 'Checked ${seconds}s ago';
  }

  /// AgentShot Cloud: a screen that finds a spot, opens this person's space there, and then the app.
  Future<void> useCloud(Computer? held) async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => CloudScreen(
          account: widget.account,
          client: widget.client,
          held: held,
        ),
      ),
    );
    if (done == true) {
      widget.onConnected();
    } else if (mounted) {
      await load(quiet: true);
    }
  }

  Future<void> open(Computer computer) async {
    setState(() {
      opening = computer.id;
      error = null;
    });
    try {
      await widget.account.connect(
        widget.client,
        computer,
        away: () => setState(() => away = true),
      );
      widget.onConnected();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) {
        setState(() {
          opening = null;
          away = false;
        });
      }
    }
  }

  IconData icon(Computer c) => c.pool
      ? Icons.cloud_outlined
      : switch (c.platform) {
          'darwin' => Icons.laptop_mac,
          'win32' => Icons.laptop_windows,
          _ => Icons.computer,
        };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final all = computers;
    // the person's own computers; a cloud spot they hold shows on the AgentShot Cloud card instead
    final list = all?.where((c) => !c.pool).toList();
    final held = all?.where((c) => c.pool).firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your computers'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: opening == null && !checking ? load : null,
            icon: checking
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
          ),
          PopupMenuButton<String>(
            tooltip: 'Account',
            onSelected: (v) =>
                v == 'out' ? widget.onSignOut() : widget.onCodes(),
            itemBuilder: (_) => [
              const PopupMenuItem(
                value: 'codes',
                child: Text('Pair with a code instead'),
              ),
              const PopupMenuItem(value: 'out', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (widget.notice != null) ...[
                NoticeBanner(widget.notice!),
                const SizedBox(height: 16),
              ],
              if (widget.account.email != null)
                Text(
                  'Signed in as ${widget.account.email}',
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              FutureBuilder<Json>(
                future: credits,
                builder: (context, snapshot) => snapshot.hasData
                    ? Text(
                        Credits.describe(snapshot.data!),
                        style: text.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      )
                    : const SizedBox.shrink(),
              ),
              const SizedBox(height: 16),
              if (list == null)
                const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (list.isEmpty && error == null) ...[
                Icon(Icons.computer, size: 40, color: scheme.onSurfaceVariant),
                const SizedBox(height: 12),
                Text('Looking for your computers…', style: text.titleLarge),
                const SizedBox(height: 8),
                Text(
                  'Open AgentShot on your computer and sign in there with the same account. It shows up here by itself while AgentShot is open.',
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    OutlinedButton.icon(
                      key: const ValueKey('check-again'),
                      onPressed: checking ? null : load,
                      icon: checking
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh),
                      label: Text(checking ? 'Checking…' : 'Check again'),
                    ),
                    Text(
                      checking ? '' : lastChecked,
                      style: text.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ] else
                for (final c in list)
                  Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      leading: Icon(icon(c)),
                      title: Text(c.name),
                      subtitle: Text(
                        opening == c.id
                            ? (away ? 'Connecting from away…' : 'Connecting…')
                            : 'AgentShot is open',
                      ),
                      trailing: opening == c.id
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.chevron_right),
                      onTap: opening == null ? () => open(c) : null,
                    ),
                  ),
              // no computer handy (or none on): AgentShot lends a spot in its cloud
              if (list != null) ...[
                const SizedBox(height: 24),
                Text(
                  'No computer handy?',
                  style: text.titleSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    key: const ValueKey('agentshot-cloud'),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    leading: const Icon(Icons.cloud_outlined),
                    title: Text(
                      held != null
                          ? 'Continue in AgentShot Cloud'
                          : 'AgentShot Cloud',
                    ),
                    subtitle: Text(
                      held != null || widget.account.poolFree > 0
                          ? 'Work from anywhere, no computer needed. Your projects are kept for you.'
                          : 'Busy right now. Try again in a minute.',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    enabled:
                        opening == null &&
                        (held != null || widget.account.poolFree > 0),
                    onTap: () => useCloud(held),
                  ),
                ),
              ],
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(
                  error!,
                  style: TextStyle(color: scheme.error, fontSize: 13),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Getting into AgentShot Cloud, in plain steps: a spot found, this person's space opened (as they left it), and
/// then the app. On a problem, says so, with Try again.
class CloudScreen extends StatefulWidget {
  final Account account;
  final BridgeClient client;

  /// A spot this person already holds: straight back to it.
  final Computer? held;
  const CloudScreen({
    super.key,
    required this.account,
    required this.client,
    this.held,
  });
  @override
  State<CloudScreen> createState() => _CloudScreenState();
}

class _CloudScreenState extends State<CloudScreen> {
  String step = 'finding';
  String? error;

  /// How long this try has taken, ticking each second: said on screen, and the bar fills against [usual].
  final watch = Stopwatch();
  Timer? tick;
  static const usual = Duration(seconds: 30);

  /// The most a try may take before it says so, whatever is still waiting underneath.
  static const limit = Duration(seconds: 100);

  /// Which try is current: one given up on (timed out, tried again) can't finish the screen later.
  int attempt = 0;

  @override
  void initState() {
    super.initState();
    go();
  }

  @override
  void dispose() {
    tick?.cancel();
    super.dispose();
  }

  Future<void> go() async {
    final mine = ++attempt;
    setState(() {
      error = null;
      step = widget.held == null ? 'finding' : 'opening';
    });
    watch
      ..reset()
      ..start();
    tick?.cancel();
    tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      // past the limit, whatever still waits underneath: said, with Try again (this try can no longer finish)
      if (watch.elapsed >= limit && mine == attempt) {
        attempt++;
        watch.stop();
        tick?.cancel();
        setState(
          () => error =
              'AgentShot Cloud is taking too long to answer. Check this phone’s internet connection, then try again.',
        );
        return;
      }
      setState(() {});
    });
    try {
      await () async {
        final spot = widget.held ?? await widget.account.lease();
        if (!mounted || mine != attempt) return;
        setState(() => step = 'opening');
        await widget.account.connect(
          widget.client,
          spot,
          away: () {
            if (mounted && mine == attempt) setState(() => step = 'network');
          },
          opening: () {
            if (mounted && mine == attempt) setState(() => step = 'opening');
          },
        );
      }();
      if (mounted && mine == attempt) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted && mine == attempt) setState(() => error = '$e');
    } finally {
      if (mine == attempt) {
        watch.stop();
        tick?.cancel();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final (title, hint) = switch (step) {
      'finding' => (
        'Finding a spot in AgentShot Cloud…',
        'This takes a moment.',
      ),
      'network' => (
        'Connecting securely…',
        'Joining your private network, for working from anywhere.',
      ),
      _ => (
        'Opening your space…',
        'Your projects and conversations, as you left them.',
      ),
    };
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Close',
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(false),
        ),
        title: const Text('AgentShot Cloud'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                children: [
                  Mascot(size: 120, busy: error == null),
                  const SizedBox(height: 24),
                  Text(
                    error == null ? title : 'Couldn’t get into AgentShot Cloud',
                    key: const ValueKey('cloud-step'),
                    textAlign: TextAlign.center,
                    style: text.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    error ?? hint,
                    textAlign: TextAlign.center,
                    style: text.bodyMedium?.copyWith(
                      color: error == null
                          ? scheme.onSurfaceVariant
                          : scheme.error,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (error == null) ...[
                    // how far along against the usual, never quite full until it's in; and the seconds, honestly
                    SizedBox(
                      width: 160,
                      child: LinearProgressIndicator(
                        value: min(
                          .92,
                          watch.elapsed.inMilliseconds / usual.inMilliseconds,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      watch.elapsed < usual
                          ? 'Usually under half a minute · ${watch.elapsed.inSeconds} s'
                          : 'Taking longer than usual · ${watch.elapsed.inSeconds} s',
                      style: text.labelMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ] else
                    FilledButton(onPressed: go, child: const Text('Try again')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
