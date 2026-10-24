import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../bridge/client.dart';

class PairScreen extends StatefulWidget {
  final BridgeClient client;
  final VoidCallback onPaired;
  const PairScreen({super.key, required this.client, required this.onPaired});
  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final digits = List.generate(6, (_) => TextEditingController());
  final nodes = List.generate(6, (_) => FocusNode());
  final host = TextEditingController();
  bool showHost = false;
  bool busy = false;
  String? error;

  @override
  void dispose() {
    for (final c in digits) {
      c.dispose();
    }
    for (final n in nodes) {
      n.dispose();
    }
    host.dispose();
    super.dispose();
  }

  String get currentCode => digits.map((c) => c.text.trim()).join();

  void fillDigits(String raw) {
    final clean = raw.replaceAll(RegExp(r'\D'), '');
    if (clean.isEmpty) return;
    for (var i = 0; i < 6; i++) {
      digits[i].text = i < clean.length ? clean[i] : '';
    }
    setState(() => error = null);
    final next = clean.length.clamp(0, 5);
    nodes[next].requestFocus();
    if (clean.length >= 6 && !busy) {
      pair();
    }
  }

  Future<void> pair() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.client.pair(currentCode, host: host.text);
      if (mounted) widget.onPaired();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
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
                    child: Image.asset(
                      'assets/manul.png',
                      width: 72,
                      height: 72,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Your film.\nYour notes.\nAnywhere.',
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Connect to AgentShot on your computer. Send footage, ask for edits, and keep the cuts you love.',
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    '1. Open AgentShot → Settings → Mobile on your computer.\n2. Turn on “Let my phone connect”.\n3. Enter the 6-digit verification code below.',
                  ),
                  const SizedBox(height: 20),
                  LayoutBuilder(
                    builder: (context, box) {
                      final gap = box.maxWidth < 340 ? 6.0 : 8.0;
                      final splitGap = box.maxWidth < 340 ? 10.0 : 16.0;
                      final boxWidth =
                          ((box.maxWidth - (gap * 4) - splitGap) / 6).clamp(
                            38.0,
                            54.0,
                          );
                      return Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          for (var i = 0; i < 6; i++) ...[
                            if (i == 3) SizedBox(width: splitGap - gap),
                            SizedBox(
                              width: boxWidth,
                              child: TextField(
                                key: ValueKey('otp-$i'),
                                controller: digits[i],
                                focusNode: nodes[i],
                                enabled: !busy,
                                keyboardType: TextInputType.number,
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w600),
                                inputFormatters: [
                                  FilteringTextInputFormatter.digitsOnly,
                                ],
                                decoration: const InputDecoration(
                                  counterText: '',
                                  contentPadding: EdgeInsets.symmetric(
                                    vertical: 14,
                                  ),
                                ),
                                onChanged: (value) {
                                  if (value.length > 1) {
                                    fillDigits(value);
                                    return;
                                  }
                                  setState(() => error = null);
                                  if (value.isNotEmpty && i < 5) {
                                    nodes[i + 1].requestFocus();
                                  } else if (value.isEmpty && i > 0) {
                                    nodes[i - 1].requestFocus();
                                  }
                                  if (currentCode.length == 6 && !busy) {
                                    pair();
                                  }
                                },
                              ),
                            ),
                          ],
                        ],
                      );
                    },
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      error!,
                      style: TextStyle(color: scheme.error, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: busy ? null : pair,
                          icon: busy
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.link),
                          label: Text(
                            busy ? 'Connecting…' : 'Connect to desktop',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      OutlinedButton.icon(
                        onPressed: busy
                            ? null
                            : () async {
                                final clip = await Clipboard.getData(
                                  'text/plain',
                                );
                                final text = clip?.text?.trim() ?? '';
                                if (text.isNotEmpty) fillDigits(text);
                              },
                        icon: const Icon(Icons.content_paste, size: 18),
                        label: const Text('Paste'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => setState(() => showHost = !showHost),
                      icon: Icon(
                        showHost ? Icons.expand_less : Icons.expand_more,
                        size: 18,
                      ),
                      label: const Text(
                        'Away from home? Enter an address',
                      ),
                    ),
                  ),
                  if (showHost) ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: host,
                      enabled: !busy,
                      autocorrect: false,
                      enableSuggestions: false,
                      keyboardType: TextInputType.url,
                      decoration: const InputDecoration(
                        labelText: 'Computer IP, Tailscale or mesh address',
                        hintText: '100.x.y.z or 192.168.x.y',
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  const Text(
                    'Connects automatically on the same Wi-Fi, or from anywhere over Tailscale or your AgentShot mesh, using encrypted certificate-pinned TLS.',
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
}
