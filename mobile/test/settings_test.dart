import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:agentshot_mobile/bridge/client.dart';
import 'package:agentshot_mobile/bridge/store.dart';
import 'package:agentshot_mobile/ui/cut_card.dart';
import 'package:agentshot_mobile/ui/delete_account.dart';
import 'package:agentshot_mobile/ui/project.dart';
import 'package:agentshot_mobile/ui/settings.dart';
import 'package:agentshot_mobile/ui/setup_ai.dart';

/// A computer whose keys and providers the test sets; it remembers what the phone asked of it.
class Computer extends BridgeClient {
  // no pictures or films from a pretend computer
  @override
  Future<Uri> thumbnail(String project, String file) async =>
      throw BridgeException('no picture');
  @override
  Future<Uri> media(String project, String file) async =>
      throw BridgeException('no film');

  Computer({
    this.credits = false,
    this.own = const {},
    this.providers = const [],
    this.cloud = false,
  });
  bool credits;
  Set<String> own;
  List<Json> providers;
  bool cloud;
  final asked = <List<dynamic>>[];
  @override
  Connection? get connection => Connection(
    Uri.parse('https://x:1'),
    'a' * 64,
    't',
    [],
    cloud ? 'pool-1' : 'm',
    cloud ? 'AgentShot Cloud' : 'Studio iMac',
  );
  @override
  Future<dynamic> call(String method, [List<dynamic> args = const []]) async {
    asked.add([method, ...args]);
    if (method == 'keys:set') {
      final [env, value] = args;
      if (env == 'MANUL_KEY') {
        credits = '$value'.isNotEmpty;
      } else {
        own = '$value'.isEmpty ? ({...own}..remove(env)) : {...own, '$env'};
      }
    }
    if (method == 'account:adopt') credits = true;
    return switch (method) {
      'keys:list' => [
        for (final (env, label) in [
          ('GEMINI_API_KEY', 'Google Gemini'),
          ('ANTHROPIC_API_KEY', 'Anthropic'),
          ('OPENAI_API_KEY', 'OpenAI'),
          ('ELEVENLABS_API_KEY', 'ElevenLabs'),
        ])
          {
            'env': env,
            'label': label,
            'unlocks': ['text'],
            'set': own.contains(env),
          },
        {
          'env': 'MANUL_KEY',
          'label': 'AgentShot',
          'unlocks': ['text'],
          'set': credits,
        },
      ],
      'providers:list' => {'providers': providers},
      'account:status' => {'email': credits ? 'maya@example.com' : null},
      'account:balance' => {
        'credits': 12345,
        'plan': {'name': 'Pro'},
      },
      _ => [],
    };
  }
}

class Signed extends Account {
  Signed() : super(browser: (_) async => '') {
    email = 'maya@example.com';
    key = 'sk-maya';
  }
  @override
  Future<Json> balance() async => {
    'credits': 12345,
    'plan': {'name': 'Pro'},
  };
}

Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

