import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../bridge/client.dart';
import '../bridge/pick.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'home.dart' show ConsentCards;
import 'markdown.dart';
import 'mascot.dart';
import 'player.dart';
import 'cut_card.dart';
import 'settings.dart' show Credits;
import 'import.dart';
import 'setup_ai.dart';

class ProjectScreen extends StatefulWidget {
  final BridgeStore store;
  const ProjectScreen({super.key, required this.store});
  @override
  State<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends State<ProjectScreen> {
  final message = TextEditingController();
  final chatScroll = ScrollController();
  final attachments = <String>{};
  String chatShown = '';
  bool wasBusy = false;
  late Future<Json?> credits = loadCredits();
  late Future<String> model = loadModel();
  bool follow = true;
  int section = 0;

  /// Film and conversation side by side (a wide screen), so a new cut is already in sight.
  bool wide = false;

  /// The new cut the person has looked at in the Film tab (no dot on the tab for it any more).
  String? seen;
  bool after = true, boxMode = false, sending = false, exporting = false;

  /// Why the last note didn't go (shown above the composer, the note kept there to try again).
  Object? sendError;
  double position = 0;
  Json? anchor;
  String? exportStatus;
  BridgeStore get store => widget.store;
  Json get project => store.project!;
  String get dir => project['dir'] as String;
  @override
  void dispose() {
    message.dispose();
    chatScroll.dispose();
    super.dispose();
  }

  Future<void> send() async {
    if (message.text.trim().isEmpty || sending) return;
    setState(() {
      sending = true;
      sendError = null;
    });
    try {
      await sendToAgent(context, store, dir, {
        'text': message.text.trim(),
        if (anchor != null) 'anchor': anchor,
        if (attachments.isNotEmpty) 'files': attachments.toList(),
      });
      message.clear();
      follow = true; // after sending, show what comes back
      if (mounted) {
        setState(() {
          anchor = null;
          boxMode = false;
          attachments.clear();
        });
      }
    } catch (e) {
      if (mounted) setState(() => sendError = e);
    }
    if (mounted) setState(() => sending = false);
  }

  /// Brings files into this project (one or several videos, photos, or other files) and attaches them to the note.
  Future<void> importFiles() async {
    final kind = await choosePick(context);
    if (kind == null) return;
    final picked = await Picker.pick(kind);
    if (picked.isEmpty) return;
    for (final file in picked) {
      final rels = await store.client.upload(
        file.file,
        file.name,
        project: dir,
      );
      attachments.addAll((rels as List).cast<String>());
      if (mounted) setState(() {});
    }
    await store.open(dir);
    if (mounted) setState(() {});
  }

  Future<void> export() async {
    String preset = 'original', fit = 'pad', captions = 'none';
    final chosen = await sheet<bool>(
      context,
      'Export your film',
      StatefulBuilder(
        builder: (context, set) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Rendering happens on your computer. The finished film downloads to this device and opens the share sheet.',
            ),
            const SizedBox(height: 20),
            dropdown('Format', preset, const {
              'original': 'Original',
              'landscape': '16:9 · YouTube',
              'vertical': '9:16 · Shorts, Reels, TikTok',
              'square': '1:1 · Feed',
            }, (v) => set(() => preset = v)),
            const SizedBox(height: 16),
            dropdown('Fit', fit, const {
              'pad': 'Fit the whole frame',
              'crop': 'Fill the frame',
            }, (v) => set(() => fit = v)),
            const SizedBox(height: 16),
            dropdown('Captions', captions, const {
              'none': 'No captions',
              'burn': 'Burn into video',
              'srt': 'Separate SRT file',
            }, (v) => set(() => captions = v)),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: () => Navigator.pop(context, true),
              icon: const Icon(Icons.ios_share),
              label: const Text('Render and download'),
            ),
          ],
        ),
      ),
    );
    if (chosen != true || !mounted) return;
    setState(() {
      exporting = true;
      exportStatus = 'Rendering on your desktop…';
    });
    await guard(context, () async {
      final result = object(
        await store.client.call('mobile:export', [
          dir,
          {'preset': preset, 'fit': fit, 'captions': captions},
        ]),
      );
      final files = <XFile>[];
      for (final relative in [
        result['file'],
        if (result['srt'] != null) result['srt'],
      ]) {
        final file = await store.client.download(
          dir,
          relative as String,
          progress: (v) {
            if (mounted) {
              setState(
                () => exportStatus = 'Downloading ${(v * 100).round()}%',
              );
            }
          },
        );
        files.add(XFile(file.path));
      }
      if (!mounted) return;
      final box = context.findRenderObject() as RenderBox?;
      await SharePlus.instance.share(
        ShareParams(
          files: files,
          title: project['title'] as String,
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    });
    if (mounted) {
      setState(() {
        exporting = false;
        exportStatus = null;
      });
    }
  }

  Future<void> panel(
    String title,
    Future<dynamic> Function() load,
    Widget Function(dynamic, VoidCallback) content,
  ) async {
    await sheet(context, title, AsyncPanel(load: load, builder: content));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final p = store.project;
      if (p == null) {
        return const Scaffold(
          body: Center(child: Text('Open a project first.')),
        );
      }
      return Scaffold(
        appBar: AppBar(
          title: Text(
            '${p['title']}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          actions: [
            IconButton(
              tooltip: 'Export film',
              onPressed: exporting ? null : export,
              icon: const Icon(Icons.ios_share),
            ),
            PopupMenuButton<String>(
              tooltip: 'Project actions',
              onSelected: action,
              itemBuilder: (_) => [
                for (final item in const {
                  'conversations': 'Conversations',
                  'models': 'Choose model',
                  'history': 'History',
                  'transcript': 'Transcript',
                  'timeline': 'Timeline & mix',
                  'versions': 'Versions',
                }.entries)
                  PopupMenuItem(value: item.key, child: Text(item.value)),
              ],
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              // banners take their size, but never more than the screen shares out (a landscape phone with
              // the keyboard up leaves a sliver), and scroll within it
              if (!store.connected)
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      store.connectionError ?? 'Reconnecting…',
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              if (exporting)
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      children: [
                        Text(exportStatus ?? ''),
                        const SizedBox(height: 8),
                        const LinearProgressIndicator(),
                      ],
                    ),
                  ),
                ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, size) {
                    wide =
                        size.maxWidth >= 900 &&
                        MediaQuery.textScalerOf(context).scale(16) <= 26;
                    if (wide) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: chat()),
                          const VerticalDivider(width: 1),
                          Expanded(
                            child: ListView(
                              padding: const EdgeInsets.all(16),
                              children: [
                                film(),
                                const SizedBox(height: 24),
                                files(),
                              ],
                            ),
                          ),
                        ],
                      );
                    }
                    // A phone in landscape with the keyboard up leaves a sliver: give it all to the note being typed.
                    // (Height alone: the Scaffold has already taken the keyboard out of this body's insets.)
                    if (size.maxHeight < 200) return chat();
                    return Column(
                      children: [
                        tabs(),
                        Expanded(
                          child: section == 0
                              ? chat()
                              : ListView(
                                  padding: const EdgeInsets.all(16),
                                  children: [section == 1 ? film() : files()],
                                ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  /// Keeps the newest message in view as the agent works, unless the person scrolled up to read.
  void followChat(AgentState state) {
    final proposal = project['proposal'];
    final shown =
        '$dir:${state.messages.length}:${state.streaming.length}:${state.tools.length}:${state.busy}:${state.error}:$proposal';
    if (shown == chatShown) return;
    // a new cut is worth seeing even when the person had scrolled up: down to its card
    final fresh = proposal != null && !chatShown.endsWith(':$proposal');
    chatShown = shown;
    if (!follow && !fresh) return;
    follow = true;
    void toEnd([int again = 2]) {
      if (!mounted || !chatScroll.hasClients) return;
      chatScroll.jumpTo(chatScroll.position.maxScrollExtent);
      // the list builds lazily, so its true end is only known once the new items are laid out
      if (again > 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) => toEnd(again - 1));
      }
    }

    WidgetsBinding.instance.addPostFrameCallback((_) => toEnd());
  }

  /// What the agent is doing, in words (its tools stay out of the conversation).
  static String doing(String tool) => switch (tool) {
    'project_state' || 'probe' || 'look' => 'Looking at the project',
    'analyze_video' ||
    'analyze_screen_activity' ||
    'find_subjects' => 'Watching the footage',
    'transcript' || 'speakers' || 'name_speakers' => 'Listening to the speech',
    'analyze_music' => 'Listening to the music',
    'edit_timeline' || 'set_mix' => 'Editing the cut',
    'rerender_timeline' || 'propose_version' => 'Rendering the new cut',
    'create_clip' || 'render_clip' => 'Designing a motion clip',
    'insert_clip' || 'overlay_clip' => 'Putting the clip in the film',
    'generate_voice' => 'Recording a voice-over',
    'generate_music' => 'Composing music',
    'export_video' => 'Exporting the film',
    'browser' ||
    'walkthrough_record' ||
    'compose_walkthrough' => 'Filming in the browser',
    'ffmpeg' => 'Processing the video',
    'memory' || 'remember' || 'forget' => 'Remembering',
    _ => 'Working',
  };

  /// Conversation, Film and Files on a narrow screen: one rounded track across the width, the part showing raised.
  Widget tabs() {
    final scheme = Theme.of(context).colorScheme;
    final proposal = project['proposal'] as String?;
    if (section == 1) seen = proposal;
    final waiting = proposal != null && proposal != seen;
    final label = Theme.of(context).textTheme.labelLarge;
    const parts = [
      ('Conversation', Icons.chat_bubble_outline, Icons.chat_bubble),
      ('Film', Icons.movie_outlined, Icons.movie),
      ('Files', Icons.folder_outlined, Icons.folder),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            for (final (i, (name, icon, chosen)) in parts.indexed)
              Expanded(
                child: Semantics(
                  button: true,
                  selected: section == i,
                  child: GestureDetector(
                    key: ValueKey('tab-$name'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => setState(() => section = i),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      curve: Curves.easeOut,
                      constraints: const BoxConstraints(minHeight: 40),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: section == i ? scheme.surface : null,
                        borderRadius: BorderRadius.circular(10),
                        boxShadow: section == i
                            ? [
                                BoxShadow(
                                  color: scheme.shadow.withValues(alpha: .08),
                                  blurRadius: 6,
                                  offset: const Offset(0, 1),
                                ),
                              ]
                            : null,
                      ),
                      // large text on a small phone shrinks the words to fit rather than cutting them off
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Badge(
                              key: ValueKey('tab-$name-dot'),
                              isLabelVisible: waiting && name == 'Film',
                              smallSize: 8,
                              child: Icon(
                                section == i ? chosen : icon,
                                size: 18,
                                color: section == i
                                    ? scheme.primary
                                    : scheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              name,
                              maxLines: 1,
                              style: label?.copyWith(
                                color: section == i
                                    ? scheme.onSurface
                                    : scheme.onSurfaceVariant,
                                fontWeight: section == i
                                    ? FontWeight.w600
                                    : FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<Json?> loadCredits() async {
    try {
      final account = store.account;
      return account?.signedIn == true
          ? await account!.balance()
          : object(await store.client.call('account:balance'));
    } catch (_) {
      return null; // not signed in to AgentShot: no credits to show
    }
  }

  Future<String> loadModel() async {
    try {
      final data = object(await store.client.call('agent:models', [dir]));
      final current = data['current'];
      final model = objects(
        data['models'],
      ).where((m) => m['modelId'] == current?['modelId']).firstOrNull;
      return model == null ? 'Automatic' : '${model['name']}';
    } catch (_) {
      return 'Automatic';
    }
  }

  void addMenu() => showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.attach_file),
            title: const Text('Attach files'),
            subtitle: const Text('Videos, photos or other files'),
            onTap: () {
              Navigator.pop(sheetContext);
              guard(context, importFiles);
            },
          ),
          ListTile(
            leading: const Icon(Icons.alternate_email),
            title: const Text('Mention a file, version or clip'),
            onTap: () {
              Navigator.pop(sheetContext);
              mentions();
            },
          ),
        ],
      ),
    ),
  );

  Widget chat() {
    final state = store.agent(dir);
    final messages = state.messages;
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    followChat(state);
    // credits change with every run
    if (wasBusy && !state.busy) credits = loadCredits();
    wasBusy = state.busy;
    final status = state.tools.isNotEmpty
        ? doing(state.tools.values.last)
        : state.busy && state.streaming.isEmpty
        ? 'Thinking'
        : null;
    final canSend =
        message.text.trim().isNotEmpty && store.connected && !sending;
    return LayoutBuilder(
      builder: (context, available) => Column(
        children: [
          Expanded(
            child: NotificationListener<ScrollEndNotification>(
              onNotification: (_) {
                follow = chatScroll.position.extentAfter < 120;
                return false;
              },
              child: SelectionArea(
                child: ListView(
                  controller: chatScroll,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  children: [
                    ConsentCards(store: store),
                    if (!state.loaded &&
                        messages.isEmpty &&
                        state.streaming.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text('Loading conversation…'),
                      ),
                    if (state.loaded &&
                        messages.isEmpty &&
                        state.streaming.isEmpty &&
                        !state.busy)
                      EmptyMessage(
                        Icons.chat_bubble_outline,
                        'Give notes. Get cuts.',
                        'Ask for an edit, attach a file, or point at a moment in the Film tab.',
                        // smaller when there's little room (a phone on its side, very large text)
                        art: Mascot(
                          size: (available.maxHeight * .22).clamp(56.0, 120.0),
                        ),
                      ),
                    for (final m in messages)
                      if (m['role'] == 'user')
                        Align(
                          alignment: Alignment.centerRight,
                          child: Container(
                            constraints: BoxConstraints(
                              maxWidth: available.maxWidth * .82,
                            ),
                            margin: const EdgeInsets.only(bottom: 18, left: 32),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 11,
                            ),
                            decoration: BoxDecoration(
                              color: scheme.surfaceContainerHighest,
                              borderRadius: const BorderRadius.only(
                                topLeft: Radius.circular(20),
                                topRight: Radius.circular(20),
                                bottomLeft: Radius.circular(20),
                                bottomRight: Radius.circular(6),
                              ),
                            ),
                            child: Text(
                              '${m['content'] ?? ''}',
                              style: text.bodyLarge,
                            ),
                          ),
                        )
                      else if (m['role'] == 'assistant' &&
                          '${m['content'] ?? ''}'.trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 18),
                          child: Markdown('${m['content']}'),
                        ),
                    if (state.streaming.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 18),
                        child: Markdown(state.streaming),
                      ),
                    if (status != null)
                      Padding(
                        key: const ValueKey('agent-status'),
                        padding: const EdgeInsets.only(bottom: 18),
                        child: Row(
                          children: [
                            const Mascot(size: 32, busy: true),
                            const SizedBox(width: 10),
                            Flexible(
                              child: Text(
                                '$status…',
                                style: text.bodyMedium?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    if (state.error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 18),
                        child: Text(
                          state.error!,
                          style: TextStyle(color: scheme.error),
                        ),
                      ),
                    if (project['proposal'] != null && !state.busy)
                      proposalCard()
                    else if (!state.busy && messages.isNotEmpty)
                      ?latestCutCard(),
                  ],
                ),
              ),
            ),
          ),
          if (sendError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
              child: ProblemCard(
                title: 'Your note didn’t send',
                error: sendError!,
                onRetry: send,
                onDismiss: () => setState(() => sendError = null),
              ),
            ),
          // Bound composer height under large text/landscape/keyboard constraints; content scrolls.
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: (available.maxHeight * .55).clamp(
                0.0,
                MediaQuery.sizeOf(context).height * .4,
              ),
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 10, 8, 8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(26),
                  border: Border.all(color: scheme.outlineVariant),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (anchor != null || attachments.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            if (anchor != null)
                              InputChip(
                                visualDensity: VisualDensity.compact,
                                label: Text(
                                  'Note at ${timestamp(anchor!['t0'] as num)}${anchor!['box'] != null ? ' · box' : ''}',
                                ),
                                onDeleted: () => setState(() {
                                  anchor = null;
                                  boxMode = false;
                                }),
                              ),
                            for (final f in attachments)
                              InputChip(
                                visualDensity: VisualDensity.compact,
                                label: ConstrainedBox(
                                  constraints: const BoxConstraints(
                                    maxWidth: 160,
                                  ),
                                  child: Text(
                                    f.split('/').last,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                onDeleted: () =>
                                    setState(() => attachments.remove(f)),
                              ),
                          ],
                        ),
                      ),
                    TextField(
                      key: const ValueKey('composer'),
                      controller: message,
                      minLines: 1,
                      maxLines: 6,
                      textCapitalization: TextCapitalization.sentences,
                      style: text.bodyLarge,
                      decoration: const InputDecoration.collapsed(
                        hintText: 'Ask for a change…',
                      ),
                      onChanged: (v) {
                        if (v.endsWith('@')) mentions();
                        setState(() {});
                      },
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        IconButton(
                          tooltip: 'Add',
                          onPressed: addMenu,
                          icon: const Icon(Icons.add),
                        ),
                        Expanded(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Flexible(
                                child: FutureBuilder<Json?>(
                                  future: credits,
                                  builder: (context, snapshot) =>
                                      snapshot.data == null
                                      ? const SizedBox.shrink()
                                      : Container(
                                          key: const ValueKey('credits'),
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 10,
                                            vertical: 6,
                                          ),
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(
                                              20,
                                            ),
                                            border: Border.all(
                                              color: scheme.outlineVariant,
                                            ),
                                          ),
                                          child: Text(
                                            Credits.describe(
                                              snapshot.data!,
                                            ).split(' · ').first,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: text.labelMedium,
                                          ),
                                        ),
                                ),
                              ),
                              const SizedBox(width: 4),
                              // the model sits beside Send, its name cut short when it doesn't fit
                              Flexible(
                                child: ConstrainedBox(
                                  constraints: const BoxConstraints(
                                    maxWidth: 200,
                                  ),
                                  child: FutureBuilder<String>(
                                    future: model,
                                    builder: (context, snapshot) => TextButton(
                                      key: const ValueKey('model'),
                                      onPressed: () => action('models'),
                                      style: TextButton.styleFrom(
                                        foregroundColor:
                                            scheme.onSurfaceVariant,
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                        ),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Flexible(
                                            child: Text(
                                              snapshot.data ?? 'Automatic',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          const Icon(
                                            Icons.expand_more,
                                            size: 18,
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (state.busy)
                          IconButton.filled(
                            tooltip: 'Stop',
                            onPressed: () => guard(context, () async {
                              await store.client.call('agent:stop', [dir]);
                            }),
                            style: IconButton.styleFrom(
                              backgroundColor: scheme.onSurface,
                              foregroundColor: scheme.surface,
                            ),
                            icon: const Icon(Icons.stop_rounded),
                          )
                        else
                          IconButton.filled(
                            tooltip: 'Send',
                            onPressed: canSend ? send : null,
                            icon: sending
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.arrow_upward),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Makes the new cut the film.
  void keep() =>
      guard(context, () => store.update('project:decide', [dir, true]));

  /// Turns the new cut down, with what should change for the agent's next try.
  void sendBack() => guard(context, () async {
    final reply = await askText(
      context,
      'What should change?',
      hint: 'Optional feedback for AgentShot',
    );
    if (reply == null) return;
    await store.update('project:decide', [dir, false]);
    if (reply.isNotEmpty && mounted) {
      await sendToAgent(context, store, dir, {'text': reply});
    }
  });

  /// In the conversation, under the agent's reply: a new cut is waiting, to watch, keep or send back from here.
  /// What a cut plays in a preview: its lighter proxy when there is one.
  String cutPlay(Json version) {
    final path = version['path'] as String;
    return object(project['proxies'] ?? {})[path] as String? ?? path;
  }

  /// A new cut, right in the conversation: watch it there, download it, keep it or send it back. Before and after
  /// side by side are in the Film tab.
  Widget proposalCard() {
    final version = objects(
      project['versions'],
    ).where((v) => v['id'] == project['proposal']).firstOrNull;
    if (version == null || version['path'] == null) return const SizedBox();
    return KeyedSubtree(
      key: const ValueKey('proposal-card'),
      child: CutCard(
        store: store,
        dir: dir,
        version: version,
        play: cutPlay(version),
        headline: 'A new cut is ready',
        highlight: true,
        actions: [
          FilledButton.icon(
            onPressed: keep,
            icon: const Icon(Icons.check),
            label: const Text('Keep'),
          ),
          TextButton(onPressed: sendBack, child: const Text('Send back')),
          // beside the conversation on a wide screen the film is already in sight
          if (!wide)
            TextButton(
              onPressed: () => setState(() {
                after = true;
                section = 1;
              }),
              child: const Text('Before / after'),
            ),
        ],
      ),
    );
  }

  /// The film as the agent last made it, at the end of the conversation: to watch or download without leaving it.
  Widget? latestCutCard() {
    final version = objects(
      project['versions'],
    ).where((v) => v['id'] == project['current']).firstOrNull;
    if (version == null ||
        version['by'] != 'agent' ||
        version['path'] == null) {
      return null;
    }
    return CutCard(
      store: store,
      dir: dir,
      version: version,
      play: cutPlay(version),
      headline: 'Your film',
    );
  }

  Widget film() {
    final selected = after
        ? project['proposal'] ?? project['current']
        : project['current'];
    final versions = objects(project['versions']);
    final version = versions.where((v) => v['id'] == selected).firstOrNull;
    final path = version?['path'] as String?;
    final proxy = object(project['proxies'] ?? {})[path] as String? ?? path;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (project['proposal'] != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'A new cut is ready',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ChoiceChip(
                        label: const Text('Before'),
                        selected: !after,
                        onSelected: (_) => setState(() => after = false),
                      ),
                      ChoiceChip(
                        label: const Text('After'),
                        selected: after,
                        onSelected: (_) => setState(() => after = true),
                      ),
                      FilledButton.icon(
                        onPressed: keep,
                        icon: const Icon(Icons.check),
                        label: const Text('Keep'),
                      ),
                      TextButton(
                        onPressed: sendBack,
                        child: const Text('Send back'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        if (proxy != null)
          RemotePlayer(
            key: ValueKey('$dir:$proxy'),
            uri: () => store.client.media(dir, proxy),
            initialPosition: position,
            onPosition: (value) => position = value,
            boxMode: boxMode,
            onBox: (box) => setState(() {
              anchor = {'t0': position, 'box': box};
              section = 0;
            }),
          ),
        if (proxy == null)
          const EmptyMessage(
            Icons.movie_outlined,
            'Your film starts here',
            'Ask AgentShot to create the first scene.',
          ),
        if (version != null)
          Text(
            '${version['title']}',
            style: Theme.of(context).textTheme.labelLarge,
          ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => setState(() {
                anchor = {'t0': position};
                section = 0;
              }),
              icon: const Icon(Icons.add_comment_outlined),
              label: const Text('Note here'),
            ),
            OutlinedButton.icon(
              onPressed: () => setState(() => boxMode = !boxMode),
              icon: const Icon(Icons.crop_free),
              label: Text(boxMode ? 'Cancel box' : 'Draw a box'),
            ),
            OutlinedButton(
              onPressed: rangeNote,
              child: const Text('Note a range'),
            ),
            OutlinedButton(
              onPressed: () => action('timeline'),
              child: const Text('Timeline & mix'),
            ),
          ],
        ),
        if (boxMode)
          const Padding(
            padding: EdgeInsets.all(8),
            child: Text(
              'Drag over the picture to attach a precise box to your next note.',
            ),
          ),
        for (final note in objects(project['notes']))
          ListTile(
            leading: Icon(
              note['status'] == 'resolved'
                  ? Icons.check_circle_outline
                  : Icons.comment_outlined,
            ),
            title: Text('${note['text']}'),
            subtitle: Text(
              '${timestamp(note['anchor']?['t0'] as num? ?? 0)} · ${note['reply'] ?? note['status']}',
            ),
          ),
      ],
    );
  }

  Future<void> rangeNote() async {
    final start = TextEditingController(text: position.toStringAsFixed(1)),
        end = TextEditingController(text: (position + 1).toStringAsFixed(1));
    String? error;
    final value = await showDialog<Json>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: const Text('Note a time range'),
          scrollable: true,
          content: Column(
            children: [
              TextField(
                controller: start,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(labelText: 'Start (seconds)'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: end,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(labelText: 'End (seconds)'),
              ),
              if (error != null) Text(error!),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final a = double.tryParse(start.text),
                    b = double.tryParse(end.text);
                if (a == null ||
                    b == null ||
                    !a.isFinite ||
                    !b.isFinite ||
                    a < 0 ||
                    b <= a ||
                    b > 86400) {
                  set(() => error = 'Enter a valid start and a later end.');
                  return;
                }
                Navigator.pop(context, {'t0': a, 't1': b});
              },
              child: const Text('Attach range'),
            ),
          ],
        ),
      ),
    );
    if (mounted && value != null) {
      setState(() {
        anchor = value;
        section = 0;
      });
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
    start.dispose();
    end.dispose();
  }

  Widget files() {
    final entries = object(project['files'] ?? {}).entries;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Project files', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(
          'Everything you brought in. Tap one to use it in your next note.',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => guard(context, importFiles),
          icon: const Icon(Icons.add),
          label: const Text('Import files'),
        ),
        for (final entry in entries)
          Card(
            key: ValueKey('file-${entry.key}'),
            child: ListTile(
              contentPadding: const EdgeInsets.fromLTRB(10, 6, 4, 6),
              leading: FileThumb(
                store: store,
                dir: dir,
                rel: entry.key,
                kind: '${entry.value['kind']}',
                duration:
                    (object(project['media'] ?? {})[entry.key]?['duration']
                            as num?)
                        ?.toDouble(),
              ),
              title: Text(
                entry.key.split('/').last,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${entry.value['summary'] ?? entry.value['kind']}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () => setState(() {
                attachments.add(entry.key);
                section = 0;
              }),
              trailing: PopupMenuButton<String>(
                tooltip: 'File actions',
                onSelected: (value) => guard(context, () async {
                  if (value == 'download') {
                    final file = await store.client.download(dir, entry.key);
                    if (!mounted) return;
                    final box = context.findRenderObject() as RenderBox;
                    await SharePlus.instance.share(
                      ShareParams(
                        files: [XFile(file.path)],
                        sharePositionOrigin:
                            box.localToGlobal(Offset.zero) & box.size,
                      ),
                    );
                  } else if (value == 'insert') {
                    final info = object(project['media'] ?? {})[entry.key];
                    if (info == null) {
                      throw BridgeException(
                        'Ask AgentShot how to use this file in the film.',
                      );
                    }
                    await store.update('timeline:edit', [
                      dir,
                      [
                        {
                          'op': 'insert',
                          'at': position,
                          'src': entry.key,
                          'in': 0,
                          'out': info['duration'],
                        },
                      ],
                    ]);
                  } else if (await confirm(
                    context,
                    'Remove file?',
                    'Move this file to the desktop Trash? Files used by the film are protected.',
                  )) {
                    final result = object(
                      await store.client.call('project:removeFiles', [
                        dir,
                        [entry.key],
                      ]),
                    );
                    await store.open(dir);
                    if (objects(result['blocked']).isNotEmpty) {
                      throw BridgeException(
                        objects(
                          result['blocked'],
                        ).map((v) => v['why']).join('\n'),
                      );
                    }
                  }
                }),
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: 'download',
                    child: Text('Download / share'),
                  ),
                  PopupMenuItem(
                    value: 'insert',
                    child: Text('Insert at playhead'),
                  ),
                  PopupMenuItem(value: 'delete', child: Text('Remove')),
                ],
              ),
            ),
          ),
      ],
    );
  }

  void mentions() {
    final items = <(String, String)>[
      for (final file in object(project['files'] ?? {}).keys)
        (file, file.split('/').last),
      for (final version in objects(project['versions']))
        ('${version['path']}', '${version['title']}'),
      for (final clip in object(project['clips'] ?? {}).entries)
        ('clips/${clip.key}/clip.html', '${clip.value['title']}'),
    ];
    sheet(
      context,
      'Mention a file, version or clip',
      Column(
        children: [
          for (final item in items)
            ListTile(
              title: Text(item.$2),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  attachments.add(item.$1);
                  if (message.text.endsWith('@')) {
                    message.text = message.text.substring(
                      0,
                      message.text.length - 1,
                    );
                  }
                  message.text += '@${item.$2} ';
                });
              },
            ),
        ],
      ),
    );
  }

  void action(String value) => guard(context, () async {
    switch (value) {
      case 'models':
        await panel(
          'Choose a model',
          () => store.client.call('agent:models', [dir]),
          (data, reload) => Column(
            children: [
              ListTile(
                title: const Text('Automatic'),
                onTap: () => guard(context, () async {
                  await store.client.call('agent:setModel', [dir, null]);
                  // picked: back to the chat
                  if (mounted) Navigator.of(context).pop();
                }),
              ),
              for (final model in objects(data['models']))
                ListTile(
                  title: Text('${model['name']}'),
                  subtitle: Text('${model['providerLabel']}'),
                  trailing: data['current']?['modelId'] == model['modelId']
                      ? const Icon(Icons.check)
                      : null,
                  onTap: () => guard(context, () async {
                    await store.client.call('agent:setModel', [
                      dir,
                      {
                        'provider': model['provider'],
                        'modelId': model['modelId'],
                      },
                    ]);
                    if (mounted) Navigator.of(context).pop();
                  }),
                ),
            ],
          ),
        );
        // the chosen model (a block: an arrow would hand setState the Future it assigns)
        if (mounted) {
          setState(() {
            model = loadModel();
          });
        }
      case 'conversations':
        await sheet(
          context,
          'Conversations',
          ListenableBuilder(
            listenable: store,
            builder: (context, _) => Column(
              children: [
                FilledButton.icon(
                  onPressed: () => guard(
                    context,
                    () => store.update('agent:newConversation', [dir]),
                  ),
                  icon: const Icon(Icons.add),
                  label: const Text('New conversation'),
                ),
                for (final conversation in objects(
                  project['conversations'],
                ).reversed)
                  ListTile(
                    title: Text('${conversation['title']}'),
                    selected: project['conversation'] == conversation['id'],
                    onTap: () => guard(
                      context,
                      () => store.update('agent:switch', [
                        dir,
                        conversation['id'],
                      ]),
                    ),
                    trailing: IconButton(
                      tooltip: 'Rename conversation',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => guard(context, () async {
                        final name = await askText(
                          context,
                          'Conversation name',
                          initial: '${conversation['title']}',
                        );
                        if (name != null && name.isNotEmpty) {
                          await store.update('agent:rename', [
                            dir,
                            conversation['id'],
                            name,
                          ]);
                        }
                      }),
                    ),
                  ),
              ],
            ),
          ),
        );
      case 'history':
        await panel(
          'Project history',
          () => store.client.call('history:log', [dir]),
          (data, reload) => Column(
            children: [
              for (final point in objects(data))
                ListTile(
                  title: Text('${point['message']}'),
                  subtitle: Text(
                    DateTime.fromMillisecondsSinceEpoch(
                      (point['at'] as num).toInt(),
                    ).toLocal().toString(),
                  ),
                  onTap: () => guard(context, () async {
                    if (await confirm(
                      context,
                      'Restore this checkpoint?',
                      'Restore the film and motion clips to this point?',
                    )) {
                      await store.update('history:restore', [dir, point['id']]);
                      reload();
                    }
                  }),
                ),
            ],
          ),
        );
      case 'versions':
        await sheet(
          context,
          'Every cut you kept',
          Column(
            children: [
              for (final version in objects(project['versions']).reversed)
                ListTile(
                  title: Text('${version['title']}'),
                  subtitle: Text('${version['by']}'),
                  selected: version['id'] == project['current'],
                  onTap: () => guard(context, () async {
                    await store.update('project:current', [dir, version['id']]);
                    if (mounted) Navigator.pop(context);
                  }),
                ),
            ],
          ),
        );
      case 'transcript':
        await sheet(
          context,
          'Transcript',
          Column(
            children: [
              for (final media in object(project['media'] ?? {}).keys)
                ExpansionTile(
                  title: Text(media.split('/').last),
                  children: [
                    AsyncPanel(
                      load: () => store.client.call('transcript:get', [
                        dir,
                        media,
                        false,
                      ]),
                      builder: (data, reload) => data == null
                          ? TextButton(
                              onPressed: () => guard(context, () async {
                                await store.client.call('transcript:get', [
                                  dir,
                                  media,
                                  true,
                                ]);
                                reload();
                              }),
                              child: const Text('Transcribe on desktop'),
                            )
                          : Column(
                              children: [
                                for (final segment in objects(data['segments']))
                                  ListTile(
                                    title: Text('${segment['text']}'),
                                    subtitle: Text(
                                      '${timestamp(segment['s'] as num)} – ${timestamp(segment['e'] as num)}',
                                    ),
                                    onTap: () {
                                      // Transcript times are source times, not edited-film times. Attach the source explicitly.
                                      Navigator.pop(context);
                                      setState(() {
                                        attachments.add(media);
                                        message.text =
                                            'In @$media from ${segment['s']}s to ${segment['e']}s: ';
                                        section = 0;
                                      });
                                    },
                                  ),
                              ],
                            ),
                    ),
                  ],
                ),
            ],
          ),
        );
      case 'timeline':
        await sheet(
          context,
          'Timeline & mix',
          TimelinePanel(store: store, position: () => position),
        );
    }
  });
}

Widget dropdown(
  String label,
  String value,
  Map<String, String> choices,
  ValueChanged<String> changed,
) => DropdownButtonFormField<String>(
  initialValue: value,
  isExpanded: true,
  decoration: InputDecoration(labelText: label),
  items: choices.entries
      .map(
        (e) => DropdownMenuItem(
          value: e.key,
          child: Text(e.value, overflow: TextOverflow.ellipsis),
        ),
      )
      .toList(),
  onChanged: (v) {
    if (v != null) changed(v);
  },
);

class TimelinePanel extends StatelessWidget {
  final BridgeStore store;
  final double Function() position;
  const TimelinePanel({super.key, required this.store, required this.position});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final p = store.project!, dir = p['dir'];
      final timeline = object(p['timeline'] ?? {}),
          items = objects(timeline['items']);
      Future<void> edit(Json value) => store.update('timeline:edit', [
        dir,
        [value],
      ]);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Changes use the same undo history as the desktop. Render a preview after manual changes to review the complete film and mix.',
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: () => guard(
                  context,
                  () => store.update('timeline:undo', [dir, false]),
                ),
                icon: const Icon(Icons.undo),
                label: const Text('Undo'),
              ),
              OutlinedButton.icon(
                onPressed: () => guard(
                  context,
                  () => store.update('timeline:undo', [dir, true]),
                ),
                icon: const Icon(Icons.redo),
                label: const Text('Redo'),
              ),
              OutlinedButton(
                onPressed: () => guard(
                  context,
                  () => edit({'op': 'split', 'at': position()}),
                ),
                child: const Text('Split at playhead'),
              ),
              FilledButton(
                onPressed: () => guard(context, () async {
                  await store.client.call('timeline:render', [dir]);
                  await store.open(dir);
                }),
                child: const Text('Render preview'),
              ),
            ],
          ),
          for (final entry in items.asMap().entries)
            Card(
              child: ExpansionTile(
                title: Text(
                  '${entry.key + 1}. ${entry.value['src'] ?? entry.value['clip']}',
                ),
                subtitle: Text(
                  entry.value['kind'] == 'media'
                      ? '${timestamp(entry.value['in'] as num)} – ${timestamp(entry.value['out'] as num)}'
                      : '${entry.value['dur']} seconds',
                ),
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (entry.key > 0)
                          OutlinedButton(
                            onPressed: () => guard(
                              context,
                              () => edit({
                                'op': 'move',
                                'id': entry.value['id'],
                                'before': items[entry.key - 1]['id'],
                              }),
                            ),
                            child: const Text('Move earlier'),
                          ),
                        if (entry.key < items.length - 1)
                          OutlinedButton(
                            onPressed: () => guard(
                              context,
                              () => edit({
                                'op': 'move',
                                'id': entry.value['id'],
                                if (entry.key + 2 < items.length)
                                  'before': items[entry.key + 2]['id'],
                              }),
                            ),
                            child: const Text('Move later'),
                          ),
                        if (entry.value['kind'] == 'media')
                          OutlinedButton(
                            onPressed: () => guard(
                              context,
                              () => edit({
                                'op': 'level',
                                'ids': [entry.value['id']],
                                'muted': entry.value['muted'] != true,
                              }),
                            ),
                            child: Text(
                              entry.value['muted'] == true ? 'Unmute' : 'Mute',
                            ),
                          ),
                        if (entry.value['kind'] == 'media')
                          OutlinedButton(
                            onPressed: () => guard(context, () async {
                              final value = await askText(
                                context,
                                'Trim source in/out (seconds)',
                                initial:
                                    '${entry.value['in']}, ${entry.value['out']}',
                              );
                              if (value == null) return;
                              final numbers = value
                                  .split(',')
                                  .map((s) => double.tryParse(s.trim()))
                                  .toList();
                              if (numbers.length != 2 ||
                                  numbers.any(
                                    (n) => n == null || !n.isFinite,
                                  ) ||
                                  numbers[0]! < 0 ||
                                  numbers[1]! <= numbers[0]!) {
                                throw BridgeException(
                                  'Enter two valid seconds: start, end.',
                                );
                              }
                              await edit({
                                'op': 'trim',
                                'id': entry.value['id'],
                                'in': numbers[0],
                                'out': numbers[1],
                              });
                            }),
                            child: const Text('Trim'),
                          ),
                        TextButton(
                          onPressed: () => guard(
                            context,
                            () => edit({
                              'op': 'delete',
                              'ids': [entry.value['id']],
                            }),
                          ),
                          child: const Text('Remove piece'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          Text('Audio mix', style: Theme.of(context).textTheme.titleLarge),
          MixEditor(
            key: ValueKey('$dir:${timeline['mix']}'),
            mix: object(timeline['mix'] ?? {'filmDb': 0}),
            files: object(p['files'] ?? {}),
            onSave: (mix) => edit({'op': 'mix', 'mix': mix}),
          ),
        ],
      );
    },
  );
}

class MixEditor extends StatefulWidget {
  final Json mix, files;
  final Future<void> Function(Json) onSave;
  const MixEditor({
    super.key,
    required this.mix,
    required this.files,
    required this.onSave,
  });
  @override
  State<MixEditor> createState() => _MixEditorState();
}

class _MixEditorState extends State<MixEditor> {
  late double
  film = (widget.mix['filmDb'] as num? ?? 0).toDouble().clamp(-40, 12),
  music = (widget.mix['music']?['db'] as num? ?? -18).toDouble().clamp(-40, 12),
  duck = (widget.mix['music']?['duckDb'] as num? ?? 12).toDouble().clamp(0, 40);
  late String source = widget.mix['music']?['src'] as String? ?? '';
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text('Film ${film.round()} dB'),
      Slider(
        value: film,
        min: -40,
        max: 12,
        onChanged: (v) => setState(() => film = v),
      ),
      dropdown('Music', source, {
        '': 'No music',
        if (source.isNotEmpty) source: source.split('/').last,
        for (final e in widget.files.entries)
          if (e.value['kind'] == 'audio') e.key: e.key.split('/').last,
      }, (v) => setState(() => source = v)),
      if (source.isNotEmpty) ...[
        Text('Music ${music.round()} dB'),
        Slider(
          value: music,
          min: -40,
          max: 12,
          onChanged: (v) => setState(() => music = v),
        ),
        Text('Duck under speech ${duck.round()} dB'),
        Slider(
          value: duck,
          min: 0,
          max: 40,
          onChanged: (v) => setState(() => duck = v),
        ),
      ],
      OutlinedButton(
        onPressed: () => guard(
          context,
          () => widget.onSave({
            'filmDb': film,
            if (source.isNotEmpty)
              'music': {'src': source, 'db': music, 'duckDb': duck},
          }),
        ),
        child: const Text('Save mix'),
      ),
    ],
  );
}

