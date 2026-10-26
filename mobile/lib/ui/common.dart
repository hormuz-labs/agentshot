import 'package:flutter/material.dart';

Future<T?> sheet<T>(BuildContext context, String title, Widget child) =>
    showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      constraints: const BoxConstraints(maxWidth: 720),
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: .8,
          maxChildSize: .95,
          minChildSize: .3,
          builder: (context, scroll) => ListView(
            controller: scroll,
            padding: const EdgeInsets.all(20),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              child,
            ],
          ),
        ),
      ),
    );

Future<void> guard(BuildContext context, Future<void> Function() work) async {
  try {
    await work();
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error'), duration: const Duration(seconds: 7)),
      );
    }
  }
}

Future<String?> askText(
  BuildContext context,
  String title, {
  String initial = '',
  String? hint,
  bool secret = false,
}) async {
  final controller = TextEditingController(text: initial);
  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      scrollable: true,
      content: TextField(
        controller: controller,
        autofocus: true,
        obscureText: secret,
        minLines: secret ? 1 : 2,
        maxLines: secret ? 1 : 6,
        decoration: InputDecoration(hintText: hint),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          child: const Text('Save'),
        ),
      ],
    ),
  );
  // Dialog's exit animation may still reference the controller.
  await Future<void>.delayed(const Duration(milliseconds: 300));
  controller.dispose();
  return result;
}

Future<bool> confirm(
  BuildContext context,
  String title,
  String message, {
  String action = 'Confirm',
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        scrollable: true,
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;

class AsyncPanel extends StatefulWidget {
  final Future<dynamic> Function() load;
  final Widget Function(dynamic, VoidCallback) builder;
  const AsyncPanel({super.key, required this.load, required this.builder});
  @override
  State<AsyncPanel> createState() => _AsyncPanelState();
}

class _AsyncPanelState extends State<AsyncPanel> {
  late Future<dynamic> _future;
  @override
  void initState() {
    super.initState();
    _future = widget.load();
  }

  // a block: an arrow would hand setState the Future it assigns. A load that fails at once (offline) fails before
  // the FutureBuilder listens: marked as handled, it shows here as an error instead of escaping as an uncaught one.
  void reload() => setState(() {
    _future = widget.load()..ignore();
  });

  @override
  Widget build(BuildContext context) => FutureBuilder<dynamic>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return Column(
          children: [
            Text('${snapshot.error}'),
            TextButton(onPressed: reload, child: const Text('Try again')),
          ],
        );
      }
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: CircularProgressIndicator(),
          ),
        );
      }
      return widget.builder(snapshot.data, reload);
    },
  );
}

String timestamp(num seconds) {
  final s = seconds.floor();
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

class EmptyMessage extends StatelessWidget {
  final IconData icon;
  final String title, body;

  /// Shown instead of the icon (Manul, in an empty conversation).
  final Widget? art;
  const EmptyMessage(this.icon, this.title, this.body, {super.key, this.art});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 12),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        art ??
            Icon(icon, size: 40, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(body, textAlign: TextAlign.center),
      ],
    ),
  );
}

/// Why the person is looking at this screen (e.g. the computer ended the connection).
class NoticeBanner extends StatelessWidget {
  final String text;
  const NoticeBanner(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    borderRadius: BorderRadius.circular(12),
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          const Icon(Icons.link_off, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ],
      ),
    ),
  );
}
