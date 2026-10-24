import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../bridge/client.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'project.dart';
import 'settings.dart';
import 'player.dart';

class HomeScreen extends StatefulWidget {
  final BridgeStore store;
  final ThemeMode theme;
  final ValueChanged<ThemeMode> onTheme;
  final Future<void> Function() onDisconnect;
  const HomeScreen({
    super.key,
    required this.store,
    required this.theme,
    required this.onTheme,
    required this.onDisconnect,
  });
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int section = 0;
  String search = '';
  bool working = false;
  double? progress;
  BridgeStore get store => widget.store;
  Future<void> open(Json project) async {
    await store.open(project['dir'] as String);
    if (mounted) {
      await Navigator.push(
        context,
        MaterialPageRoute<void>(builder: (_) => ProjectScreen(store: store)),
      );
    }
    await store.refresh();
  }

  Future<void> import({bool camera = false}) async {
    if (working) return;
    setState(() => working = true);
    await guard(context, () async {
      final files = <(File, String)>[];
      if (camera) {
        final picked = await ImagePicker().pickVideo(
          source: ImageSource.camera,
        );
        if (picked != null) files.add((File(picked.path), picked.name));
      } else {
        final picked = await FilePicker.pickFiles();
        for (final file in picked) {
          if (file.path != null) files.add((File(file.path!), file.name));
        }
      }
      if (files.isEmpty) return;
      Json? project;
      for (final file in files) {
        final result = await store.client.upload(
          file.$1,
          file.$2,
          project: project?['dir'] as String?,
          progress: (value) {
            if (mounted) setState(() => progress = value);
          },
        );
        if (project == null) {
          project = object(result);
          await store.open(project['dir'] as String);
        }
      }
      if (project != null) await open(project);
    });
    if (mounted) {
      setState(() {
        working = false;
        progress = null;
      });
    }
  }

  Future<void> createMotion({Json? example, bool walkthrough = false}) async {
    final title = await askText(
      context,
      walkthrough ? 'What should AgentShot film?' : 'What are we making?',
      hint: walkthrough
          ? 'A walkthrough of my product at https://…'
          : 'Describe your video…',
    );
    if (title == null || title.isEmpty || !mounted) return;
    var aspect = '16:9';
    if (!walkthrough) {
      final choice = await showDialog<String>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('Choose a format'),
          children: [
            for (final item in ['16:9', '9:16', '1:1'])
              SimpleDialogOption(
                onPressed: () => Navigator.pop(context, item),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(item),
                ),
              ),
          ],
        ),
      );
      if (choice == null) return;
      aspect = choice;
    }
    if (!mounted) return;
    await guard(context, () async {
      setState(() => working = true);
      try {
        final p = object(
          await store.client.call('project:createMotion', [
            {
              'title': title.substring(0, title.length.clamp(0, 80)),
              'aspect': aspect,
              if (example != null) 'example': example['id'],
              if (walkthrough) 'walkthrough': true,
            },
          ]),
        );
        await store.open(p['dir'] as String);
        await store.client.call('agent:send', [
          p['dir'],
          {'text': title},
        ]);
        await open(p);
      } finally {
        if (mounted) setState(() => working = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final views = [
        projects(),
        gallery(),
        activity(),
        SettingsScreen(
          store: store,
          theme: widget.theme,
          onTheme: widget.onTheme,
          onDisconnect: widget.onDisconnect,
        ),
      ];
      final destinations = [
        const NavigationDestination(
          icon: Icon(Icons.movie_outlined),
          label: 'Projects',
        ),
        const NavigationDestination(
          icon: Icon(Icons.auto_awesome_outlined),
          label: 'Examples',
        ),
        const NavigationDestination(
          icon: Icon(Icons.bolt_outlined),
          label: 'Activity',
        ),
        const NavigationDestination(
          icon: Icon(Icons.settings_outlined),
          label: 'Settings',
        ),
      ];
      return Scaffold(
        appBar: AppBar(
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset(
                'assets/manul.png',
                width: 34,
                height: 34,
                excludeFromSemantics: true,
              ),
              const SizedBox(width: 10),
              const Flexible(child: Text('AgentShot')),
            ],
          ),
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: () => guard(context, store.refresh),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (!store.connected)
                Material(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        const Icon(Icons.sync, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            store.connectionError ??
                                'Connecting to your desktop…',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (working) LinearProgressIndicator(value: progress),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, size) {
                    if (size.maxWidth < 760) return views[section];
                    return Row(
                      children: [
                        SingleChildScrollView(
                          child: IntrinsicHeight(
                            child: NavigationRail(
                              selectedIndex: section,
                              onDestinationSelected: (i) =>
                                  setState(() => section = i),
                              labelType: NavigationRailLabelType.all,
                              destinations: destinations
                                  .map(
                                    (d) => NavigationRailDestination(
                                      icon: d.icon,
                                      label: Text(d.label),
                                    ),
                                  )
                                  .toList(),
                            ),
                          ),
                        ),
                        const VerticalDivider(width: 1),
                        Expanded(child: views[section]),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: MediaQuery.sizeOf(context).width >= 760
            ? null
            : NavigationBar(
                selectedIndex: section,
                onDestinationSelected: (i) => setState(() => section = i),
                destinations: destinations,
              ),
      );
    },
  );

  Widget projects() {
    final results = store.projects
        .where(
          (p) => '${p['title']}'.toLowerCase().contains(search.toLowerCase()),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: store.refresh,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'What are we making?',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 8),
          const Text('Bring your footage. Tell AgentShot what should change.'),
          const SizedBox(height: 24),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              FilledButton.icon(
                onPressed: working || !store.connected ? null : () => import(),
                icon: const Icon(Icons.add),
                label: const Text('Import footage'),
              ),
              OutlinedButton.icon(
                onPressed: working || !store.connected
                    ? null
                    : () => import(camera: true),
                icon: const Icon(Icons.videocam_outlined),
                label: const Text('Record'),
              ),
              OutlinedButton.icon(
                onPressed: working || !store.connected ? null : createMotion,
                icon: const Icon(Icons.auto_awesome),
                label: const Text('Start from an idea'),
              ),
              OutlinedButton.icon(
                onPressed: working || !store.connected
                    ? null
                    : () => createMotion(walkthrough: true),
                icon: const Icon(Icons.web),
                label: const Text('Film a walkthrough'),
              ),
            ],
          ),
          const SizedBox(height: 28),
          TextField(
            onChanged: (value) => setState(() => search = value),
            decoration: const InputDecoration(
              labelText: 'Search projects',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 16),
          if (results.isEmpty)
            const EmptyMessage(
              Icons.video_library_outlined,
              'A home for your films',
              'Import a video or start with an idea. Your desktop projects appear here too.',
            ),
          for (final p in results)
            Card(
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                leading: const Icon(Icons.movie_outlined),
                title: Text('${p['title']}'),
                subtitle: const Text('On your computer'),
                onTap: () => guard(context, () => open(p)),
                trailing: PopupMenuButton<String>(
                  tooltip: 'Project actions',
                  onSelected: (_) => guard(context, () async {
                    if (await confirm(
                      context,
                      'Delete project?',
                      'Move this project and all of its files to the Trash on your computer?',
                    )) {
                      await store.client.call('project:delete', [p['dir']]);
                      await store.refresh();
                    }
                  }),
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text('Move to Trash'),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget gallery() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text(
        'Start with a little inspiration',
        style: Theme.of(context).textTheme.headlineMedium,
      ),
      const SizedBox(height: 12),
      const Text(
        'Real motion examples, with the prompts and creators behind them.',
      ),
      const SizedBox(height: 20),
      AsyncPanel(
        load: () => store.client.call('gallery:list'),
        builder: (data, reload) => GalleryList(
          examples: objects(data),
          store: store,
          onUse: (e) => createMotion(example: e),
        ),
      ),
    ],
  );
  Widget activity() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text('Activity', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 16),
      ConsentCards(store: store),
      if (store.jobs.isEmpty)
        const EmptyMessage(
          Icons.check_circle_outline,
          'All quiet for now',
          'Imports, transcription, downloads and renders appear here.',
        ),
      for (final job in store.jobs.reversed)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${job['status'] == 'done' ? job['doneTitle'] ?? job['title'] : job['title']}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text('${job['detail'] ?? job['status']}'),
                if (job['status'] == 'running')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: LinearProgressIndicator(
                      value: (job['progress'] as num?)?.toDouble().clamp(0, 1),
                    ),
                  ),
              ],
            ),
          ),
        ),
    ],
  );
}

