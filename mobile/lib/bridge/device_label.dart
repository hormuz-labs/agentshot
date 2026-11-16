import 'dart:io';
import 'dart:math';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// How an Android phone shows up on the desktop: the name the phone gives itself (on a Samsung, "Galaxy S23"), with
/// its maker in front when the name doesn't say it ("Samsung Galaxy S23"), or the maker and model when it has no name.
/// A name someone gave the phone ("Asha's phone") is kept as it is.
String androidLabel({
  required String manufacturer,
  required String model,
  String name = '',
}) {
  String cap(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).toLowerCase();
  final maker = cap(manufacturer.trim());
  final base = name.trim().isNotEmpty ? name.trim() : model.trim();
  if (base.isEmpty) return maker.isEmpty ? 'Android phone' : '$maker phone';
  final ownName = base.contains("'") || base.contains('’');
  if (maker.isEmpty ||
      ownName ||
      base.toLowerCase().contains(maker.toLowerCase())) {
    return base;
  }
  return '$maker $base';
}

/// An iPhone or iPad by its model ("iPhone 16 Pro"), or just "iPhone" when the system doesn't say.
String iosLabel({String modelName = '', String model = ''}) {
  if (modelName.trim().isNotEmpty) return modelName.trim();
  return model.trim().isNotEmpty ? model.trim() : 'iPhone';
}

/// This install of the app, the same every time it pairs: the desktop replaces the phone's old entry with it instead
/// of listing the phone twice. Kept in the phone's secure storage, so it lasts until the app is uninstalled.
Future<String> installId(FlutterSecureStorage storage) async {
  const key = 'agentshot.install.v1';
  final saved = await storage.read(key: key);
  if (saved != null && RegExp(r'^[A-Za-z0-9_-]{8,128}$').hasMatch(saved)) {
    return saved;
  }
  final random = Random.secure();
  const letters =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  final id = List.generate(
    32,
    (_) => letters[random.nextInt(letters.length)],
  ).join();
  await storage.write(key: key, value: id);
  return id;
}

/// This phone's model, as the desktop shows it under Settings → Mobile (see [androidLabel], [iosLabel]).
Future<String?> describeThisPhone() async {
  try {
    final info = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      return androidLabel(
        manufacturer: a.manufacturer,
        model: a.model,
        name: a.name,
      );
    }
    if (Platform.isIOS) {
      final i = await info.iosInfo;
      return iosLabel(modelName: i.modelName, model: i.model);
    }
  } catch (_) {
    // the plain name, then
  }
  return null;
}
