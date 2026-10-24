import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'bridge/client.dart';
import 'bridge/mesh.dart';
import 'bridge/store.dart';
import 'ui/home.dart';
import 'ui/pair.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    for (final name in ['Inter', 'SourceSerif4']) {
      yield LicenseEntryWithLineBreaks([
        name,
      ], await rootBundle.loadString('assets/fonts/$name-OFL.txt'));
    }
  });
  runApp(const ManulApp());
}

ThemeData manulTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: Color(dark ? 0xfff2a541 : 0xffc06f12),
        brightness: brightness,
      ).copyWith(
        primary: Color(dark ? 0xfff2a541 : 0xffa85f0c),
        onPrimary: Color(dark ? 0xff1a1208 : 0xffffffff),
        surface: Color(dark ? 0xff161412 : 0xfffbfbf9),
        onSurface: Color(dark ? 0xffefe8df : 0xff141413),
        outlineVariant: Color(dark ? 0xff2c2723 : 0xffe4e4e2),
        surfaceContainerLowest: Color(dark ? 0xff0e0d0c : 0xffffffff),
        surfaceContainerLow: Color(dark ? 0xff161412 : 0xfffcfcfb),
        surfaceContainer: Color(dark ? 0xff1d1a17 : 0xfff3f3f1),
        surfaceContainerHigh: Color(dark ? 0xff1d1a17 : 0xfff0f0ee),
        surfaceContainerHighest: Color(dark ? 0xff25211d : 0xffefefed),
      );
  final typography = ThemeData(
    brightness: brightness,
    fontFamily: 'Inter',
  ).textTheme;
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Inter',
    textTheme: typography.copyWith(
      headlineLarge: typography.headlineLarge?.copyWith(
        fontFamily: 'SourceSerif4',
      ),
      headlineMedium: typography.headlineMedium?.copyWith(
        fontFamily: 'SourceSerif4',
      ),
      headlineSmall: typography.headlineSmall?.copyWith(
        fontFamily: 'SourceSerif4',
      ),
    ),
    scaffoldBackgroundColor: scheme.surface,
    visualDensity: VisualDensity.standard,
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
  );
}

class ManulApp extends StatefulWidget {
  const ManulApp({super.key});
  @override
  State<ManulApp> createState() => _ManulAppState();
}

class _ManulAppState extends State<ManulApp> {
  final client = BridgeClient();
  late final store = BridgeStore(client);
  bool ready = false, paired = false;
  // an agentshot://pair link from the phone's camera, handed to the pair screen
  String? link;
  ThemeMode theme = ThemeMode.system;
  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final saved = preferences.getString('theme');
      theme =
          ThemeMode.values.where((m) => m.name == saved).firstOrNull ??
          ThemeMode.system;
      paired = await client.restore();
      if (paired) client.listen();
      Mesh.onLink((value) {
        if (!paired && mounted) setState(() => link = value);
      });
      if (!paired) link = await Mesh.initialLink();
    } catch (_) {
      paired = false;
    } finally {
      if (mounted) setState(() => ready = true);
    }
  }

  void setTheme(ThemeMode value) async {
    setState(() => theme = value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('theme', value.name);
  }

  Future<void> disconnect() async {
    await client.disconnect();
    store.project = null;
    store.agents.clear();
    if (mounted) setState(() => paired = false);
  }

  @override
  void dispose() {
    store.dispose();
    client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AgentShot',
    debugShowCheckedModeBanner: false,
    theme: manulTheme(Brightness.light),
    darkTheme: manulTheme(Brightness.dark),
    themeMode: theme,
    home: !ready
        ? const Scaffold(body: Center(child: CircularProgressIndicator()))
        : paired
        ? HomeScreen(
            store: store,
            theme: theme,
            onTheme: setTheme,
            onDisconnect: disconnect,
          )
        : PairScreen(
            key: ValueKey(link),
            client: client,
            link: link,
            onPaired: () {
              link = null;
              setState(() => paired = true);
              client.listen();
            },
          ),
  );
}