class ConsentCards extends StatelessWidget {
  final BridgeStore store;
  const ConsentCards({super.key, required this.store});
  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final item in store.consents)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${item['title']}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text('${item['body']}'),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    TextButton(
                      onPressed: () => guard(context, () async {
                        await store.client.call('consent:answer', [
                          item['id'],
                          false,
                        ]);
                      }),
                      child: const Text('Decline'),
                    ),
                    FilledButton(
                      onPressed: () => guard(context, () async {
                        await store.client.call('consent:answer', [
                          item['id'],
                          true,
                        ]);
                      }),
                      child: Text('${item['confirm']}'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
    ],
  );
}

class GalleryList extends StatefulWidget {
  final List<Json> examples;
  final BridgeStore store;
  final ValueChanged<Json> onUse;
  const GalleryList({
    super.key,
    required this.examples,
    required this.store,
    required this.onUse,
  });
  @override
  State<GalleryList> createState() => _GalleryListState();
}

class _GalleryListState extends State<GalleryList> {
  String query = '', tag = 'All';
  @override
  Widget build(BuildContext context) {
    final tags = <String>{
      'All',
      for (final e in widget.examples)
        for (final t in objects(e['tags'])) '${t['name']}',
    };
    final items = widget.examples.where(
      (e) =>
          '${e['title']} ${e['prompt']}'.toLowerCase().contains(
            query.toLowerCase(),
          ) &&
          (tag == 'All' || objects(e['tags']).any((t) => t['name'] == tag)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          decoration: const InputDecoration(
            labelText: 'Search examples',
            prefixIcon: Icon(Icons.search),
          ),
          onChanged: (v) => setState(() => query = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: tag,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Category'),
          items: tags
              .map(
                (t) => DropdownMenuItem(
                  value: t,
                  child: Text(t, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => tag = v ?? 'All'),
        ),
        const SizedBox(height: 12),
        for (final e in items)
          Card(
            child: ListTile(
              leading: const Icon(Icons.play_circle_outline),
              title: Text('${e['title']}'),
              subtitle: Text(
                'By ${e['creator']?['name'] ?? e['creator']?['handle'] ?? ''}',
              ),
              onTap: () => sheet(
                context,
                '${e['title']}',
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    RemotePlayer(
                      key: ValueKey(e['id']),
                      uri: () =>
                          widget.store.client.gallery(e['video'] as String),
                    ),
                    const SizedBox(height: 16),
                    Text('By ${e['creator']?['name'] ?? ''}'),
                    SelectableText('${e['source'] ?? ''}'),
                    if (e['post'] != null) SelectableText('${e['post']}'),
                    const SizedBox(height: 12),
                    SelectableText('${e['prompt'] ?? e['skill'] ?? ''}'),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () {
                        Navigator.pop(context);
                        widget.onUse(e);
                      },
                      child: const Text('Use this example'),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
