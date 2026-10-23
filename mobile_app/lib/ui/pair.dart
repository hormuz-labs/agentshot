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
  final code = TextEditingController();
  bool busy = false;
  String? error;
  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  Future<void> pair() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.client.pair(code.text);
      if (mounted) widget.onPaired();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

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
                  'Your film.\nYour notes.\nAnywhere at home.',
                  style: Theme.of(context).textTheme.headlineLarge,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Connect to Manul on your computer. Send footage, ask for edits, and keep the cuts you love.',
                ),
                const SizedBox(height: 28),
                const Text(
                  '1. Open Manul on your computer.\n2. Open Mobile in Settings and enable the connection.\n3. Copy the connection code and paste it here.',
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: code,
                  minLines: 3,
                  maxLines: 5,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: 'Connection code',
                    alignLabelWithHint: true,
                    errorText: error,
                    errorMaxLines: 5,
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: busy ? null : pair,
                  icon: busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.link),
                  label: Text(busy ? 'Connecting…' : 'Connect to desktop'),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Both devices must be on the same network. Your computer runs the editing tools; this app connects through encrypted, certificate-pinned TLS.',
                  style: TextStyle(fontSize: 13),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