/// A file's picture in a list: a frame of a video or the photo (from the computer), else its kind's icon; a video's
/// length on it.
class FileThumb extends StatefulWidget {
  final BridgeStore store;
  final String dir, rel, kind;
  final double? duration;
  const FileThumb({
    super.key,
    required this.store,
    required this.dir,
    required this.rel,
    required this.kind,
    this.duration,
  });
  @override
  State<FileThumb> createState() => _FileThumbState();
}

class _FileThumbState extends State<FileThumb> {
  late final Future<Uri>? picture =
      widget.kind == 'video' || widget.kind == 'image'
      ? widget.store.client.thumbnail(widget.dir, widget.rel)
      : null;

  IconData get icon => switch (widget.kind) {
    'video' => Icons.movie_outlined,
    'image' => Icons.image_outlined,
    'audio' => Icons.music_note_outlined,
    'subtitles' => Icons.closed_caption_outlined,
    'font' => Icons.text_fields,
    _ => Icons.insert_drive_file_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fallback = Center(child: Icon(icon, color: scheme.onSurfaceVariant));
    final d = widget.duration;
    return SizedBox(
      width: 88,
      height: 50,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: scheme.surfaceContainerHighest),
            if (picture != null)
              FutureBuilder<Uri>(
                future: picture,
                builder: (context, snapshot) => snapshot.hasData
                    ? Image.network(
                        '${snapshot.data}',
                        key: ValueKey('thumb-${widget.rel}'),
                        fit: BoxFit.cover,
                        cacheWidth: 264,
                        errorBuilder: (_, _, _) => fallback,
                      )
                    : fallback,
              )
            else
              fallback,
            if (d != null &&
                d > 0 &&
                (widget.kind == 'video' || widget.kind == 'audio'))
              Positioned(
                right: 3,
                bottom: 3,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: .7),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    timestamp(d),
                    style: const TextStyle(color: Colors.white, fontSize: 10.5),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
