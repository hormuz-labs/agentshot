import 'package:flutter/material.dart';
import '../bridge/account.dart';
import '../bridge/client.dart';
import '../bridge/pick.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'project.dart';
import 'settings.dart';
import 'player.dart';
import 'import.dart';
import 'mascot.dart';
import 'setup_ai.dart';

class HomeScreen extends StatefulWidget {
  final BridgeStore store;
  final ThemeMode theme;
  final ValueChanged<ThemeMode> onTheme;
  final Future<void> Function() onDisconnect;

  /// Signed in to AgentShot (else paired with a code): Settings offers switching computer and signing out.
  final Account? account;
  final Future<void> Function() onSignOut;
  const HomeScreen({
    super.key,
    required this.store,
    required this.theme,
    required this.onTheme,
    required this.onDisconnect,
    this.account,
    required this.onSignOut,
  });
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int section = 0;
  String search = '';
  bool working = false;
  double? progress;
  String? status;
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

  /// Brings footage in: a recording, or several videos, photos or both. Videos go first, so the project starts from
  /// one; photos alone start a project made from scratch, with the photos as its material.
  Future<void> import({bool camera = false}) async {
    if (working) return;
    final List<Picked> files;
    if (camera) {
      final recorded = await Picker.record();
      files = [?recorded];
    } else {
      final kind = await choosePick(context);
      if (kind == null) return;
      files = await Picker.pick(kind);
    }
    if (files.isEmpty || !mounted) return;
    final ordered = [
      ...files.where((f) => f.isVideo),
      ...files.where((f) => !f.isVideo),
    ];
    String? aspect;
    if (!ordered.first.isVideo) {
      if (!ordered.any((f) => f.isPhoto)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Start with a video or some photos; other files can come with them.',
            ),
          ),
        );
        return;
      }
      aspect = await chooseFormat(context);
      if (aspect == null || !mounted) return;
    }
    setState(() => working = true);
    await guard(context, () async {
      Json? project;
      if (aspect != null) {
        final photos = ordered.where((f) => f.isPhoto).length;
        project = object(
          await store.client.call('project:createMotion', [
            {
              'title': photos == 1 ? 'From a photo' : 'From $photos photos',
              'aspect': aspect,
            },
          ]),
        );
        await store.open(project['dir'] as String);
      }
      for (final (index, file) in ordered.indexed) {
        if (mounted) {
          setState(
            () => status = 'Uploading ${index + 1} of ${ordered.length}…',
          );
        }
        final result = await store.client.upload(
          file.file,
          file.name,
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
        status = null;
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
      final choice = await chooseFormat(context);
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
        if (!mounted) return;
        await sendToAgent(context, store, p['dir'] as String, {'text': title});
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
          account: widget.account,
          onSignOut: widget.onSignOut,
        ),
      ];
      // outlined, filled when it's the tab showing
      final destinations = [
        const Destination(
          Icons.video_library_outlined,
          Icons.video_library_rounded,
          'Projects',
        ),
        const Destination(
          Icons.explore_outlined,
          Icons.explore_rounded,
          'Examples',
        ),
        Destination(
          Icons.notifications_none_rounded,
          Icons.notifications_rounded,
          'Activity',
          badge: store.consents.length,
        ),
        const Destination(
          Icons.settings_outlined,
          Icons.settings_rounded,
          'Settings',
        ),
      ];
      final narrow = MediaQuery.sizeOf(context).width < 760;
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
              // never more than the screen shares out (a landscape phone with the keyboard up leaves a sliver)
              if (!store.connected)
                Flexible(
                  child: Material(
                    color: Theme.of(
                      context,
                    ).colorScheme.surfaceContainerHighest,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          const Icon(Icons.sync, size: 20),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              store.connectionError ??
                                  'Connecting to your computer…',
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          // never stuck waiting: another computer, or the same one again
                          TextButton(
                            onPressed: () =>
                                guard(context, widget.onDisconnect),
                            child: const Text('Change computer'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              if (working) LinearProgressIndicator(value: progress),
              if (working && status != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                  child: Text(status!, key: const ValueKey('upload-status')),
                ),
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
                              leading: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 8,
                                ),
                                child: FloatingActionButton(
                                  heroTag: null,
                                  tooltip: 'Start something new',
                                  elevation: 1,
                                  shape: const CircleBorder(),
                                  onPressed: startSheet,
                                  child: const Icon(Icons.add),
                                ),
                              ),
                              destinations: [
                                for (final d in destinations)
                                  NavigationRailDestination(
                                    icon: d.iconWith(),
                                    selectedIcon: d.iconWith(selected: true),
                                    label: Text(d.label),
                                  ),
                              ],
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
        // the + sits in a notch in the middle of the bar, two tabs either side
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
        floatingActionButton: narrow
            ? FloatingActionButton(
                heroTag: null,
                tooltip: 'Start something new',
                shape: const CircleBorder(),
                elevation: 2,
                backgroundColor: Theme.of(context).colorScheme.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
                onPressed: startSheet,
                child: const Icon(Icons.add, size: 30),
              )
            : null,
        bottomNavigationBar: narrow
            ? BottomAppBar(
                // its own surface: a shade apart from the page, lifted a little
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                elevation: 6,
                shadowColor: Colors.black,
                shape: const CircularNotchedRectangle(),
                notchMargin: 8,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                height: 72,
                child: Row(
                  children: [
                    for (final (i, d) in destinations.indexed) ...[
                      if (i == 2) const SizedBox(width: 72),
                      Expanded(
                        child: NavItem(
                          d,
                          selected: section == i,
                          onTap: () => setState(() => section = i),
                        ),
                      ),
                    ],
                  ],
                ),
              )
            : null,
      );
    },
  );

  /// The ways to start something, behind the + in the bar (or atop the side rail).
  List<StartOption> get starts {
    final ready = !working && store.connected;
    return [
      StartOption(
        Icons.add_photo_alternate_outlined,
        'Import footage',
        'Videos and photos from this phone',
        ready ? () => import() : null,
      ),
      StartOption(
        Icons.videocam_outlined,
        'Record',
        'Film something now',
        ready ? () => import(camera: true) : null,
      ),
      StartOption(
        Icons.auto_awesome,
        'Start from an idea',
        'Describe it; AgentShot makes it',
        ready ? createMotion : null,
      ),
      StartOption(
        Icons.web,
        'Film a walkthrough',
        'A site or product, filmed for you',
        ready ? () => createMotion(walkthrough: true) : null,
      ),
    ];
  }

  /// The + in the bar: what to start, from any tab.
  void startSheet() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    useSafeArea: true,
    // the options turn on as soon as the computer is connected, sheet open or not
    builder: (sheet) => ListenableBuilder(
      listenable: store,
      builder: (sheet, _) => SingleChildScrollView(
        key: const ValueKey('start-sheet'),
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Start something new',
              style: Theme.of(sheet).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            for (final option in starts)
              ListTile(
                contentPadding: const EdgeInsets.symmetric(vertical: 4),
                enabled: option.onTap != null,
                leading: Icon(option.icon),
                title: Text(option.title),
                subtitle: Text(option.hint),
                onTap: () {
                  Navigator.pop(sheet);
                  option.onTap?.call();
                },
              ),
          ],
        ),
      ),
    ),
  );

  Widget projects() {
    final results = store.projects
        .where(
          (p) => '${p['title']}'.toLowerCase().contains(search.toLowerCase()),
        )
        .toList();
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: store.refresh,
      child: ListView(
        // room at the end to scroll clear of the + and the bar
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
        children: [
          Text('What are we making?', style: theme.textTheme.headlineMedium),
          const SizedBox(height: 8),
          Text(
            'Bring your footage. Tell AgentShot what should change.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),
          TextField(
            onChanged: (value) => setState(() => search = value),
            decoration: InputDecoration(
              labelText: 'Search projects',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(28),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (results.isEmpty)
            EmptyMessage(
              Icons.video_library_outlined,
              'A home for your films',
              search.isEmpty
                  ? 'Tap + to bring in footage or start from an idea. Your desktop projects show up here too.'
                  : 'Nothing matches that. Try another word.',
              art: search.isEmpty ? const Mascot(size: 88) : null,
            ),
          for (final p in results)
            ListTile(
              contentPadding: const EdgeInsets.only(left: 4),
              leading: const Icon(Icons.movie_outlined),
              title: Text(
                '${p['title']}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
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
        ],
      ),
    );
  }

  Widget gallery() => ListView(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 96),
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
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 96),
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

/// A way to start something, in the + sheet.
class StartOption {
  final IconData icon;
  final String title, hint;
  final VoidCallback? onTap;
  const StartOption(this.icon, this.title, this.hint, this.onTap);
}

/// A tab of the home screen.
class Destination {
  final IconData icon, selectedIcon;
  final String label;

  /// Things waiting on the person there (questions in Activity).
  final int badge;
  const Destination(this.icon, this.selectedIcon, this.label, {this.badge = 0});

  Widget iconWith({bool selected = false}) => Badge(
    isLabelVisible: badge > 0,
    label: Text('$badge'),
    child: Icon(selected ? selectedIcon : icon),
  );
}

/// A tab in the bottom bar: its icon and name, filled and coloured when it's the one showing.
class NavItem extends StatelessWidget {
  final Destination destination;
  final bool selected;
  final VoidCallback onTap;
  const NavItem(
    this.destination, {
    super.key,
    required this.selected,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), scheme = theme.colorScheme;
    final color = selected ? scheme.primary : scheme.onSurfaceVariant;
    return Semantics(
      button: true,
      selected: selected,
      label: destination.label,
      excludeSemantics: true,
      child: InkResponse(
        key: ValueKey('nav-${destination.label}'),
        onTap: onTap,
        radius: 36,
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconTheme(
                data: IconThemeData(color: color, size: 24),
                child: destination.iconWith(selected: selected),
              ),
              const SizedBox(height: 4),
              Text(
                destination.label,
                maxLines: 1,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: color,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
