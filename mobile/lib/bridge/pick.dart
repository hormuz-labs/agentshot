// What the person brings in from the phone: one or several videos, one or several photos, both, or any files.
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

enum Pick { videos, photos, media, files }

class Picked {
  final File file;
  final String name;
  Picked(this.file, this.name);

  String get _ext =>
      name.contains('.') ? name.split('.').last.toLowerCase() : '';
  bool get isVideo =>
      const {'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp'}.contains(_ext);
  bool get isPhoto => const {
    'jpg',
    'jpeg',
    'png',
    'heic',
    'heif',
    'webp',
    'gif',
  }.contains(_ext);
}

class Picker {
  /// The end-to-end tests hand over the files here: the system's photo picker can't be scripted.
  @visibleForTesting
  static Future<List<Picked>> Function(Pick kind)? override;

  static Future<List<Picked>> pick(Pick kind) async {
    if (override != null) return override!(kind);
    final images = ImagePicker();
    final List<XFile> media = switch (kind) {
      Pick.videos => await images.pickMultiVideo(),
      Pick.photos => await images.pickMultiImage(),
      Pick.media => await images.pickMultipleMedia(),
      Pick.files => [
        for (final f in await FilePicker.pickFiles())
          if (f.path != null) XFile(f.path!, name: f.name),
      ],
    };
    return [for (final f in media) Picked(File(f.path), f.name)];
  }

  /// The end-to-end tests hand over the recording here: the camera can't be scripted.
  @visibleForTesting
  static Future<Picked?> Function()? recordOverride;

  /// A video recorded with the camera now.
  static Future<Picked?> record() async {
    if (recordOverride != null) return recordOverride!();
    final recorded = await ImagePicker().pickVideo(source: ImageSource.camera);
    return recorded == null ? null : Picked(File(recorded.path), recorded.name);
  }
}
