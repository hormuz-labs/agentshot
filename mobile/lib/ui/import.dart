import 'package:flutter/material.dart';
import '../bridge/pick.dart';
import 'design.dart';

/// What the person wants to bring in: several videos, several photos, both, or any files.
Future<Pick?> choosePick(BuildContext context) => showSheet<Pick>(
  context: context,
  useSafeArea: true,
  isScrollControlled: true,
  builder: (context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.xxl),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Space.xs, 0, Space.xs, Space.lg),
          child: Text(
            'Import',
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        for (final (kind, icon, title) in const [
          (Pick.videos, Icons.video_library_rounded, 'Videos'),
          (Pick.photos, Icons.photo_library_rounded, 'Photos'),
          (Pick.media, Icons.perm_media_rounded, 'Photos and videos'),
          (Pick.files, Icons.folder_open_rounded, 'Files'),
        ])
          OptionRow(
            key: ValueKey('pick-${kind.name}'),
            icon: icon,
            title: title,
            onTap: () => Navigator.pop(context, kind),
          ),
      ],
    ),
  ),
);

/// A choice in a sheet: its icon on a tile, what it is, a line on what it does.
class OptionRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  const OptionRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    return ListTile(
      enabled: onTap != null,
      contentPadding: const EdgeInsets.symmetric(horizontal: Space.xs, vertical: 2),
      leading: Container(
        width: 44,
        height: 44,
        decoration: ShapeDecoration(color: studio.surface2, shape: smooth(Radii.control)),
        child: Icon(icon, size: 22, color: onTap == null ? studio.text3 : studio.accent),
      ),
      title: Text(title, style: Theme.of(context).textTheme.bodyLarge),
      subtitle: subtitle == null ? null : Text(subtitle!),
      onTap: onTap,
    );
  }
}

/// The shapes a video made from scratch can take.
const formats = [
  ('16:9', 'Landscape', 16 / 9),
  ('9:16', 'Vertical', 9 / 16),
  ('1:1', 'Square', 1.0),
];

/// The three shapes as tiles, each drawing its frame; the chosen one lit.
class FormatPicker extends StatelessWidget {
  final String? value;
  final ValueChanged<String> onChanged;
  const FormatPicker({super.key, required this.value, required this.onChanged});
  @override
  Widget build(BuildContext context) {
    final studio = Studio.of(context);
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        for (final (i, (id, name, ratio)) in formats.indexed) ...[
          if (i > 0) const SizedBox(width: Space.sm),
          Expanded(
            child: Semantics(
              button: true,
              selected: value == id,
              child: Material(
                color: value == id ? studio.accentSoft : studio.surface2,
                shape: smooth(
                  Radii.control,
                  side: BorderSide(
                    color: value == id ? studio.accent : studio.hairline,
                    width: value == id ? 1.5 : 1,
                  ),
                ),
                child: InkWell(
                  customBorder: smooth(Radii.control),
                  onTap: () => onChanged(id),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.md),
                    child: Column(
                      children: [
                        SizedBox(
                          height: 40,
                          child: Center(
                            child: AspectRatio(
                              aspectRatio: ratio,
                              child: DecoratedBox(
                                decoration: ShapeDecoration(
                                  shape: smooth(
                                    4,
                                    side: BorderSide(
                                      color: value == id ? studio.accent : studio.text2,
                                      width: 1.6,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: Space.sm),
                        Semantics(label: name, child: Text(id, style: text.labelMedium)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// The shape of a video made from scratch (from photos).
Future<String?> chooseFormat(BuildContext context) => showSheet<String>(
  context: context,
  useSafeArea: true,
  isScrollControlled: true,
  builder: (context) => Padding(
    padding: const EdgeInsets.fromLTRB(Space.page, 0, Space.page, Space.xxl),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Format', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: Space.lg),
        FormatPicker(value: null, onChanged: (id) => Navigator.pop(context, id)),
      ],
    ),
  ),
);

/// What to make, in the person's words, and its shape (none for a walkthrough, filmed at the site's own): the sheet
/// behind "Start from an idea", "Film a walkthrough" and an example's "Use this example".
Future<(String, String)?> askToCreate(
  BuildContext context, {
  bool walkthrough = false,
  String? basedOn,
}) => showSheet<(String, String)>(
  context: context,
  useSafeArea: true,
  isScrollControlled: true,
  builder: (context) => _CreateSheet(walkthrough: walkthrough, basedOn: basedOn),
);

class _CreateSheet extends StatefulWidget {
  final bool walkthrough;
  final String? basedOn;
  const _CreateSheet({required this.walkthrough, this.basedOn});
  @override
  State<_CreateSheet> createState() => _CreateSheetState();
}

class _CreateSheetState extends State<_CreateSheet> {
  final idea = TextEditingController();
  String aspect = '16:9';
  @override
  void dispose() {
    idea.dispose();
    super.dispose();
  }

  void create() {
    final words = idea.text.trim();
    if (words.isEmpty) return;
    Navigator.pop(context, (words, widget.walkthrough ? '16:9' : aspect));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final studio = Studio.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        key: const ValueKey('create-sheet'),
        padding: const EdgeInsets.fromLTRB(Space.page, 0, Space.page, Space.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.walkthrough ? 'Walkthrough' : 'New video', style: text.titleLarge),
            if (widget.basedOn case final example?) ...[
              const SizedBox(height: Space.md),
              Align(
                alignment: Alignment.centerLeft,
                child: StatusPill(example, color: studio.accent),
              ),
            ],
            const SizedBox(height: Space.lg),
            TextField(
              key: const ValueKey('create-idea'),
              controller: idea,
              autofocus: true,
              minLines: 3,
              maxLines: 6,
              textCapitalization: TextCapitalization.sentences,
              keyboardType: widget.walkthrough ? TextInputType.url : TextInputType.multiline,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: widget.walkthrough ? 'Site address and what to show' : 'Describe your video…',
              ),
            ),
            if (!widget.walkthrough) ...[
              const SizedBox(height: Space.xl),
              FormatPicker(value: aspect, onChanged: (v) => setState(() => aspect = v)),
            ],
            const SizedBox(height: Space.xl),
            SparkButton(
              expand: true,
              icon: Icons.auto_awesome,
              label: const Text('Create'),
              onPressed: idea.text.trim().isEmpty ? null : create,
            ),
          ],
        ),
      ),
    );
  }
}
