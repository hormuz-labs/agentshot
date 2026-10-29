import 'package:flutter/material.dart';
import '../bridge/account.dart';
import '../bridge/client.dart';
import '../bridge/pick.dart';
import '../bridge/store.dart';
import 'common.dart';
import 'design.dart';
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
    this.initialSection = 0,
  });

  /// The tab it opens on.
  final int initialSection;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late int section = widget.initialSection;
  String search = '';
  bool working = false;
  double? progress;
  String? status;

  /// A file that didn't come in (which, and why), until dismissed or tried again.
  (String, Object)? importError;

  /// What was being brought in, for Try again.
  (List<Picked>, String?)? _lastImport;
  BridgeStore get store => widget.store;
  Future<void> open(Json project) async {
    final dir = project['dir'] as String;
    // opened here before: it opens at once on what the phone kept, and the computer's version follows
    if (await store.showSaved(dir)) {
      store.open(dir).ignore();
    } else {
      await store.open(dir);
    }
    if (mounted) {
      await Navigator.push(
        context,
        MaterialPageRoute<void>(builder: (_) => ProjectScreen(store: store)),
      );
    }
    // back from it: what was there has been seen; the list freshens behind what's showing
    store.markSeen(project['dir'] as String);
    store.refresh().ignore();
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
    await _bringIn(ordered, aspect);
  }

  /// Uploads [ordered] (into a new project, made from scratch first when [aspect] is given) and opens it. A file that
  /// doesn't come in is said where the person is (which, and why), with Try again.
  Future<void> _bringIn(List<Picked> ordered, String? aspect) async {
    _lastImport = (ordered, aspect);
    setState(() {
      working = true;
      importError = null;
    });
    var current = ordered.first.name;
    try {
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
        current = file.name;
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
      _lastImport = null;
      if (project != null) await open(project);
    } catch (e) {
      if (mounted) setState(() => importError = (current, e));
    }
    if (mounted) {
      setState(() {
        working = false;
        progress = null;
        status = null;
      });
    }
  }

  Future<void> createMotion({Json? example, bool walkthrough = false}) async {
    final asked = await askToCreate(
      context,
      walkthrough: walkthrough,
      basedOn: example?['title'] as String?,
    );
    if (asked == null || !mounted) return;
    final (title, aspect) = asked;
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
      final studio = Studio.of(context);
      return Scaffold(
        body: SafeArea(
          bottom: !narrow,
          child: Column(
            children: [
              if (working)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.page,
                    Space.sm,
                    Space.page,
                    0,
                  ),
                  child: Panel(
                    padding: const EdgeInsets.all(Space.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              Icons.cloud_upload_rounded,
                              size: 18,
                              color: studio.accent,
                            ),
                            const SizedBox(width: Space.sm),
                            Expanded(
                              child: Text(
                                status ?? 'Getting things ready…',
                                key: status == null
                                    ? null
                                    : const ValueKey('upload-status'),
                                style: Theme.of(context).textTheme.labelMedium,
                              ),
                            ),
                            if (progress != null)
                              Text(
                                '${(progress! * 100).round()}%',
                                style: Theme.of(context).textTheme.labelMedium
                                    ?.copyWith(
                                      color: studio.text2,
                                      fontFeatures: tabular,
                                    ),
                              ),
                          ],
                        ),
                        const SizedBox(height: Space.sm),
                        LinearProgressIndicator(value: progress),
                      ],
                    ),
                  ),
                ),
              if (importError case (final name, final error))
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.lg,
                    Space.sm,
                    Space.lg,
                    0,
                  ),
                  child: ProblemCard(
                    title: 'Couldn’t add $name',
                    error: error,
                    onRetry: _lastImport == null
                        ? null
                        : () => _bringIn(_lastImport!.$1, _lastImport!.$2),
                    onDismiss: () => setState(() => importError = null),
                  ),
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
                                  vertical: Space.md,
                                ),
                                child: TileButton(
                                  icon: Icons.add_rounded,
                                  tooltip: 'Start something new',
                                  accent: true,
                                  onPressed: startSheet,
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
                        VerticalDivider(width: 1, color: studio.hairline),
                        Expanded(child: views[section]),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: narrow
            ? TabBarFlat(
                destinations: destinations,
                selected: section,
                onSelect: (i) => setState(() => section = i),
                onCreate: startSheet,
              )
            : null,
      );
    },
  );

  /// The ways to start something, behind the + (in the header, or atop the side rail).
  List<StartOption> get starts {
    final ready = !working && store.connected;
    return [
      StartOption(
        Icons.auto_awesome,
        'Describe it',
        'Say what to make; the agent makes it',
        ready ? createMotion : null,
      ),
      StartOption(
        Icons.add_photo_alternate_rounded,
        'Import',
        'Videos and photos from this phone',
        ready ? () => import() : null,
      ),
      StartOption(
        Icons.videocam_rounded,
        'Record',
        'Film something now',
        ready ? () => import(camera: true) : null,
      ),
      StartOption(
        Icons.language_rounded,
        'Walkthrough',
        'A guided tour of a website',
        ready ? () => createMotion(walkthrough: true) : null,
      ),
    ];
  }

  /// The +: what to start, from any tab.
  void startSheet() => showSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    // the options turn on as soon as the computer is connected, sheet open or not
    builder: (sheet) => ListenableBuilder(
      listenable: store,
      builder: (sheet, _) => SingleChildScrollView(
        key: const ValueKey('start-sheet'),
        padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.xs,
                0,
                Space.xs,
                Space.md,
              ),
              child: Text(
                'Create',
                style: Theme.of(sheet).textTheme.titleLarge,
              ),
            ),
            for (final option in starts)
              OptionRow(
                icon: option.icon,
                title: option.title,
                subtitle: option.hint,
                onTap: option.onTap == null
                    ? null
                    : () {
                        Navigator.pop(sheet);
                        option.onTap!();
                      },
              ),
          ],
        ),
      ),
    ),
  );

  /// Where the projects are, in a few words, with a dot: connected (green), on the way (amber), out of reach.
  Widget connection() {
    final studio = Studio.of(context);
    final name = store.onCloud
        ? 'AgentShot Cloud'
        : (store.client.connection?.name ?? 'your computer');
    final (color, words) = store.connected
        ? (studio.success, 'On $name')
        : store.projects.isNotEmpty
        ? (studio.accent, 'Reconnecting · showing what was here last')
        : (
            studio.accent,
            store.connectionError ?? 'Connecting to your computer…',
          );
    return Row(
      key: const ValueKey('connection'),
      children: [
        Icon(Icons.circle, size: 8, color: color),
        const SizedBox(width: Space.sm),
        Flexible(
          child: Text(
            words,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(color: studio.text2),
          ),
        ),
        if (!store.connected) ...[
          const SizedBox(width: Space.xs),
          // never stuck waiting: another computer, or the same one again
          TextButton(
            onPressed: () => guard(context, widget.onDisconnect),
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 36),
              padding: const EdgeInsets.symmetric(horizontal: Space.sm),
              textStyle: Theme.of(context).textTheme.labelMedium,
            ),
            child: const Text('Change computer'),
          ),
        ],
      ],
    );
  }

  /// A "New film" tile after the projects, while there are few and no search.
  bool newTile(List<Json> results) =>
      search.isEmpty && results.isNotEmpty && results.length < 6;

  /// Search, for when there are enough projects to need it: opened from its icon.
  bool searching = false;

  Widget projects() {
    final results = store.projects
        .where(
          (p) => store.nameOf(p).toLowerCase().contains(search.toLowerCase()),
        )
        .toList();
    final theme = Theme.of(context);
    final studio = Studio.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final columns = (width / 230).floor().clamp(2, 5);
    return RefreshIndicator(
      onRefresh: store.refresh,
      color: studio.accent,
      child: CustomScrollView(
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              Space.page,
              Space.xxl,
              Space.page,
              0,
            ),
            sliver: SliverList.list(
              children: [
                // the page's name, and search (rarely needed) beside it
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Projects',
                        style: theme.textTheme.displaySmall,
                      ),
                    ),
                    if (store.projects.isNotEmpty)
                      IconButton(
                        tooltip: searching ? 'Close search' : 'Search projects',
                        onPressed: () => setState(() {
                          searching = !searching;
                          if (!searching) search = '';
                        }),
                        icon: Icon(
                          searching
                              ? Icons.close_rounded
                              : Icons.search_rounded,
                          color: studio.text2,
                        ),
                      ),
                  ],
                ),
                // where these projects are (AgentShot Cloud, or which computer), and when something's wrong
                const SizedBox(height: Space.xs),
                connection(),
                if (store.consents.isNotEmpty) ...[
                  const SizedBox(height: Space.md),
                  Panel(
                    key: const ValueKey('needs-you'),
                    highlight: true,
                    padding: const EdgeInsets.all(Space.md),
                    onTap: () => setState(() => section = 2),
                    child: Row(
                      children: [
                        Icon(
                          Icons.front_hand_rounded,
                          color: studio.accent,
                          size: 20,
                        ),
                        const SizedBox(width: Space.md),
                        Expanded(
                          child: Text(
                            store.consents.length == 1
                                ? '${store.consents.first['title']}'
                                : '${store.consents.length} questions are waiting for you',
                            style: theme.textTheme.titleSmall,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Icon(Icons.chevron_right_rounded, color: studio.text3),
                      ],
                    ),
                  ),
                ],
                if (searching) ...[
                  const SizedBox(height: Space.xs),
                  TextField(
                    key: const ValueKey('search-projects'),
                    autofocus: true,
                    onChanged: (value) => setState(() => search = value),
                    decoration: InputDecoration(
                      hintText: 'Search projects',
                      prefixIcon: Icon(
                        Icons.search_rounded,
                        color: studio.text3,
                      ),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 13),
                    ),
                  ),
                ],
                const SizedBox(height: Space.lg),
                if (results.isEmpty)
                  EmptyMessage(
                    Icons.video_library_outlined,
                    search.isEmpty ? 'No projects yet' : 'No matches',
                    search.isEmpty ? 'Tap + to make one.' : '',
                    art: search.isEmpty ? const Mascot(size: 88) : null,
                  ),
              ],
            ),
          ),
          SliverPadding(
            // room at the end
            padding: const EdgeInsets.fromLTRB(
              Space.page,
              0,
              Space.page,
              Space.xxl,
            ),
            sliver: SliverGrid.builder(
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: Space.md,
                mainAxisSpacing: Space.xl,
                // the poster (16:10), then two lines of title and one of where/when, at any text size
                mainAxisExtent:
                    ((width - Space.page * 2 - Space.md * (columns - 1)) /
                            columns) *
                        10 /
                        16 +
                    MediaQuery.textScalerOf(context).scale(62) +
                    Space.md,
              ),
              // a few projects leave room: the way to the next one fills it
              itemCount: results.length + (newTile(results) ? 1 : 0),
              itemBuilder: (context, i) => i == results.length
                  ? NewFilmTile(onTap: startSheet)
                  : ProjectCard(
                      project: results[i],
                      store: store,
                      onOpen: () => guard(context, () => open(results[i])),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget gallery() => CustomScrollView(
    slivers: [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          Space.page,
          Space.xxl,
          Space.page,
          120,
        ),
        sliver: SliverList.list(
          children: [
            Text('Examples', style: Theme.of(context).textTheme.displaySmall),
            const SizedBox(height: Space.lg),
            AsyncPanel(
              load: store.examples,
              placeholder: const GalleryPlaceholder(),
              builder: (data, reload) => GalleryList(
                examples: objects(data),
                store: store,
                onUse: (e) => createMotion(example: e),
              ),
            ),
          ],
        ),
      ),
    ],
  );

  Widget activity() {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Space.page,
        Space.xxl,
        Space.page,
        120,
      ),
      children: [
        Text('Activity', style: text.displaySmall),
        const SizedBox(height: Space.lg),
        if (store.consents.isNotEmpty) ...[
          ConsentCards(store: store),
          const SizedBox(height: Space.md),
        ],
        if (store.jobs.isEmpty && store.consents.isEmpty)
          const EmptyMessage(
            Icons.check_circle_outline,
            'All quiet',
            'Renders, exports and anything that needs your OK show up here.',
          ),
        for (final job in store.jobs.reversed)
          Padding(
            padding: const EdgeInsets.only(bottom: Space.sm),
            child: Panel(
              padding: const EdgeInsets.all(Space.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: ShapeDecoration(
                      color: job['status'] == 'running'
                          ? studio.accentSoft
                          : job['status'] == 'done'
                          ? studio.success.withValues(alpha: .14)
                          : studio.surface2,
                      shape: smooth(12),
                    ),
                    child: Icon(
                      job['status'] == 'running'
                          ? Icons.autorenew_rounded
                          : job['status'] == 'done'
                          ? Icons.check_rounded
                          : Icons.error_outline_rounded,
                      size: 20,
                      color: job['status'] == 'running'
                          ? studio.accent
                          : job['status'] == 'done'
                          ? studio.success
                          : studio.danger,
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${job['status'] == 'done' ? job['doneTitle'] ?? job['title'] : job['title']}',
                          style: text.titleSmall,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${job['detail'] ?? job['status']}',
                          style: text.bodySmall,
                        ),
                        if (job['status'] == 'running')
                          Padding(
                            padding: const EdgeInsets.only(top: Space.sm),
                            child: LinearProgressIndicator(
                              value: (job['progress'] as num?)
                                  ?.toDouble()
                                  .clamp(0, 1),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// A project in the grid: its poster (the film's opening frame), what it's up to on it, its title and when it was
/// last opened. Held: what can be done with it (open, move to Trash).
class ProjectCard extends StatelessWidget {
  final Json project;
  final BridgeStore store;
  final VoidCallback onOpen;
  const ProjectCard({
    super.key,
    required this.project,
    required this.store,
    required this.onOpen,
  });

  String get dir => '${project['dir']}';

  Future<void> trash(BuildContext context) => guard(context, () async {
    if (await confirm(
      context,
      'Delete project?',
      'Move this project and all of its files to the Trash on your computer?',
      action: 'Move to Trash',
    )) {
      await store.client.call('project:delete', [dir]);
      await store.refresh();
    }
  });

  void actions(BuildContext context) => showSheet<void>(
    context: context,
    useSafeArea: true,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.xs,
                0,
                Space.xs,
                Space.md,
              ),
              child: Text(
                store.nameOf(project),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            OptionRow(
              icon: Icons.open_in_new_rounded,
              title: 'Open',
              onTap: () {
                Navigator.pop(sheet);
                onOpen();
              },
            ),
            OptionRow(
              icon: Icons.delete_outline_rounded,
              title: 'Move to Trash',
              onTap: () {
                Navigator.pop(sheet);
                trash(context);
              },
            ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    final status = store.statusOf(dir);
    final urgent = status == 'Needs your OK';
    final opened = project['openedAt'] as num?;
    return Semantics(
      button: true,
      child: GestureDetector(
        key: ValueKey('project-$dir'),
        behavior: HitTestBehavior.opaque,
        onTap: onOpen,
        // held: what can be done with it
        onLongPress: () => actions(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 16 / 10,
              child: ClipRSuperellipse(
                borderRadius: BorderRadius.circular(16),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Poster(
                      store: store,
                      dir: dir,
                      file: project['thumb'] == null ? null : 'thumb.jpg',
                      seed: '${project['title']}',
                    ),
                    // a fine inner edge, so a dark frame doesn't melt into the page
                    DecoratedBox(
                      decoration: ShapeDecoration(
                        shape: smooth(
                          16,
                          side: BorderSide(color: studio.hairline),
                        ),
                      ),
                    ),
                    if (status != null)
                      Positioned(
                        left: Space.sm,
                        top: Space.sm,
                        right: 48,
                        child: Align(
                          alignment: Alignment.topLeft,
                          child: StatusPill(
                            switch (status) {
                              'Needs your OK' => 'Needs you',
                              'Working…' => 'Working',
                              'New reply' => 'New',
                              _ => status,
                            },
                            onMedia: true,
                            live: status == 'Working…',
                            color: urgent ? studio.danger : studio.accent,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: Space.sm + 2),
            Text(
              store.nameOf(project),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: text.titleSmall,
            ),
            const SizedBox(height: 2),
            if (opened != null)
              Text(switch (ago(opened)) {
                'now' => 'Opened just now',
                final at => 'Opened $at',
              }, style: text.bodySmall?.copyWith(color: studio.text3)),
          ],
        ),
      ),
    );
  }
}

/// How long ago, in the fewest words: "now", "5m", "3h", "2d", "Mar 4".
String ago(num millis) {
  final then = DateTime.fromMillisecondsSinceEpoch(millis.toInt());
  final d = DateTime.now().difference(then);
  if (d.inMinutes < 1) return 'now';
  if (d.inHours < 1) return '${d.inMinutes}m ago';
  if (d.inDays < 1) return '${d.inHours}h ago';
  if (d.inDays < 7) return '${d.inDays}d ago';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${months[then.month - 1]} ${then.day}';
}

/// A picture of a project file (a poster, a frame) as the phone keeps it; until it comes (or when there is none), a
/// warm gradient of the project's own, so the grid never shows grey boxes.
class Poster extends StatefulWidget {
  final BridgeStore store;
  final String dir;

  /// The project file to show ('thumb.jpg', a gallery poster URL with [gallery]); none: the gradient alone.
  final String? file;
  final bool gallery;

  /// What the gradient is made from (the title), so each project keeps its own colours.
  final String seed;
  const Poster({
    super.key,
    required this.store,
    required this.dir,
    required this.file,
    required this.seed,
    this.gallery = false,
  });
  @override
  State<Poster> createState() => _PosterState();
}

class _PosterState extends State<Poster> {
  Future<Uri>? uri;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(Poster old) {
    super.didUpdateWidget(old);
    if (old.file != widget.file || old.dir != widget.dir) _load();
  }

  void _load() {
    final file = widget.file;
    // a picture that can't come (offline, no such file) shows the gradient: nothing to report
    uri = file == null
        ? null
        : ((widget.gallery
                ? widget.store.client.gallery(file)
                : widget.store.client.media(widget.dir, file))
            ..ignore());
  }

  @override
  Widget build(BuildContext context) {
    final placeholder = _Placeholder(seed: widget.seed);
    if (uri == null) return placeholder;
    return FutureBuilder<Uri>(
      future: uri,
      builder: (context, snapshot) {
        final at = snapshot.data;
        if (at == null) return placeholder;
        return Image.network(
          at.toString(),
          fit: BoxFit.cover,
          gaplessPlayback: true,
          errorBuilder: (_, _, _) => placeholder,
          frameBuilder: (context, child, frame, synchronous) => synchronous
              ? child
              : Stack(
                  fit: StackFit.expand,
                  children: [
                    placeholder,
                    AnimatedOpacity(
                      opacity: frame == null ? 0 : 1,
                      duration: Motion.normal,
                      curve: Motion.curve,
                      child: child,
                    ),
                  ],
                ),
        );
      },
    );
  }
}

class _Placeholder extends StatelessWidget {
  final String seed;
  const _Placeholder({required this.seed});
  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final dark = Theme.of(context).brightness == Brightness.dark;
    // a hue of the project's own, within warm-to-cool so it sits with the amber
    final hue =
        (seed.codeUnits.fold<int>(7, (h, c) => (h * 31 + c) & 0xffff) % 220) +
        10.0;
    final a = HSLColor.fromAHSL(1, hue, .38, dark ? .22 : .78).toColor();
    final b = HSLColor.fromAHSL(
      1,
      (hue + 40) % 360,
      .32,
      dark ? .12 : .88,
    ).toColor();
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [a, b],
        ),
      ),
      child: Center(
        child: Icon(
          Icons.movie_creation_outlined,
          size: 28,
          color: (dark ? Colors.white : studio.text2).withValues(
            alpha: dark ? .35 : .6,
          ),
        ),
      ),
    );
  }
}

/// The tab bar, as Instagram has it: flat along the bottom, icons only, + in the middle to make something.
class TabBarFlat extends StatelessWidget {
  final List<Destination> destinations;
  final int selected;
  final ValueChanged<int> onSelect;
  final VoidCallback onCreate;
  const TabBarFlat({
    super.key,
    required this.destinations,
    required this.selected,
    required this.onSelect,
    required this.onCreate,
  });
  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final items = [
      for (final (i, d) in destinations.indexed)
        Expanded(
          child: NavItem(d, selected: selected == i, onTap: () => onSelect(i)),
        ),
    ];
    return DecoratedBox(
      decoration: BoxDecoration(
        color: studio.canvas,
        border: Border(top: BorderSide(color: studio.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 52,
          child: Row(
            children: [
              ...items.take(2),
              Expanded(
                child: IconButton(
                  tooltip: 'Start something new',
                  onPressed: onCreate,
                  icon: const Icon(Icons.add_box_outlined, size: 27),
                ),
              ),
              ...items.skip(2),
            ],
          ),
        ),
      ),
    );
  }
}

/// What AgentShot on the computer asks before doing it (a download, an install): the same question the desktop shows,
/// answered from here. In a project's conversation only that project's (and ones for no project in particular), at
/// the end where the agent waits; in Activity all of them.
class ConsentCards extends StatelessWidget {
  final BridgeStore store;

  /// Only this project's questions (and general ones), for its conversation.
  final String? dir;
  const ConsentCards({super.key, required this.store, this.dir});
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final asked = [
      for (final item in store.consents)
        if (dir == null || item['project'] == null || item['project'] == dir)
          item,
    ];
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final item in asked)
          Padding(
            key: ValueKey('consent-${item['id']}'),
            padding: const EdgeInsets.only(bottom: Space.md),
            child: Panel(
              highlight: true,
              padding: const EdgeInsets.fromLTRB(
                Space.lg,
                Space.lg,
                Space.lg,
                Space.md,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: ShapeDecoration(
                          color: studio.accentSoft,
                          shape: smooth(11),
                        ),
                        child: Icon(
                          item['sizeMB'] != null
                              ? Icons.download_rounded
                              : Icons.help_outline_rounded,
                          size: 20,
                          color: studio.accent,
                        ),
                      ),
                      const SizedBox(width: Space.md),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 7),
                          child: Text(
                            '${item['title']}',
                            style: text.titleMedium,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Space.sm),
                  Text(
                    '${item['body']}',
                    style: text.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: Space.md),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => guard(context, () async {
                            await store.client.call('consent:answer', [
                              item['id'],
                              false,
                            ]);
                          }),
                          child: const Text('Not now'),
                        ),
                      ),
                      const SizedBox(width: Space.sm),
                      Expanded(
                        child: FilledButton(
                          onPressed: () => guard(context, () async {
                            await store.client.call('consent:answer', [
                              item['id'],
                              true,
                            ]);
                          }),
                          child: Text(
                            '${item['confirm']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
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

  /// An example up close: its film playing, who made it and the prompt behind it, and a way to start from it.
  void show(Json e) {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    sheet(
      context,
      '${e['title']}',
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRSuperellipse(
            borderRadius: BorderRadius.circular(Radii.card),
            child: ColoredBox(
              color: studio.film,
              child: RemotePlayer(
                key: ValueKey(e['id']),
                uri: () => widget.store.client.gallery(e['video'] as String),
              ),
            ),
          ),
          const SizedBox(height: Space.lg),
          Row(
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: studio.surface3,
                child: Text(
                  '${e['creator']?['name'] ?? e['creator']?['handle'] ?? '?'}'
                      .characters
                      .first
                      .toUpperCase(),
                  style: text.labelMedium,
                ),
              ),
              const SizedBox(width: Space.sm),
              Expanded(
                child: Text(
                  'By ${e['creator']?['name'] ?? ''}',
                  style: text.titleSmall,
                ),
              ),
            ],
          ),
          if ('${e['source'] ?? ''}'.isNotEmpty || e['post'] != null) ...[
            const SizedBox(height: Space.sm),
            SelectableText('${e['source'] ?? ''}', style: text.bodySmall),
            if (e['post'] != null)
              SelectableText('${e['post']}', style: text.bodySmall),
          ],
          const SizedBox(height: Space.lg),
          Panel(
            color: studio.surface2,
            radius: Radii.control,
            padding: const EdgeInsets.all(Space.md),
            child: SelectableText(
              '${e['prompt'] ?? e['skill'] ?? ''}',
              style: text.bodyMedium,
            ),
          ),
          const SizedBox(height: Space.xl),
          SparkButton(
            expand: true,
            icon: Icons.auto_awesome,
            label: const Text('Use this example'),
            onPressed: () {
              Navigator.pop(context);
              widget.onUse(e);
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tags = <String>{
      'All',
      for (final e in widget.examples)
        for (final t in objects(e['tags'])) '${t['name']}',
    };
    final items = widget.examples
        .where(
          (e) =>
              '${e['title']} ${e['prompt']}'.toLowerCase().contains(
                query.toLowerCase(),
              ) &&
              (tag == 'All' || objects(e['tags']).any((t) => t['name'] == tag)),
        )
        .toList();
    return LayoutBuilder(
      builder: (context, box) {
        final columns = (box.maxWidth / 220).floor().clamp(2, 5);
        final cell = (box.maxWidth - Space.md * (columns - 1)) / columns;
        return list(items, tags, columns, cell);
      },
    );
  }

  Widget list(List<Json> items, Set<String> tags, int columns, double cell) {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const ValueKey('search-examples'),
          decoration: InputDecoration(
            hintText: 'Search examples',
            prefixIcon: Icon(Icons.search_rounded, color: studio.text3),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(vertical: 13),
          ),
          onChanged: (v) => setState(() => query = v),
        ),
        const SizedBox(height: Space.md),
        // the categories, side by side, to scroll through
        SingleChildScrollView(
          key: const ValueKey('example-tags'),
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final t in tags)
                Padding(
                  padding: const EdgeInsets.only(right: Space.sm),
                  child: ChoiceChip(
                    label: Text(t),
                    selected: tag == t,
                    onSelected: (_) => setState(() => tag = t),
                    labelStyle: text.labelMedium?.copyWith(
                      color: tag == t ? studio.accent : null,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: Space.lg),
        if (items.isEmpty)
          const EmptyMessage(
            Icons.search_off_rounded,
            'No examples match',
            'Try another word or category.',
          ),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: Space.md,
            mainAxisSpacing: Space.xl,
            // every poster the same shape (4:5), then two lines of title and one of who made it
            mainAxisExtent:
                cell * 5 / 4 +
                Space.sm +
                MediaQuery.textScalerOf(context).scale(62),
          ),
          itemBuilder: (context, i) {
            final e = items[i];
            return Semantics(
              button: true,
              child: GestureDetector(
                key: ValueKey('example-${e['id']}'),
                behavior: HitTestBehavior.opaque,
                onTap: () => show(e),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AspectRatio(
                      aspectRatio: 4 / 5,
                      child: ClipRSuperellipse(
                        borderRadius: BorderRadius.circular(16),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Poster(
                              store: widget.store,
                              dir: '',
                              file: e['poster'] as String?,
                              gallery: true,
                              seed: '${e['title']}',
                            ),
                            Positioned(
                              left: Space.sm,
                              bottom: Space.sm,
                              child: Container(
                                width: 30,
                                height: 30,
                                decoration: ShapeDecoration(
                                  color: Colors.black.withValues(alpha: .55),
                                  shape: const CircleBorder(),
                                ),
                                child: const Icon(
                                  Icons.play_arrow_rounded,
                                  size: 20,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: Space.sm),
                    Text(
                      '${e['title']}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleSmall,
                    ),
                    Text(
                      'By ${e['creator']?['name'] ?? e['creator']?['handle'] ?? ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodySmall?.copyWith(color: studio.text3),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

/// A way to start something, in the + sheet.
class StartOption {
  final IconData icon;
  final String title;
  final String? hint;
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
    final color = selected
        ? Theme.of(context).colorScheme.onSurface
        : Studio.of(context).text2;
    return Semantics(
      button: true,
      selected: selected,
      label: destination.label,
      excludeSemantics: true,
      child: InkResponse(
        key: ValueKey('nav-${destination.label}'),
        onTap: onTap,
        radius: 26,
        child: Center(
          child: IconTheme(
            data: IconThemeData(color: color, size: 26),
            child: destination.iconWith(selected: selected),
          ),
        ),
      ),
    );
  }
}

/// The way to the next film, beside a few projects: a dashed tile the size of a project's poster.
class NewFilmTile extends StatelessWidget {
  final VoidCallback onTap;
  const NewFilmTile({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      label: 'New film',
      child: GestureDetector(
        key: const ValueKey('new-film'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 16 / 10,
              child: DecoratedBox(
                decoration: ShapeDecoration(
                  color: studio.surface2,
                  shape: smooth(16, side: BorderSide(color: studio.hairline)),
                ),
                child: Center(
                  child: Icon(
                    Icons.add_rounded,
                    size: 32,
                    color: studio.accent,
                  ),
                ),
              ),
            ),
            const SizedBox(height: Space.sm + 2),
            Text('New film', style: text.titleSmall),
            const SizedBox(height: 2),
            Text(
              'Describe, import or record',
              style: text.bodySmall?.copyWith(color: studio.text3),
            ),
          ],
        ),
      ),
    );
  }
}

/// Where the examples will be, while they come: their cards' shapes, softly pulsing.
class GalleryPlaceholder extends StatefulWidget {
  const GalleryPlaceholder({super.key});
  @override
  State<GalleryPlaceholder> createState() => _GalleryPlaceholderState();
}

class _GalleryPlaceholderState extends State<GalleryPlaceholder>
    with SingleTickerProviderStateMixin {
  late final pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    Widget block(double height, {double? width}) => Container(
      height: height,
      width: width,
      decoration: ShapeDecoration(color: studio.surface2, shape: smooth(14)),
    );
    return FadeTransition(
      opacity: Tween<double>(begin: .45, end: 1).animate(pulse),
      child: Column(
        key: const ValueKey('gallery-placeholder'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          block(48),
          const SizedBox(height: Space.md),
          Row(
            children: [
              for (final w in [56.0, 96.0, 104.0]) ...[
                block(36, width: w),
                const SizedBox(width: Space.sm),
              ],
            ],
          ),
          const SizedBox(height: Space.md),
          for (var row = 0; row < 2; row++) ...[
            Row(
              children: [
                Expanded(child: block(240)),
                const SizedBox(width: Space.md),
                Expanded(child: block(240)),
              ],
            ),
            const SizedBox(height: Space.md),
          ],
        ],
      ),
    );
  }
}
