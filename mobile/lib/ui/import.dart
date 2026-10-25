import 'package:flutter/material.dart';
import '../bridge/pick.dart';

/// What the person wants to bring in: several videos, several photos, both, or any files.
Future<Pick?> choosePick(BuildContext context) => showModalBottomSheet<Pick>(
  context: context,
  useSafeArea: true,
  isScrollControlled: true,
  builder: (context) => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(12, 16, 12, 24),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          child: Text(
            'What are you bringing in?',
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        for (final (kind, icon, title, subtitle) in const [
          (
            Pick.videos,
            Icons.video_library_outlined,
            'Videos',
            'One or several',
          ),
          (
            Pick.photos,
            Icons.photo_library_outlined,
            'Photos',
            'One or several',
          ),
          (
            Pick.media,
            Icons.perm_media_outlined,
            'Photos and videos',
            'Any mix from your gallery',
          ),
          (
            Pick.files,
            Icons.folder_open_outlined,
            'Files',
            'Music, subtitles, fonts, documents…',
          ),
        ])
          ListTile(
            key: ValueKey('pick-${kind.name}'),
            leading: Icon(icon),
            title: Text(title),
            subtitle: Text(subtitle),
            onTap: () => Navigator.pop(context, kind),
          ),
      ],
    ),
  ),
);

/// The shape of a video made from scratch (from an idea, or from photos).
Future<String?> chooseFormat(BuildContext context) => showDialog<String>(
  context: context,
  builder: (context) => SimpleDialog(
    title: const Text('Choose a format'),
    children: [
      for (final item in ['16:9', '9:16', '1:1'])
        SimpleDialogOption(
          onPressed: () => Navigator.pop(context, item),
          child: Padding(padding: const EdgeInsets.all(12), child: Text(item)),
        ),
    ],
  ),
);
