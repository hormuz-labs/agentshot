import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'bridge/account.dart';
import 'bridge/client.dart';
import 'bridge/mesh.dart';
import 'bridge/store.dart';
import 'ui/computers.dart';
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
  runApp(const AgentShotApp());
}

ThemeData agentShotTheme(Brightness brightness) {
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

class AgentShotApp extends StatefulWidget {
  const AgentShotApp({super.key});
  @override
  State<AgentShotApp> createState() => _AgentShotAppState();
}

class _AgentShotAppState extends State<AgentShotApp> {
  final client = BridgeClient();
  final account = Account();
  late final store = BridgeStore(client);
  bool ready = false, paired = false;
  // signed in, but pairing with a code instead (a computer that isn't signed in)
  bool codes = false;
  // why the phone is back on the connect screen, when the computer ended the connection
  String? notice;
  final navigator = GlobalKey<NavigatorState>();
  // an agentshot://pair link from the phone's camera, handed to the pair screen
  String? link;
  ThemeMode theme = ThemeMode.system;
  @override
  void initState() {
    super.initState();
    store.addListener(_watch);
    // listen for pairing links first: before anything that could fail on the way (reading saved state), so a
    // scanned QR is never lost
    Mesh.onLink((value) {
      if (!paired && mounted) setState(() => link = value);
    });
    _restore();
  }

  Future<void> _restore() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final saved = preferences.getString('theme');
      theme =
          ThemeMode.values.where((m) => m.name == saved).firstOrNull ??
          ThemeMode.system;
    } catch (_) {
      // the system's look, then
    }
    try {
      await account.restore();
      store.account = account;
      client.renew = account.renew;
      paired = await client.restore();
      if (paired) client.listen();
    } catch (e) {
      debugPrint('AgentShot: could not restore the saved connection: $e');
      paired = false;
    }
    try {
      // opened by a scanned QR (the link that started the app), unless a link already came in meanwhile
      if (!paired) link ??= await Mesh.initialLink();
    } catch (_) {
      // no link to pair with
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
    // a cloud worker goes back to AgentShot's pool for the next person
    if (account.leased != null &&
        client.connection?.machine == account.leased) {
      await account.release();
    }
    await client.disconnect();
    store.project = null;
    store.agents.clear();
    if (mounted) setState(() => paired = false);
  }

  Future<void> signIn() async {
    await account.signIn();
    if (mounted) setState(() => codes = false);
  }

  Future<void> signOut() async {
    await account.signOut();
    // a computer opened through the account goes too; one paired with a code stays
    if (client.connection?.machine != null) await disconnect();
    if (mounted) setState(() => codes = false);
  }

  /// The computer turned this phone away: back to connecting, from wherever the person is, saying why.
  void _watch() {
    if (!store.revoked || !paired) return;
    store.revoked = false;
    store.project = null;
    store.agents.clear();
    navigator.currentState?.popUntil((route) => route.isFirst);
    setState(() {
      paired = false;
      notice = store.connectionError;
    });
  }

  void connected() {
    link = null;
    setState(() {
      paired = true;
      codes = false;
      notice = null;
    });
    client.listen();
  }

  @override
  void dispose() {
    store.dispose();
    client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: navigator,
    title: 'AgentShot',
    debugShowCheckedModeBanner: false,
    theme: agentShotTheme(Brightness.light),
    darkTheme: agentShotTheme(Brightness.dark),
    themeMode: theme,
    home: !ready
        ? const Scaffold(body: Center(child: CircularProgressIndicator()))
        : paired
        ? HomeScreen(
            store: store,
            theme: theme,
            onTheme: setTheme,
            onDisconnect: disconnect,
            account: account.signedIn ? account : null,
            onSignOut: signOut,
          )
        : account.signedIn && link == null && !codes
        ? ComputersScreen(
            account: account,
            client: client,
            onConnected: connected,
            onSignOut: signOut,
            onCodes: () => setState(() => codes = true),
            notice: notice,
          )
        : PairScreen(
            key: ValueKey(link),
            client: client,
            link: link,
            codes: codes,
            notice: notice,
            signedIn: account.signedIn,
            onSignIn: account.signedIn
                ? () async => setState(() => codes = false)
                : signIn,
            onPaired: connected,
          ),
  );
}