SettingsScreen settings(
  BridgeStore store, {
  ThemeMode theme = ThemeMode.system,
  ValueChanged<ThemeMode>? onTheme,
}) => SettingsScreen(
  store: store,
  theme: theme,
  onTheme: onTheme ?? (_) {},
  onDisconnect: () async {},
  account: store.account,
  onSignOut: () async {},
);

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;
  group('the AI line', () {
    Json key(String env, String label, bool set) => {
      'env': env,
      'label': label,
      'set': set,
    };
    test('says what the computer uses, in words', () {
      expect(
        aiSummary([
          key('MANUL_KEY', 'AgentShot', true),
          key('OPENAI_API_KEY', 'OpenAI', false),
        ]),
        'AgentShot credits',
      );
      expect(
        aiSummary([
          key('MANUL_KEY', 'AgentShot', true),
          key('OPENAI_API_KEY', 'OpenAI', true),
        ]),
        'AgentShot credits, plus your OpenAI key',
      );
      expect(
        aiSummary([
          key('MANUL_KEY', 'AgentShot', false),
          key('ANTHROPIC_API_KEY', 'Anthropic', true),
        ]),
        'Your Anthropic key',
      );
      expect(
        aiSummary(
          [key('MANUL_KEY', 'AgentShot', false)],
          [
            // its key not set: the computer can't use it, so it isn't counted
            {
              'id': 'groq',
              'name': 'Groq',
              'baseUrl': 'https://api.groq.com/openai/v1',
              'keySet': false,
            },
            {
              'id': 'ollama',
              'name': 'Ollama',
              'baseUrl': 'http://localhost:11434/v1',
              'keySet': false,
            },
          ],
        ),
        isNull,
      );
      expect(
        aiSummary(
          [key('MANUL_KEY', 'AgentShot', false)],
          [
            {
              'id': 'groq',
              'name': 'Groq',
              'baseUrl': 'https://api.groq.com/openai/v1',
              'keySet': true,
            },
          ],
        ),
        'Your Groq',
      );
      expect(
        aiSummary([
          key('MANUL_KEY', 'AgentShot', false),
          key('OPENAI_API_KEY', 'OpenAI', false),
        ]),
        isNull,
      );
    });
  });

  testWidgets(
    'Settings: account, computer, AI, the computer\'s own panels and the app, each in its place',
    (tester) async {
      final store =
          BridgeStore(Computer(credits: true, own: {'ANTHROPIC_API_KEY'}))
            ..account = Signed()
            ..connected = true;
      await tester.pumpWidget(host(settings(store)));
      await tester.pumpAndSettle();
      for (final section in [
        'Account',
        'Computer',
        'AI',
        'On Studio iMac',
        'App',
      ]) {
        await tester.scrollUntilVisible(find.text(section), 80);
        expect(find.text(section), findsOneWidget, reason: section);
      }
      await tester.scrollUntilVisible(find.text('maya@example.com'), -80);
      expect(find.text('12,345 credits · Pro plan'), findsOneWidget);
      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('Use a different computer'), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);
      expect(
        find.text('AgentShot credits, plus your Anthropic key'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'nothing set up yet: signed in, the credits are used; the sheet offers credits first, then keys',
    (tester) async {
      // a tall screen: every row on it
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final computer = Computer();
      final store = BridgeStore(computer)
        ..account = Signed()
        ..connected = true;
      await tester.pumpWidget(host(settings(store)));
      await tester.pumpAndSettle();
      // signed in on the phone: nothing to choose, their credits are used, never a warning
      expect(
        find.text('Not set up yet: choose credits or a key'),
        findsNothing,
      );
      expect(find.text('AgentShot credits'), findsOneWidget);
      expect(
        computer.asked.where((a) => a.first == 'account:adopt'),
        hasLength(1),
      );
      // the computer let go of them since (signed out there): the sheet offers them again
      computer.credits = false;
      computer.asked.clear();
      await tester.tap(find.text('AI models'));
      await tester.pumpAndSettle();
      // credits: not in use; one tap hands the phone's account to the computer
      final credits = find.byKey(const ValueKey('ai-credits'));
      expect(
        find.descendant(of: credits, matching: find.text('In use')),
        findsNothing,
      );
      await tester.tap(
        find.descendant(
          of: credits,
          matching: find.text('Use AgentShot credits'),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        computer.asked.where((a) => a.first == 'account:adopt').single[1],
        {'key': 'sk-maya', 'email': 'maya@example.com'},
      );
      expect(
        find.descendant(of: credits, matching: find.text('In use')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: credits,
          matching: find.textContaining('Signed in as maya@example.com'),
        ),
        findsOneWidget,
      );
      // a key: Add, pasted, Added; then removed, asking first
      final openai = find.byKey(const ValueKey('key-OPENAI_API_KEY'));
      // in the sheet (the settings behind it scroll too)
      await tester.scrollUntilVisible(
        openai,
        80,
        scrollable: find.byType(Scrollable).last,
      );
      expect(
        find.descendant(of: openai, matching: find.text('Add')),
        findsOneWidget,
      );
      await tester.tap(openai);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'sk-mine');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: openai, matching: find.text('Added')),
        findsOneWidget,
      );
      await tester.tap(openai);
      await tester.pumpAndSettle();
      expect(find.text('Remove the OpenAI key?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(computer.own, {'OPENAI_API_KEY'}, reason: 'Cancel keeps it');
      await tester.tap(openai);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove'));
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: openai, matching: find.text('Add')),
        findsOneWidget,
      );
      expect(computer.own, isEmpty);
      // closed: the line says what it uses now
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('AgentShot credits'), findsOneWidget);
    },
  );

  testWidgets(
    'Delete my account: says what goes, then the request from their own email (the page without an email app)',
    (tester) async {
      final opened = <Uri>[];
      var mail = true;
      openLink = (uri) async {
        opened.add(uri);
        return uri.scheme != 'mailto' || mail;
      };
      addTearDown(() => openLink = (_) async => false);
      final store = BridgeStore(Computer(credits: true))
        ..account = Signed()
        ..connected = true;
      await tester.pumpWidget(host(settings(store)));
      await tester.pumpAndSettle();

      // at the very end of Settings, away from everyday buttons
      final delete = find.byKey(const ValueKey('settings-delete-account'));
      await tester.scrollUntilVisible(delete, 200);
      await tester.pumpAndSettle();

      // Cancel sends nothing
      await tester.tap(find.byKey(const ValueKey('settings-delete-account')));
      await tester.pumpAndSettle();
      expect(find.text('Delete your AgentShot account?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(opened, isEmpty);

      // the request, addressed and signed with the account's email
      await tester.tap(find.byKey(const ValueKey('settings-delete-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Email the request'));
      await tester.pumpAndSettle();
      expect(opened.single.scheme, 'mailto');
      expect(opened.single.path, 'support@agentshot.si');
      expect(opened.single.toString(), contains('maya%40example.com'));
      expect(opened.single.toString(), isNot(contains('+')));

      // no email app: the page, with the address and the steps
      opened.clear();
      mail = false;
      await tester.tap(find.byKey(const ValueKey('settings-delete-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Email the request'));
      await tester.pumpAndSettle();
      expect(opened.map((u) => u.scheme), ['mailto', 'https']);
      expect(opened.last, deletePage);
    },
  );

  testWidgets('on AgentShot Cloud: no panels the worker keeps to itself', (
    tester,
  ) async {
    final account = Signed()..leased = 'pool-1';
    final store = BridgeStore(Computer(cloud: true))
      ..account = account
      ..connected = true;
    await tester.pumpWidget(host(settings(store)));
    await tester.pumpAndSettle();
    expect(find.text('AgentShot Cloud'), findsWidgets);
    for (final panel in [
      'Memory',
      'Skills & profiles',
      'Agent browser',
      'Desktop tools',
    ]) {
      expect(find.text(panel), findsNothing, reason: panel);
    }
  });

  testWidgets('appearance: light or dark at a tap', (tester) async {
    // a tall screen: every row on it
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = BridgeStore(Computer())..connected = true;
    ThemeMode? chosen;
    await tester.pumpWidget(host(settings(store, onTheme: (m) => chosen = m)));
    await tester.pumpAndSettle();
    final appearance = find.byKey(const ValueKey('appearance'));
    await tester.ensureVisible(appearance);
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(of: appearance, matching: find.text('Dark')),
    );
    expect(chosen, ThemeMode.dark);
    await tester.tap(
      find.descendant(of: appearance, matching: find.text('Light')),
    );
    expect(chosen, ThemeMode.light);
  });

  testWidgets(
    'the agent\'s latest cut, at the end of the conversation, to watch and download there',
    (tester) async {
      final store = BridgeStore(Computer())..connected = true;
      store.project = {
        'dir': '/p',
        'title': 'Harbour walk',
        'notes': [],
        'media': {},
        'files': {},
        'versions': [
          {
            'id': 'v1',
            'title': 'Original',
            'path': 'media/a.mp4',
            'by': 'import',
          },
          {
            'id': 'v2',
            'title': 'Opening tightened',
            'path': 'renders/v2.mp4',
            'by': 'agent',
          },
        ],
        'current': 'v2',
      };
      store.agent('/p').snapshot({
        'messages': [
          {'id': '1', 'role': 'user', 'content': 'Tighten the opening'},
          // the turn rendered the cut: it shows after the reply
          {
            'id': '2',
            'role': 'assistant',
            'toolCalls': [
              {
                'id': 'c1',
                'function': {'name': 'rerender_timeline'},
                'title': 'Rendered the film',
              },
            ],
          },
          {'id': '3', 'role': 'tool', 'toolCallId': 'c1', 'content': 'ok'},
          {'id': '4', 'role': 'assistant', 'content': 'Done.'},
        ],
      });
      // the film on screen above the conversation is this cut: no second player for it
      await tester.pumpWidget(MaterialApp(home: ProjectScreen(store: store)));
      await tester.pumpAndSettle();
      expect(find.byType(CutCard), findsNothing);
      // a short screen (a phone on its side) has no room for the film above: the cut comes in the conversation
      tester.view.physicalSize = const Size(800, 400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpAndSettle();
      final card = find.byType(CutCard);
      expect(card, findsOneWidget);
      expect(
        find.descendant(of: card, matching: find.text('Your film')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('Opening tightened')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.byTooltip('Download')),
        findsOneWidget,
      );
      // a later answer that made no cut: the old cut doesn't sit under it
      store.agent('/p').snapshot({
        'messages': [
          ...store.agent('/p').messages,
          {'id': '5', 'role': 'user', 'content': 'What did you change?'},
          {'id': '6', 'role': 'assistant', 'content': 'I cut four fillers.'},
        ],
      });
      await tester.pumpWidget(
        MaterialApp(
          home: ProjectScreen(store: store, key: UniqueKey()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(CutCard), findsNothing);
      // the imported original isn't announced as the agent's
      store.project = {...store.project!, 'current': 'v1'};
      store.agent('/p').snapshot({
        'messages': [
          {'id': '1', 'role': 'user', 'content': 'Hi'},
        ],
      });
      await tester.pumpWidget(
        MaterialApp(
          home: ProjectScreen(store: store, key: UniqueKey()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(CutCard), findsNothing);
    },
  );
}
