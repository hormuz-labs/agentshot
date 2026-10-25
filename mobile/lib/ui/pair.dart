import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_zxing/flutter_zxing.dart';
import '../bridge/client.dart';
import 'common.dart';
import 'google_logo.dart';

/// The welcome screen: sign in with the account used on the computer (the usual way), or, folded away under "Other
/// ways to connect", pair with the computer's QR code or 6-digit code (no account needed).
class PairScreen extends StatefulWidget {
  final BridgeClient client;
  final VoidCallback onPaired;

  /// Signs in to AgentShot in the browser; afterwards the app shows the person's computers.
  final Future<void> Function() onSignIn;

  /// An agentshot://pair link the phone's camera opened the app with; pairing starts right away.
  final String? link;

  /// Open on the codes rather than the sign-in (chosen from the computers list, or a pairing link).
  final bool codes;

  /// Already signed in (pairing with a code by choice): the main button goes back to the computers list.
  final bool signedIn;

  /// Why the phone is here again (the computer ended the connection).
  final String? notice;
  const PairScreen({
    super.key,
    required this.client,
    required this.onPaired,
    required this.onSignIn,
    this.link,
    this.codes = false,
    this.signedIn = false,
    this.notice,
  });
  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final digits = List.generate(6, (_) => TextEditingController());
  final nodes = List.generate(6, (_) => FocusNode());
  bool busy = false, signingIn = false;
  late bool codes = widget.codes || widget.link != null;
  String? error;

  @override
  void initState() {
    super.initState();
    final link = widget.link;
    if (link != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => pair(link));
    }
  }

  @override
  void dispose() {
    for (final c in digits) {
      c.dispose();
    }
    for (final n in nodes) {
      n.dispose();
    }
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

  /// Pairs with a scanned or pasted QR payload, or with the 6-digit code typed below.
  Future<void> pair([String? payload]) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.client.pair(payload ?? currentCode);
      if (mounted) widget.onPaired();
    } catch (e) {
      if (mounted) {
        // a wrong or stale code: empty the boxes and start over in the first, ready for the next try
        for (final c in digits) {
          c.clear();
        }
        setState(() => error = '$e');
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
        // the boxes are enabled again from the next frame
        if (error != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) nodes.first.requestFocus();
          });
        }
      }
    }
  }

  Future<void> scan() async {
    final value = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (value != null && mounted) pair(value);
  }

  Future<void> paste() async {
    final text = (await Clipboard.getData('text/plain'))?.text?.trim() ?? '';
    if (text.startsWith('agentshot://') || text.startsWith('{')) {
      pair(text);
    } else if (text.isNotEmpty) {
      fillDigits(text);
    }
  }

  Future<void> signIn() async {
    setState(() {
      signingIn = true;
      error = null;
    });
    try {
      await widget.onSignIn();
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => signingIn = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
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
                  if (widget.notice != null) ...[
                    NoticeBanner(widget.notice!),
                    const SizedBox(height: 20),
                  ],
                  // the cat beside the headline, or above it where there's no room (a narrow phone, very large text)
                  LayoutBuilder(
                    builder: (context, box) {
                      final headline = Text(
                        'Your film.\nYour notes.\nAnywhere.',
                        style: text.headlineLarge,
                      );
                      if (box.maxWidth >= 340 &&
                          MediaQuery.textScalerOf(context).scale(16) <= 24) {
                        return Row(
                          children: [
                            Expanded(child: headline),
                            Image.asset(
                              'assets/manul.png',
                              width: 116,
                              height: 116,
                            ),
                          ],
                        );
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Image.asset(
                            'assets/manul.png',
                            width: 72,
                            height: 72,
                          ),
                          const SizedBox(height: 24),
                          headline,
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Use AgentShot on your computer from your phone. Send footage, ask for edits, and keep the cuts you love.',
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    height: 52,
                    child: widget.signedIn
                        ? FilledButton.icon(
                            key: const ValueKey('sign-in'),
                            onPressed: busy ? null : signIn,
                            icon: const Icon(Icons.computer),
                            label: const Text('Back to your computers'),
                          )
                        // Google's own button style: the G on white (or near-black in the dark), a grey outline
                        : OutlinedButton.icon(
                            key: const ValueKey('sign-in'),
                            onPressed: busy || signingIn ? null : signIn,
                            style: OutlinedButton.styleFrom(
                              backgroundColor: dark
                                  ? const Color(0xFF131314)
                                  : Colors.white,
                              foregroundColor: dark
                                  ? const Color(0xFFE3E3E3)
                                  : const Color(0xFF1F1F1F),
                              side: BorderSide(
                                color: dark
                                    ? const Color(0xFF8E918F)
                                    : const Color(0xFF747775),
                              ),
                              textStyle: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            icon: signingIn
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const GoogleLogo(),
                            label: Text(
                              signingIn
                                  ? 'Signing in…'
                                  : 'Continue with Google',
                            ),
                          ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Use the same account as AgentShot on your computer. Your computers show up by themselves, at home or away.',
                    style: text.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      error!,
                      style: TextStyle(color: scheme.error, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 20),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => setState(() => codes = !codes),
                      icon: Icon(
                        codes ? Icons.expand_less : Icons.expand_more,
                        size: 18,
                      ),
                      label: const Text('Other ways to connect'),
                    ),
                  ),
                  if (codes) ...[
                    const SizedBox(height: 8),
                    Text(
                      'No account? On your computer, open AgentShot → Settings → Mobile → Connect without an account, then scan its QR code or type its 6-digit code.',
                      style: text.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      key: const ValueKey('scan'),
                      onPressed: busy ? null : scan,
                      icon: busy
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.qr_code_scanner),
                      label: Text(busy ? 'Connecting…' : 'Scan QR code'),
                    ),
                    const SizedBox(height: 16),
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
                                  style: text.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
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
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: busy ? null : paste,
                        icon: const Icon(Icons.content_paste, size: 18),
                        label: const Text('Paste code'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Full-screen camera that returns the first AgentShot pairing QR it sees.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  bool done = false;
  String? cameraError;

  void found(Code code) {
    final value = code.text ?? '';
    if (done || !code.isValid || !value.startsWith('agentshot://pair')) return;
    done = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.black,
    appBar: AppBar(
      backgroundColor: Colors.black,
      foregroundColor: Colors.white,
      title: const Text('Scan to pair'),
    ),
    body: cameraError != null
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                cameraError!,
                style: const TextStyle(color: Colors.white),
                textAlign: TextAlign.center,
              ),
            ),
          )
        : ReaderWidget(
            codeFormat: Format.qrCode,
            onScan: found,
            // the code is on a bright screen: scan often, no flash, camera flip or photo import needed
            scanDelay: const Duration(milliseconds: 250),
            scanDelaySuccess: const Duration(milliseconds: 250),
            showFlashlight: false,
            showToggleCamera: false,
            showGallery: false,
            cropPercent: 0.7,
            onControllerCreated: (_, error) {
              if (error != null && mounted) {
                setState(
                  () => cameraError =
                      'Allow camera access in Settings to scan the code, or scan it with your phone’s camera app.',
                );
              }
            },
          ),
  );
}
