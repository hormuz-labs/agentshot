import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'mascot.dart';

/// The app's own version, as the release on GitHub names it: "0.4.29" (built by `npm run phone:build`).
final Future<String> appVersion = PackageInfo.fromPlatform()
    .then((p) => p.version)
    .catchError((_) => '');

/// What the app opens on while it gets ready: Manul where the system's splash had him, the name under him, and at the
/// bottom which version this is and who makes it.
class Splash extends StatelessWidget {
  const Splash({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final quiet = text.labelMedium?.copyWith(color: scheme.onSurfaceVariant);
    return Scaffold(
      key: const ValueKey('splash'),
      body: SafeArea(
        // Manul dead centre, where the system's splash drew him (smaller on a short screen), the name under him, and
        // the version and maker at the bottom; on any screen and text size, nothing pushed off it
        child: LayoutBuilder(
          builder: (context, box) {
            final size = (box.maxHeight * .24).clamp(56.0, 140.0);
            return Stack(
              children: [
                Center(child: Mascot(size: size)),
                Positioned(
                  top: box.maxHeight / 2 + size / 2 + 12,
                  left: 16,
                  right: 16,
                  child: Column(
                    children: [
                      Text(
                        'AgentShot',
                        style: text.headlineMedium,
                        textAlign: TextAlign.center,
                      ),
                      if (box.maxHeight > 480) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Give notes. Get cuts.',
                          textAlign: TextAlign.center,
                          style: text.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Positioned(
                  bottom: 16,
                  left: 16,
                  right: 16,
                  child: Column(
                    children: [
                      FutureBuilder<String>(
                        future: appVersion,
                        builder: (context, v) => Text(
                          v.data?.isNotEmpty == true
                              ? 'Version ${v.data}'
                              : ' ',
                          key: const ValueKey('splash-version'),
                          style: quiet,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'A Hormuz Labs product',
                        style: quiet?.copyWith(letterSpacing: .3),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
