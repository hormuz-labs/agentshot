import 'package:flutter/material.dart';
import 'splash.dart' show appVersion;
import '../bridge/account.dart';
import '../bridge/client.dart';
import '../bridge/notify.dart' show NotifyPrefs;
import '../bridge/store.dart';
import 'common.dart';
import 'design.dart';
import 'delete_account.dart';
import 'project.dart' show dropdown;
import 'setup_ai.dart';

class SettingsScreen extends StatelessWidget {
  final BridgeStore store;
  final ThemeMode theme;
  final ValueChanged<ThemeMode> onTheme;
  final Future<void> Function() onDisconnect;
  final Account? account;
  final Future<void> Function() onSignOut;
  const SettingsScreen({
    super.key,
    required this.store,
    required this.theme,
    required this.onTheme,
    required this.onDisconnect,
    this.account,
    required this.onSignOut,
  });
  Future<void> panel(
    BuildContext context,
    String title,
    String method,
    Widget Function(dynamic, VoidCallback) content,
  ) async {
    await sheet(
      context,
      title,
      AsyncPanel(load: () => store.client.call(method), builder: content),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final cloud = store.onCloud;
    final computer = store.client.connection?.name ?? 'Your computer';
    final signedIn = account?.signedIn == true ? account : null;
    return ListView(
      // room at the end to scroll clear of the tab bar
      padding: const EdgeInsets.fromLTRB(Space.page, Space.xxl, Space.page, 120),
      children: [
        Text('Settings', style: Theme.of(context).textTheme.displaySmall),
        const SizedBox(height: Space.sm),
        // who this is: the account this phone signed in with (its credits), or the computer's when paired by code
        Section('Account', [
          ListTile(
            key: const ValueKey('settings-account'),
            leading: CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              foregroundColor: scheme.onPrimaryContainer,
              child: signedIn?.email?.isNotEmpty == true
                  ? Text(signedIn!.email![0].toUpperCase())
                  : const Icon(Icons.person_outline),
            ),
            title: Text(
              signedIn?.email != null
                  ? 'Signed in as ${signedIn!.email}'
                  : 'AgentShot account',
            ),
            subtitle: Credits(store: store),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => accountDetails(context),
          ),
          if (signedIn != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 8,
                  children: [
                    TextButton.icon(
                      onPressed: () => leaving(context, onSignOut),
                      icon: const Icon(Icons.logout),
                      label: const Text('Sign out'),
                    ),
                    TextButton.icon(
                      key: const ValueKey('settings-delete-account'),
                      style: TextButton.styleFrom(
                        foregroundColor: scheme.error,
                      ),
                      onPressed: () => deleteAccount(context, signedIn.email),
                      icon: const Icon(Icons.person_remove_outlined),
                      label: const Text('Delete my account'),
                    ),
                  ],
                ),
              ),
            ),
        ], divided: false),
        // what this phone works on now, and how to change it
        Section(cloud ? 'AgentShot Cloud' : 'Computer', [
          ListTile(
            leading: Icon(cloud ? Icons.cloud_outlined : Icons.computer),
            title: Text(computer),
            subtitle: Row(
              children: [
                Icon(
                  Icons.circle,
                  size: 10,
                  color: store.connected ? Colors.green : scheme.outline,
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(store.connected ? 'Connected' : 'Connecting…'),
                ),
              ],
            ),
          ),
          if (cloud)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                'Your projects, conversations and settings live in your own space, kept for you between visits.',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: signedIn != null
                  ? OutlinedButton.icon(
                      onPressed: () => leaving(context, onDisconnect),
                      icon: const Icon(Icons.swap_horiz),
                      label: const Text('Switch computer'),
                    )
                  : OutlinedButton.icon(
                      onPressed: () => guard(context, onDisconnect),
                      icon: const Icon(Icons.link_off),
                      label: const Text('Disconnect this device'),
                    ),
            ),
          ),
          if (signedIn == null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Text(
                'You can also remove this phone on your computer, in AgentShot → Settings → Mobile.',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ),
        ], divided: false),
        // how AgentShot thinks, in one line, and where to change it
        Section('AI', [AiTile(store: store)]),
        // the computer's own: not a cloud worker's, which keeps them to itself
        if (!cloud)
          Section('On $computer', [
            ListTile(
              leading: const Icon(Icons.auto_awesome_outlined),
              title: const Text('Skills & profiles'),
              subtitle: const Text('What the agent knows how to do'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => skills(context),
            ),
            ListTile(
              leading: const Icon(Icons.psychology_outlined),
              title: const Text('Memory'),
              subtitle: const Text('Your taste, across projects'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => memory(context),
            ),
            ListTile(
              leading: const Icon(Icons.build_outlined),
              title: const Text('Desktop tools'),
              subtitle: const Text('Speech recognition and extras'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => tools(context),
            ),
            ListTile(
              leading: const Icon(Icons.language),
              title: const Text('Agent browser'),
              subtitle: const Text('The browser the agent uses'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => browser(context),
            ),
            ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: const Text('Model providers'),
              subtitle: const Text('Custom endpoints set up on the computer'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => providers(context),
            ),
          ]),
        Section('App', [
          // light or dark at a tap (or as the phone is set)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Appearance'),
                const SizedBox(height: 10),
                SegmentedButton<ThemeMode>(
                  key: const ValueKey('appearance'),
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(
                      value: ThemeMode.system,
                      icon: Icon(Icons.brightness_auto_outlined),
                      label: Text('System'),
                    ),
                    ButtonSegment(
                      value: ThemeMode.light,
                      icon: Icon(Icons.light_mode_outlined),
                      label: Text('Light'),
                    ),
                    ButtonSegment(
                      value: ThemeMode.dark,
                      icon: Icon(Icons.dark_mode_outlined),
                      label: Text('Dark'),
                    ),
                  ],
                  selected: {theme},
                  onSelectionChanged: (v) => onTheme(v.first),
                ),
              ],
            ),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_none),
            title: const Text('Notifications'),
            subtitle: const Text('When work is done, or needs you'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => notifications(context),
          ),
          StorageTile(store: store),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('About AgentShot'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final version = await appVersion;
              if (!context.mounted) return;
              showAboutDialog(
                context: context,
                applicationName: 'AgentShot',
                applicationIcon: Image.asset(
                  'assets/manul.png',
                  width: 48,
                  height: 48,
                ),
                applicationVersion: version,
                applicationLegalese:
                    '© 2026 agenthormuz@proton.me · GPL-3.0-or-later',
                children: [
                  const Text(
                    'A video editor you direct by talking. Mobile companion for Android and iOS.\nagentshot.si',
                  ),
                ],
              );
            },
          ),
        ]),
      ],
    );
  }

  /// Which notifications to get, each on or off (kept on this phone).
  void notifications(BuildContext context) => sheet(
    context,
    'Notifications',
    StatefulBuilder(
      builder: (context, set) => Column(
        children: [
          for (final MapEntry(key: kind, value: (title, about))
              in NotifyPrefs.kinds.entries)
            SwitchListTile(
              key: ValueKey('notify-$kind'),
              title: Text(title),
              subtitle: Text(about),
              value: NotifyPrefs.on[kind] ?? true,
              onChanged: (v) async {
                await NotifyPrefs.set(kind, v);
                set(() {});
              },
            ),
        ],
      ),
    ),
  );

  /// The account in full: who, credits, plan and what it unlocks. This phone's account when it signed in, else the
  /// computer's.
  void accountDetails(BuildContext context) {
    final mine = account?.signedIn == true ? account : null;
    panel(context, 'AgentShot account', 'account:status', (data, reload) {
      final email = mine?.email ?? data['email'] as String?;
      if (email == null) {
        return const Text('Sign in through AgentShot on your desktop.');
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Signed in as $email'),
          const SizedBox(height: 16),
          AsyncPanel(
            load: () async => mine != null
                ? await mine.balance()
                : object(await store.client.call('account:balance')),
            builder: (value, _) {
              final tiers = objects(value['tiers']);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    Credits.describe(object(value)).split(' · ').first,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text('${value['plan']?['name'] ?? 'Free'} plan'),
                  if (tiers.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Models',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    for (final tier in tiers)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          tier['available'] == true
                              ? Icons.check_circle_outline
                              : Icons.lock_outline,
                        ),
                        title: Text('${tier['name']}'),
                        subtitle: Text(
                          tier['available'] == true
                              ? 'Included'
                              : 'Not on this plan',
                        ),
                      ),
                  ],
                ],
              );
            },
          ),
        ],
      );
    });
  }

  void providers(BuildContext context) => panel(
    context,
    'Model providers',
    'providers:list',
    (data, reload) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Custom provider endpoints are configured on the desktop. Pick their models inside any project.',
        ),
        for (final provider in objects(data['providers']))
          ListTile(
            title: Text('${provider['name'] ?? provider['id']}'),
            subtitle: Text('${provider['baseUrl'] ?? ''}'),
          ),
      ],
    ),
  );

  void keys(BuildContext context) => showKeys(context, store);

  /// Leaving AgentShot Cloud gives the spot back, which stops whatever still runs there: asks first when something does.
  Future<void> leaving(
    BuildContext context,
    Future<void> Function() leave,
  ) async {
    final running = store.onCloud ? store.running : const <String>[];
    if (running.isNotEmpty &&
        !await confirm(
          context,
          'Leave AgentShot Cloud?',
          'Still running there: ${running.join(', ')}. Leaving now stops it. Your projects stay in your space.',
          action: 'Leave anyway',
        )) {
      return;
    }
    if (context.mounted) await guard(context, leave);
  }

  void skills(BuildContext context) => panel(
    context,
    'Skills & profiles',
    'skills:state',
    (data, reload) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        dropdown(
          'Profile',
          '${data['profile']['id']}',
          {
            for (final p in objects(data['profiles']))
              '${p['id']}': '${p['name']}',
          },
          (id) => guard(context, () async {
            await store.client.call('skills:profile', [id]);
            reload();
          }),
        ),
        TextButton.icon(
          onPressed: () => guard(context, () async {
            final name = await askText(context, 'New profile');
            if (name != null && name.isNotEmpty) {
              await store.client.call('skills:newProfile', [name]);
              reload();
            }
          }),
          icon: const Icon(Icons.add),
          label: const Text('New profile'),
        ),
        for (final skill in objects(data['skills']))
          SwitchListTile(
            title: Text('${skill['name']}'),
            subtitle: Text('${skill['description']}'),
            value: (data['enabled'] as List).contains(skill['id']),
            onChanged: (value) => guard(context, () async {
              await store.client.call('skills:enable', [skill['id'], value]);
              reload();
            }),
          ),
      ],
    ),
  );

  void memory(BuildContext context) => panel(
    context,
    'Memory',
    'memory:list',
    (data, reload) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton.icon(
          onPressed: () => editMemory(context, reload),
          icon: const Icon(Icons.add),
          label: const Text('Remember something'),
        ),
        for (final fact in objects(data))
          Card(
            child: ListTile(
              title: Text('${fact['description']}'),
              subtitle: Text('${fact['body']}'),
              onTap: () => editMemory(context, reload, fact: fact),
              trailing: IconButton(
                tooltip: 'Forget',
                icon: const Icon(Icons.delete_outline),
                onPressed: () => guard(context, () async {
                  if (await confirm(
                    context,
                    'Forget this?',
                    '${fact['description']}',
                  )) {
                    await store.client.call('memory:forget', [fact['name']]);
                    reload();
                  }
                }),
              ),
            ),
          ),
      ],
    ),
  );
  void editMemory(BuildContext context, VoidCallback reload, {Json? fact}) =>
      guard(context, () async {
        final description = await askText(
          context,
          'What should AgentShot remember?',
          initial: fact?['description'] as String? ?? '',
        );
        if (description == null || description.isEmpty || !context.mounted) {
          return;
        }
        final body = await askText(
          context,
          'Details',
          initial: fact?['body'] as String? ?? description,
        );
        if (body == null) return;
        final name =
            fact?['name'] ?? 'mobile-${DateTime.now().millisecondsSinceEpoch}';
        await store.client.call('memory:save', [name, description, body]);
        reload();
      });

  void tools(BuildContext context) => panel(
    context,
    'Tools on your desktop',
    'tools:list',
    (data, reload) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AsyncPanel(
          load: () => store.client.call('tools:status'),
          builder: (items, _) => Column(
            children: [
              for (final tool in objects(items))
                ListTile(
                  leading: Icon(
                    tool['ok'] == true
                        ? Icons.check_circle_outline
                        : Icons.error_outline,
                  ),
                  title: Text('${tool['name']}'),
                  subtitle: Text('${tool['version'] ?? 'Not available'}'),
                ),
            ],
          ),
        ),
        for (final tool in objects(data))
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${tool['name']}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text('${tool['description']}'),
                  Text('Download: ${tool['sizeMB']} MB'),
                  OutlinedButton(
                    onPressed: () => guard(context, () async {
                      final installed = tool['installed'] == true;
                      if (await confirm(
                        context,
                        installed ? 'Remove tool?' : 'Install tool?',
                        installed
                            ? 'Remove ${tool['name']} from your desktop?'
                            : 'Download approximately ${tool['sizeMB']} MB on your desktop?',
                      )) {
                        await store.client.call(
                          installed ? 'tools:remove' : 'tools:install',
                          [tool['id']],
                        );
                        reload();
                      }
                    }),
                    child: Text(
                      tool['installed'] == true ? 'Remove' : 'Install',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ExpansionTile(
          title: const Text('Speech recognition'),
          children: [
            AsyncPanel(
              load: () => store.client.call('whisper:status'),
              builder: (value, _) => Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  '${value['active']?['label'] ?? 'No engine ready. Configure speech recognition on your desktop.'}',
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  void browser(BuildContext context) => panel(
    context,
    'Agent browser on your desktop',
    'browser:state',
    (data, reload) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Navigate and manage the agent’s desktop tabs here. Interactive page takeover and sign-in happen on the computer.',
        ),
        const SizedBox(height: 12),
        AsyncPanel(
          load: () => store.client.call('browser:mode'),
          builder: (value, again) => dropdown(
            'Browser',
            value as String,
            const {
              'manul': 'AgentShot’s own browser',
              'chrome': 'Your desktop Chrome',
            },
            (mode) => guard(context, () async {
              await store.client.call('browser:set-mode', [mode]);
              again();
            }),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          children: [
            for (final entry in const {
              'browser:back': Icons.arrow_back,
              'browser:forward': Icons.arrow_forward,
              'browser:reload': Icons.refresh,
              'browser:new': Icons.add,
            }.entries)
              IconButton(
                tooltip: entry.key.split(':').last,
                onPressed: () => guard(context, () async {
                  await store.client.call(entry.key);
                  reload();
                }),
                icon: Icon(entry.value),
              ),
            OutlinedButton(
              onPressed: () => guard(context, () async {
                final url = await askText(
                  context,
                  'Open URL',
                  hint: 'https://example.com',
                );
                if (url != null && url.isNotEmpty) {
                  await store.client.call('browser:navigate', [url]);
                  reload();
                }
              }),
              child: const Text('Navigate'),
            ),
          ],
        ),
        for (final tab in objects(data['tabs']))
          ListTile(
            title: Text('${tab['title']}'),
            subtitle: Text('${tab['url']}'),
            selected: tab['id'] == data['active'],
            onTap: () => guard(context, () async {
              await store.client.call('browser:select', [tab['id']]);
              reload();
            }),
            trailing: IconButton(
              tooltip: 'Close tab',
              icon: const Icon(Icons.close),
              onPressed: () => guard(context, () async {
                await store.client.call('browser:close', [tab['id']]);
                reload();
              }),
            ),
          ),
        Text('Browser connection: ${data['bsk']?['status'] ?? 'unknown'}'),
        TextButton(
          onPressed: reload,
          child: const Text('Refresh browser state'),
        ),
      ],
    ),
  );
}

/// Credits left and the plan, from the account this phone signed in with, or else the computer's.
class Credits extends StatelessWidget {
  final BridgeStore store;
  const Credits({super.key, required this.store});

  static String describe(Json value) {
    final credits = (value['credits'] as num? ?? 0)
        .round()
        .toString()
        .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    return '$credits credits · ${value['plan']?['name'] ?? 'Free'} plan';
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Json>(
    future: store.account?.signedIn == true
        ? store.account!.balance()
        : store.client.call('account:balance').then((v) => object(v)),
    builder: (context, snapshot) => Text(
      snapshot.hasData
          ? describe(snapshot.data!)
          : snapshot.hasError
          ? 'Not signed in'
          : 'Checking credits…',
    ),
  );
}

/// A titled group of settings on a card.
class Section extends StatelessWidget {
  final String title;
  final List<Widget> children;

  /// A line between rows (off for a card that is one item with its actions).
  final bool divided;
  const Section(this.title, this.children, {super.key, this.divided = true});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4),
          child: Overline(title),
        ),
        Card(
          margin: EdgeInsets.zero,
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, child) in children.indexed) ...[
                if (divided && i > 0) const Divider(height: 1, indent: 16),
                child,
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

/// Settings → AI in a line: how AgentShot on the computer thinks now (credits, own keys, or not set up yet). Opens
/// the AI sheet, and reads again when it closes.
class AiTile extends StatefulWidget {
  final BridgeStore store;
  const AiTile({super.key, required this.store});
  @override
  State<AiTile> createState() => _AiTileState();
}

class _AiTileState extends State<AiTile> {
  late Future<String?> summary = _read();

  /// keys:list and the computer's providers, in a line.
  Future<String?> _read() async {
    final keys = objects(await widget.store.client.call('keys:list'));
    final listed = await widget.store.client
        .call('providers:list')
        .catchError((Object _) => null);
    // an older computer may not say: none, then
    final providers = listed is Map ? objects(listed['providers']) : <Json>[];
    return aiSummary(keys, providers);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
    future: summary,
    builder: (context, snapshot) {
      final done =
          snapshot.connectionState == ConnectionState.done &&
          !snapshot.hasError;
      final line = snapshot.data;
      final missing = done && line == null;
      final scheme = Theme.of(context).colorScheme;
      return ListTile(
        key: const ValueKey('settings-ai'),
        leading: Icon(
          missing ? Icons.error_outline : Icons.auto_awesome,
          color: missing ? scheme.error : scheme.primary,
        ),
        title: const Text('AI models'),
        subtitle: Text(
          snapshot.hasError
              ? 'Couldn’t check'
              : !done
              ? 'Checking…'
              : line ?? 'Not set up yet: choose credits or a key',
          style: missing ? TextStyle(color: scheme.error) : null,
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () async {
          await showKeys(context, widget.store);
          if (mounted) {
            setState(() {
              summary = _read();
            });
          }
        },
      );
    },
  );
}

/// What the phone keeps of the computer's films and pictures (to play them at once, offline too), how much room that
/// takes, and a way to let it go.
class StorageTile extends StatefulWidget {
  final BridgeStore store;
  const StorageTile({super.key, required this.store});
  @override
  State<StorageTile> createState() => _StorageTileState();
}

class _StorageTileState extends State<StorageTile> {
  late Future<int> size = widget.store.client.cache.size();
  late final changes = widget.store.client.cache.changes.listen((_) {
    if (mounted) setState(() => size = widget.store.client.cache.size());
  });

  @override
  void initState() {
    super.initState();
    changes;
  }

  @override
  void dispose() {
    changes.cancel();
    super.dispose();
  }

  static String _bytes(int n) => n < 1 << 20
      ? '${(n / 1024).ceil()} KB'
      : n < 1 << 30
      ? '${(n / (1 << 20)).toStringAsFixed(n < 10 << 20 ? 1 : 0)} MB'
      : '${(n / (1 << 30)).toStringAsFixed(1)} GB';

  @override
  Widget build(BuildContext context) => FutureBuilder<int>(
    future: size,
    builder: (context, kept) => ListTile(
      key: const ValueKey('settings-storage'),
      leading: const Icon(Icons.sd_storage_outlined),
      title: const Text('Saved on this phone'),
      subtitle: Text(
        kept.hasData
            ? _bytes(kept.data!)
            : 'Films you’ve watched',
      ),
      trailing: TextButton(
        onPressed: (kept.data ?? 0) == 0
            ? null
            : () => guard(context, () async {
                if (!await confirm(
                  context,
                  'Clear saved films?',
                  'They stay on your computer. They’ll come over again the next time you play them.',
                  action: 'Clear',
                )) {
                  return;
                }
                await widget.store.client.cache.clear();
              }),
        child: const Text('Clear'),
      ),
    ),
  );
}
