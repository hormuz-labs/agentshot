import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// The page that says what deleting an AgentShot account deletes (and keeps), with the request there too.
final deletePage = Uri.parse('https://agentshot.si/delete-account/');

/// The request, from the person's own email so the account is known to be theirs.
Uri deleteRequest(String? email) => Uri(
  scheme: 'mailto',
  path: 'support@agentshot.si',
  query: _query({
    'subject': 'Delete my AgentShot account',
    'body':
        'Please delete my AgentShot account and the data that goes with it.\n\n'
        'The email I sign in with: ${email ?? ''}\n',
  }),
);

// mailto wants %20 for spaces, not the + that Uri's queryParameters writes
String _query(Map<String, String> values) => values.entries
    .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
    .join('&');

/// Opens a link outside the app; false when nothing could (the tests stand in for it).
Future<bool> Function(Uri) openLink = (uri) => launchUrl(
  uri,
  mode: LaunchMode.externalApplication,
).catchError((_) => false);

/// Settings → Account → Delete my account: what it deletes, then the request in the person's email app (the page,
/// if there's none).
Future<void> deleteAccount(BuildContext context, String? email) async {
  final send = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      key: const ValueKey('delete-account'),
      title: const Text('Delete your AgentShot account?'),
      scrollable: true,
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'We delete your account, your credits and plan, and your projects in AgentShot Cloud, within 30 days, '
            'and write back when it’s done. Projects on your own computer stay there.\n\n'
            'The request goes from your email, so we know the account is yours.',
          ),
          const SizedBox(height: 4),
          TextButton(
            style: TextButton.styleFrom(padding: EdgeInsets.zero),
            onPressed: () => openLink(deletePage),
            child: const Text('What’s deleted, and what’s kept'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Theme.of(context).colorScheme.onError,
          ),
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Email the request'),
        ),
      ],
    ),
  );
  if (send != true) return;
  if (await openLink(deleteRequest(email))) return;
  // no email app here: the page has the address and the steps
  if (await openLink(deletePage)) return;
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Write to support@agentshot.si with the subject “Delete my AgentShot account”.',
        ),
      ),
    );
  }
}
