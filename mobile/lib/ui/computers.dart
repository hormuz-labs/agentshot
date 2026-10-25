import 'dart:async';
import 'package:flutter/material.dart';
import '../bridge/account.dart';
import '../bridge/client.dart';
import 'common.dart';
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
          error = '$e';
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

  /// A cloud worker, leased now, opened like a computer.
  Future<void> useCloud() async {
    setState(() {
      opening = 'cloud';
      error = null;
    });
    try {
      final worker = await widget.account.lease();
      if (!mounted) return;
      setState(() => opening = null);
      await open(worker);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted && opening == 'cloud') setState(() => opening = null);
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
    final list = computers;
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
                            : c.pool
                            ? 'Cloud worker, yours for now'
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
              // a computer AgentShot lends: when none of the person's is on (or they'd rather not use theirs)
              if (list != null && !list.any((c) => c.pool)) ...[
                const SizedBox(height: 16),
                Card(
                  child: ListTile(
                    key: const ValueKey('use-cloud-worker'),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    leading: const Icon(Icons.cloud_outlined),
                    title: const Text('Use a cloud worker'),
                    subtitle: Text(
                      opening == 'cloud'
                          ? 'Getting one…'
                          : widget.account.poolFree > 0
                          ? '${widget.account.poolFree} free. It keeps only what you make on it.'
                          : 'None free right now.',
                    ),
                    trailing: opening == 'cloud'
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.chevron_right),
                    enabled: opening == null && widget.account.poolFree > 0,
                    onTap: useCloud,
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
