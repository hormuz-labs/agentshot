import 'package:flutter/material.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'settings.dart' show Credits;

/// Sends a note to the agent on the computer. When the computer has no AI to edit with yet, offers to set it up
/// (AgentShot credits or the person's own key) and sends the note again once it is.
Future<void> sendToAgent(
  BuildContext context,
  BridgeStore store,
  String dir,
  Json message,
) async {
  try {
    await store.client.call('agent:send', [dir, message]);
  } on BridgeException catch (e) {
    if (e.code != 'needs-key' || !context.mounted) rethrow;
    if (!await setUpAi(context, store)) {
      throw BridgeException(
        'Choose AgentShot credits or an AI key to send notes.',
      );
    }
    try {
      await store.client.call('agent:send', [dir, message]);
    } on BridgeException catch (again) {
      // the keys were closed without adding one
      if (again.code != 'needs-key') rethrow;
      throw BridgeException(
        'Add an AI key or use AgentShot credits to send notes.',
      );
    }
  }
}

/// Lets the person choose how AgentShot on their computer thinks. True once it can.
Future<bool> setUpAi(BuildContext context, BridgeStore store) async {
  final account = store.account;
  final choice = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Set up AI on your computer',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          const Text(
            'AgentShot needs an AI model to edit your film. Choose one; you can change it later in Settings.',
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              key: const ValueKey('use-credits'),
              leading: const Icon(Icons.auto_awesome),
              title: const Text('Use AgentShot credits'),
              subtitle: Text(
                account?.signedIn == true
                    ? 'With ${account!.email ?? 'your account'}. The best model for each job, no keys to manage.'
                    : 'Continue with Google. New accounts start with free credits.',
              ),
              onTap: () => Navigator.pop(context, 'credits'),
            ),
          ),
          Card(
            child: ListTile(
              key: const ValueKey('use-own-key'),
              leading: const Icon(Icons.key_outlined),
              title: const Text('Use my own AI key'),
              subtitle: const Text(
                'Anthropic, Google or OpenAI. It stays on your computer.',
              ),
              onTap: () => Navigator.pop(context, 'key'),
            ),
          ),
        ],
      ),
    ),
  );
  if (choice == null || !context.mounted) return false;
  if (choice == 'key') {
    await showKeys(context, store);
    return true; // try again: a key added there sends the note
  }
  // AgentShot credits: the account this phone signs in with, handed to the computer
  if (account == null) return false;
  if (!account.signedIn) await account.signIn();
  await store.client.call('account:adopt', [
    {'key': account.key, 'keyId': ?account.keyId, 'email': ?account.email},
  ]);
  if (store.onCloud) await account.useCloudCredits();
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Your computer now uses your AgentShot credits.'),
      ),
    );
  }
  return true;
}

/// What each kind of model does for the person, in their words (the desktop says text, images, voice, music).
const _unlocks = {
  'text': 'Editing',
  'images': 'Images',
  'voice': 'Voices',
  'music': 'Music',
};

/// A provider set up on the computer that can be used now: its key is there, or it runs on the computer itself (a
/// local model, which usually needs none).
bool usable(Json provider) {
  if (provider['keySet'] == true) return true;
  final host = Uri.tryParse('${provider['baseUrl'] ?? ''}')?.host ?? '';
  return host == 'localhost' || host == '127.0.0.1' || host == '::1' || host.endsWith('.local');
}

/// How AgentShot on the computer thinks, in a line: AgentShot credits, the person's own keys, providers they set up
/// there (a local model, say), or nothing yet. [keys] is keys:list, [providers] providers:list's. Null when nothing
/// is set up.
String? aiSummary(List<Json> keys, [List<Json> providers = const []]) {
  final credits = keys.any((k) => k['env'] == 'MANUL_KEY' && k['set'] == true);
  final own = [
    for (final k in keys)
      if (k['env'] != 'MANUL_KEY' && k['set'] == true) '${k['label']} key',
    for (final p in providers)
      if (usable(p)) '${p['name'] ?? p['id']}',
  ];
  if (credits && own.isNotEmpty) {
    return 'AgentShot credits, plus your ${own.join(', ')}';
  }
  if (credits) return 'AgentShot credits';
  if (own.isNotEmpty) return 'Your ${own.join(', ')}';
  return null;
}

