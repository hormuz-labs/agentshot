import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'bridge/account.dart';
import 'bridge/client.dart';
import 'bridge/mesh.dart';
import 'bridge/notify.dart';
import 'bridge/store.dart';
import 'ui/computers.dart';
import 'ui/design.dart';
export 'ui/design.dart' show agentShotTheme;
import 'ui/home.dart';
import 'ui/splash.dart';
import 'ui/pair.dart';
import 'ui/project.dart';

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

class AgentShotApp extends StatefulWidget {
  const AgentShotApp({super.key});
  @override
  State<AgentShotApp> createState() => _AgentShotAppState();
}

class _AgentShotAppState extends State<AgentShotApp> {
  final client = BridgeClient();
  final account = Account();
  late final store = BridgeStore(client);
  // when work on the computer is done or needs the person, and they aren't looking
  late final notifier = Notifier(store)..onOpen = _openFromNotification;
  bool ready = false, paired = false;
  // signed in, but pairing with a code instead (a computer that isn't signed in)
  bool codes = false;
  // why the phone is back on the connect screen, when the computer ended the connection
  String? notice;
  final navigator = GlobalKey<NavigatorState>();
  // an agentshot://pair link from the phone's camera, handed to the pair screen
  String? link;
  ThemeMode theme = ThemeMode.dark;
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

  final started = DateTime.now();
  Future<void> _restore() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      final saved = preferences.getString('theme');
      theme =
          ThemeMode.values.where((m) => m.name == saved).firstOrNull ??
          // a studio: dark until the person picks otherwise, so the film is the brightest thing on screen
          ThemeMode.dark;
    } catch (_) {
      // the system's look, then
    }
    try {
      await account.restore();
      store.account = account;
      client.renew = account.renew;
      paired = await client.restore();
      // what the phone kept of this computer shows at once, before it answers (or while it can't)
      if (paired) await store.restoreSaved();
      if (paired) client.listen();
      await notifier.start();
      if (paired) unawaited(notifier.askPermission());
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
      // long enough to read, never a flash
      final shown = DateTime.now().difference(started);
      const least = Duration(milliseconds: 1400);
      if (shown < least) await Future<void>.delayed(least - shown);
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
    await store.forgetSaved();
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
    // turned away: nothing of that computer's stays on the phone
    unawaited(store.forgetSaved());
    unawaited(client.cache.clear().catchError((_) {}));
    store.project = null;
    store.agents.clear();
    navigator.currentState?.popUntil((route) => route.isFirst);
    setState(() {
      paired = false;
      notice = store.connectionError;
    });
  }

  /// A notification about a project was tapped: that project, open.
  Future<void> _openFromNotification(String dir) async {
    if (!paired) return;
    try {
      // kept on the phone (most are, ahead of a tap): open at once, and the computer's version follows
      if (await store.showSaved(dir)) {
        store.open(dir).ignore();
      } else {
        await store.open(dir);
      }
      navigator.currentState?.popUntil((route) => route.isFirst);
      await navigator.currentState?.push(
        MaterialPageRoute<void>(builder: (_) => ProjectScreen(store: store)),
      );
    } catch (e) {
      debugPrint('AgentShot: could not open $dir: $e');
    }
  }

  void connected() {
    unawaited(notifier.askPermission());
    unawaited(store.restoreSaved());
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
    notifier.dispose();
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
        ? const Splash()
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
            account: account,
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
