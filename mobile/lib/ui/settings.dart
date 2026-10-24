import 'package:flutter/material.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'project.dart' show dropdown;

class SettingsScreen extends StatelessWidget {
  final BridgeStore store;
  final ThemeMode theme;
  final ValueChanged<ThemeMode> onTheme;
  final Future<void> Function() onDisconnect;
  const SettingsScreen({
    super.key,
    required this.store,
    required this.theme,
    required this.onTheme,
    required this.onDisconnect,
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
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text('Settings', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 24),
      dropdown('Appearance', theme.name, const {
        'system': 'Follow system',
        'light': 'Light',
        'dark': 'Dark',
      }, (v) => onTheme(ThemeMode.values.byName(v))),
      const SizedBox(height: 20),
      ListTile(
        leading: const Icon(Icons.computer),
        title: const Text('Connected desktop'),
        subtitle: Text(
          store.client.connection?.url.toString() ?? 'Disconnected',
        ),
      ),
      ListTile(
        leading: const Icon(Icons.key_outlined),
        title: const Text('AI keys'),
        subtitle: const Text('Keys are stored on your desktop'),
        onTap: () => keys(context),
      ),
      ListTile(
        leading: const Icon(Icons.auto_awesome_outlined),
        title: const Text('Skills & profiles'),
        onTap: () => skills(context),
      ),
      ListTile(
        leading: const Icon(Icons.psychology_outlined),
        title: const Text('Memory'),
        subtitle: const Text('Your taste, across projects'),
        onTap: () => memory(context),
      ),
      ListTile(
        leading: const Icon(Icons.build_outlined),
        title: const Text('Desktop tools'),
        onTap: () => tools(context),
      ),
      ListTile(
        leading: const Icon(Icons.language),
        title: const Text('Agent browser'),
        subtitle: const Text('Browser runs on your computer'),
        onTap: () => browser(context),
      ),
      ListTile(
        leading: const Icon(Icons.account_circle_outlined),
        title: const Text('AgentShot account'),
        onTap: () => panel(
          context,
          'Desktop account',
          'account:status',
          (data, reload) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                data['email'] == null
                    ? 'Sign in through AgentShot on your desktop.'
                    : 'Signed in as ${data['email']}',
              ),
              const SizedBox(height: 12),
              if (data['email'] != null)
                AsyncPanel(
                  load: () => store.client.call('account:balance'),
                  builder: (value, _) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Credits: ${value['credits']}'),
                      Text('Plan: ${value['plan']?['name'] ?? 'Free'}'),
                      for (final tier in objects(value['tiers']))
                        ListTile(
                          title: Text('${tier['name']}'),
                          subtitle: Text(
                            tier['available'] == true
                                ? 'Available'
                                : 'Unavailable',
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      ListTile(
        leading: const Icon(Icons.dns_outlined),
        title: const Text('Model providers'),
        onTap: () => panel(
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
        ),
      ),
      ListTile(
        leading: const Icon(Icons.info_outline),
        title: const Text('About AgentShot'),
        onTap: () => showAboutDialog(
          context: context,
          applicationName: 'AgentShot',
          applicationIcon: Image.asset(
            'assets/manul.png',
            width: 48,
            height: 48,
          ),
          applicationVersion: '0.1.0',
          applicationLegalese: '© Hormuz Labs · Apache-2.0',
          children: [
            const Text(
              'A video editor you direct by talking. Mobile companion for Android and iOS.\nagentshot.si',
            ),
          ],
        ),
      ),
      const SizedBox(height: 20),
      OutlinedButton.icon(
        onPressed: () => guard(context, onDisconnect),
        icon: const Icon(Icons.link_off),
        label: const Text('Disconnect this device'),
      ),
      const SizedBox(height: 16),
      const Text(
        'To revoke this device’s access, use Settings → Mobile on the desktop. Stopping the bridge revokes all paired devices.',
      ),
    ],
  );

  void keys(BuildContext context) => panel(
    context,
    'Bring your own keys',
    'keys:list',
    (data, reload) => Column(
      children: [
        for (final key in objects(data))
          ListTile(
            title: Text('${key['label']}'),
            subtitle: Text(
              '${(key['unlocks'] as List? ?? []).join(', ')}\n${key['set'] == true ? 'Key is set' : 'No key configured'}',
            ),
            isThreeLine: true,
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => guard(context, () async {
              final value = await askText(
                context,
                '${key['label']} key',
                hint: 'Paste key; leave empty to remove',
                secret: true,
              );
              if (value == null) return;
              await store.client.call('keys:set', [key['env'], value]);
              reload();
            }),
          ),
      ],
    ),
  );

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