/// How AgentShot on the computer thinks (Settings → AI): AgentShot credits first, in use when the computer has the
/// account's key (signed in there, or handed over from this phone), then the person's own keys, each added or not.
Future<void> showKeys(BuildContext context, BridgeStore store) => sheet(
  context,
  'AI models',
  AsyncPanel(
    load: () async => {
      'keys': await store.client.call('keys:list'),
      'account': await store.client
          .call('account:status')
          .catchError((_) => <String, dynamic>{}),
      'providers': await store.client
          .call('providers:list')
          .catchError((_) => <String, dynamic>{}),
    },
    builder: (data, reload) {
      final keys = objects(data['keys']);
      final credits = keys.where((k) => k['env'] == 'MANUL_KEY').firstOrNull;
      final own = keys.where((k) => k['env'] != 'MANUL_KEY').toList();
      final listed = data['providers'];
      // an older computer may not say: none, then
      final providers = listed is Map ? objects(listed['providers']) : <Json>[];
      final scheme = Theme.of(context).colorScheme;
      final account = store.account?.signedIn == true ? store.account! : null;
      final inUse = credits?['set'] == true;
      final email =
          object(data['account'])['email'] as String? ?? account?.email;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'What AgentShot on ${store.client.connection?.name ?? 'your computer'} uses to edit, write and speak. Keys stay on that computer.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          if (credits != null)
            Card(
              key: const ValueKey('ai-credits'),
              color: inUse
                  ? scheme.primaryContainer.withValues(alpha: .45)
                  : null,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.auto_awesome, color: scheme.primary),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'AgentShot credits',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        if (inUse) const _Status('In use', on: true),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      inUse
                          ? '${email != null ? 'Signed in as $email. ' : ''}The best model for each job, no keys to manage.'
                          : 'One account instead of keys: the best model for each job. New accounts start with free credits.',
                    ),
                    if (inUse) ...[
                      const SizedBox(height: 6),
                      DefaultTextStyle.merge(
                        style: TextStyle(color: scheme.onSurfaceVariant),
                        child: Credits(store: store),
                      ),
                    ] else if (account != null) ...[
                      const SizedBox(height: 12),
                      FilledButton.tonal(
                        onPressed: () => guard(context, () async {
                          await store.client.call('account:adopt', [
                            {
                              'key': account.key,
                              'keyId': ?account.keyId,
                              'email': ?account.email,
                            },
                          ]);
                          if (store.onCloud) await account.useCloudCredits();
                          reload();
                        }),
                        child: const Text('Use AgentShot credits'),
                      ),
                    ] else ...[
                      const SizedBox(height: 6),
                      Text(
                        'Sign in to AgentShot on the computer, or on this phone, to use them.',
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          const SizedBox(height: 20),
          Text('Your own keys', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            inUse
                ? 'Optional with credits. Add one to use that provider’s models on your own bill.'
                : 'Use a provider’s models on your own bill.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 8),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final (i, key) in own.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  ListTile(
                    key: ValueKey('key-${key['env']}'),
                    title: Text('${key['label']}'),
                    subtitle: Text(
                      (key['unlocks'] as List? ?? [])
                          .map((u) => _unlocks[u] ?? '$u')
                          .join(' · '),
                    ),
                    trailing: key['set'] == true
                        ? const _Status('Added', on: true)
                        : const _Status('Add', on: false),
                    onTap: () => guard(context, () async {
                      final label = '${key['label']}';
                      if (key['set'] == true) {
                        final remove = await confirm(
                          context,
                          'Remove the $label key?',
                          'AgentShot on the computer stops using $label models on your bill.',
                          action: 'Remove',
                        );
                        if (!remove) return;
                        await store.client.call('keys:set', [key['env'], '']);
                      } else {
                        final value = await askText(
                          context,
                          '$label key',
                          hint: key['hint'] as String? ?? 'Paste the key',
                          secret: true,
                        );
                        if (value == null || value.isEmpty) return;
                        await store.client.call('keys:set', [
                          key['env'],
                          value,
                        ]);
                      }
                      reload();
                    }),
                  ),
                ],
              ],
            ),
          ),
          // set up on the computer (an endpoint, a local model): shown, changed there
          if (providers.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text(
              'Your providers',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Set up on the computer. Pick their models in any project.',
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (final (i, p) in providers.indexed) ...[
                    if (i > 0) const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.dns_outlined),
                      title: Text('${p['name'] ?? p['id']}'),
                      subtitle: Text(
                        usable(p)
                            ? '${objects(p['models']).length} model${objects(p['models']).length == 1 ? '' : 's'}'
                            : 'Key missing: add it on the computer',
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      );
    },
  ),
);

/// A key's state at the end of its row: added (a check) or not yet (Add).
class _Status extends StatelessWidget {
  final String label;
  final bool on;
  const _Status(this.label, {required this.on});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          on ? Icons.check_circle : Icons.add_circle_outline,
          size: 18,
          color: on ? scheme.primary : scheme.onSurfaceVariant,
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            color: on ? scheme.primary : scheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
