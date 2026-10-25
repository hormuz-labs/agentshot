import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'home.dart' show ConsentCards;
import 'player.dart';

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
  bool follow = true;
  int section = 0;
  bool after = true, boxMode = false, sending = false, exporting = false;
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
    setState(() => sending = true);
    await guard(context, () async {
      await store.client.call('agent:send', [
        dir,
        {
          'text': message.text.trim(),
          if (anchor != null) 'anchor': anchor,
          if (attachments.isNotEmpty) 'files': attachments.toList(),
        },
      ]);
      message.clear();
      follow = true; // after sending, show what comes back
      if (mounted) {
        setState(() {
          anchor = null;
          boxMode = false;
          attachments.clear();
        });
      }
    });
    if (mounted) setState(() => sending = false);
  }

  Future<void> importFiles() async {
    final picked = await FilePicker.pickFiles();
    if (picked.isEmpty) return;
    for (final file in picked) {
      if (file.path == null) continue;
      final rels = await store.client.upload(
        File(file.path!),
        file.name,
        project: dir,
      );
      attachments.addAll((rels as List).cast<String>());
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
              if (!store.connected)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(store.connectionError ?? 'Reconnecting…'),
                ),
              if (exporting)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      Text(exportStatus ?? ''),
                      const SizedBox(height: 8),
                      const LinearProgressIndicator(),
                    ],
                  ),
                ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, size) {
                    final wide =
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
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Row(
                            children: [
                              for (final entry in [
                                'Conversation',
                                'Film',
                                'Files',
                              ].asMap().entries)
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: ChoiceChip(
                                    label: Text(entry.value),
                                    selected: section == entry.key,
                                    onSelected: (_) =>
                                        setState(() => section = entry.key),
                                  ),
                                ),
                            ],
                          ),
                        ),
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
    final shown =
        '$dir:${state.messages.length}:${state.streaming.length}:${state.tools.length}:${state.busy}:${state.error}';
    if (shown == chatShown) return;
    chatShown = shown;
    if (!follow) return;
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

  Widget chat() {
    final state = store.agent(dir);
    final messages = state.messages;
    followChat(state);
    return LayoutBuilder(
      builder: (context, available) => Column(
        children: [
          Expanded(
            child: NotificationListener<ScrollEndNotification>(
              onNotification: (_) {
                follow = chatScroll.position.extentAfter < 120;
                return false;
              },
              child: ListView(
                controller: chatScroll,
                padding: const EdgeInsets.all(16),
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
                      state.streaming.isEmpty)
                    const EmptyMessage(
                      Icons.chat_bubble_outline,
                      'Give notes. Get cuts.',
                      'Ask for an edit, attach a file, or point at a moment in the Film tab.',
                    ),
                  for (final m in messages)
                    if (m['role'] == 'tool')
                      ExpansionTile(
                        title: const Text('Tool result'),
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(12),
                            child: SelectableText('${m['content'] ?? ''}'),
                          ),
                        ],
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Card(
                          color: m['role'] == 'user'
                              ? Theme.of(
                                  context,
                                ).colorScheme.surfaceContainerHighest
                              : null,
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  m['role'] == 'user' ? 'You' : 'AgentShot',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.labelMedium,
                                ),
                                const SizedBox(height: 8),
                                if ('${m['content'] ?? ''}'.isNotEmpty)
                                  SelectableText('${m['content']}'),
                                for (final call in objects(m['toolCalls']))
                                  ExpansionTile(
                                    tilePadding: EdgeInsets.zero,
                                    title: Text(
                                      '${call['function']?['name'] ?? 'Tool'}',
                                    ),
                                    children: [
                                      SelectableText(
                                        '${call['function']?['arguments'] ?? ''}',
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                  if (state.streaming.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: SelectableText(state.streaming),
                    ),
                  for (final name in state.tools.values)
                    ListTile(
                      leading: const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      title: Text(name),
                    ),
                  if (state.error != null)
                    Text(
                      state.error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (state.busy) const LinearProgressIndicator(),
                  if (state.cost > 0)
                    Text(
                      'Session usage: \$${state.cost.toStringAsFixed(4)}',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                ],
              ),
            ),
          ),
          // Bound composer height under large text/landscape/keyboard constraints; content scrolls.
          LayoutBuilder(
            builder: (context, size) => ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: (available.maxHeight * .55).clamp(
                  0.0,
                  MediaQuery.sizeOf(context).height * .32,
                ),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (anchor != null)
                      Wrap(
                        children: [
                          InputChip(
                            label: Text(
                              'Note at ${timestamp(anchor!['t0'] as num)}${anchor!['box'] != null ? ' · box' : ''}',
                            ),
                            onDeleted: () => setState(() {
                              anchor = null;
                              boxMode = false;
                            }),
                          ),
                        ],
                      ),
                    if (attachments.isNotEmpty)
                      Wrap(
                        spacing: 6,
                        children: attachments
                            .map(
                              (f) => InputChip(
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
                            )
                            .toList(),
                      ),
                    TextField(
                      controller: message,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        hintText: 'Ask for an edit, or @ a file…',
                        labelText: 'Your notes',
                      ),
                      onChanged: (v) {
                        if (v.endsWith('@')) mentions();
                      },
                    ),
                    Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        IconButton(
                          tooltip: 'Import and attach files',
                          onPressed: () => guard(context, importFiles),
                          icon: const Icon(Icons.attach_file),
                        ),
                        IconButton(
                          tooltip: 'Mention file, version or clip',
                          onPressed: mentions,
                          icon: const Icon(Icons.alternate_email),
                        ),
                        if (state.busy)
                          TextButton.icon(
                            onPressed: () => guard(context, () async {
                              await store.client.call('agent:stop', [dir]);
                            }),
                            icon: const Icon(Icons.stop),
                            label: const Text('Stop'),
                          ),
                        FilledButton.icon(
                          onPressed: sending || !store.connected ? null : send,
                          icon: const Icon(Icons.arrow_upward),
                          label: Text(sending ? 'Sending…' : 'Send'),
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
                        onPressed: () => guard(
                          context,
                          () => store.update('project:decide', [dir, true]),
                        ),
                        icon: const Icon(Icons.check),
                        label: const Text('Keep'),
                      ),
                      TextButton(
                        onPressed: () => guard(context, () async {
                          final reply = await askText(
                            context,
                            'What should change?',
                            hint: 'Optional feedback for AgentShot',
                          );
                          if (reply == null) return;
                          await store.update('project:decide', [dir, false]);
                          if (reply.isNotEmpty) {
                            await store.client.call('agent:send', [
                              dir,
                              {'text': reply},
                            ]);
                          }
                        }),
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
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => guard(context, importFiles),
          icon: const Icon(Icons.add),
          label: const Text('Import files'),
        ),
        for (final entry in entries)
          Card(
            child: ListTile(
              title: Text(entry.key.split('/').last),
              subtitle: Text(
                '${entry.value['summary'] ?? entry.value['kind']}',
              ),
              onTap: () => setState(() {
                attachments.add(entry.key);
                section = 0;
              }),
              trailing: PopupMenuButton<String>(
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
                  reload();
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
                    reload();
                  }),
                ),
            ],
          ),
        );
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
