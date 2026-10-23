import 'package:flutter/material.dart';
import '../bridge/client.dart';

class PairScreen extends StatefulWidget {
  final BridgeClient client;
  final VoidCallback onPaired;
  const PairScreen({super.key, required this.client, required this.onPaired});
  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  bool busy = false;
  String? error;
  List<Json> computers = [];
  @override
  void initState() {
    super.initState();
    if (widget.client.account.signedIn) refresh();
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> refresh() => run(() async {
    final found = await widget.client.account.desktops();
    if (mounted) setState(() => computers = found);
  });

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, size) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 540),
            child: ListView(
              padding: EdgeInsets.all(size.maxWidth < 360 ? 16 : 28),
              shrinkWrap: true,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Image.asset('assets/manul.png', width: 72, height: 72),
                ),
                const SizedBox(height: 24),
                Text(
                  'Your film.\nYour notes.\nAnywhere.',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Connect to Manul on your computer. Send footage, ask for edits, and keep the cuts you love.',
                ),
                const SizedBox(height: 28),
                if (!widget.client.account.signedIn)
                  FilledButton.icon(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await widget.client.account.signIn();
                            final found = await widget.client.account
                                .desktops();
                            if (mounted) setState(() => computers = found);
                          }),
                    icon: const Icon(Icons.login),
                    label: Text(busy ? 'Signing in…' : 'Sign in to Manul'),
                  )
                else ...[
                  Text(widget.client.account.email ?? 'Manul account'),
                  const SizedBox(height: 16),
                  Text(
                    'Your computers',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (computers.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        'No computers online yet. Open Manul → Settings → Mobile on your computer and sign in to this account.',
                      ),
                    ),
                  for (final computer in computers)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Align(
                              alignment: Alignment.centerLeft,
                              child: Icon(Icons.computer),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${computer['name']}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: busy
                                  ? null
                                  : () => run(() async {
                                      await widget.client.connectDesktop(
                                        computer['id'] as String,
                                      );
                                      if (mounted) widget.onPaired();
                                    }),
                              child: const Text('Connect'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  Wrap(
                    spacing: 12,
                    children: [
                      TextButton.icon(
                        onPressed: busy ? null : refresh,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Refresh'),
                      ),
                      TextButton(
                        onPressed: busy
                            ? null
                            : () => run(() async {
                                await widget.client.account.signOut();
                                if (mounted) setState(() => computers = []);
                              }),
                        child: const Text('Sign out'),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                const Text(
                  'Use Wi-Fi or mobile data, wherever you are. Sign in to the same account on both devices. Your computer needs to stay awake with Manul running.',
                ),
                if (busy)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
