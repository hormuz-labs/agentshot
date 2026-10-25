import 'package:flutter/material.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';

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
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Your computer now uses your AgentShot credits.'),
      ),
    );
  }
  return true;
}

/// The AI keys kept on the computer (Settings → AI keys).
Future<void> showKeys(BuildContext context, BridgeStore store) => sheet(
  context,
  'Bring your own keys',
  AsyncPanel(
    load: () => store.client.call('keys:list'),
    builder: (data, reload) => Column(
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
  ),
);
