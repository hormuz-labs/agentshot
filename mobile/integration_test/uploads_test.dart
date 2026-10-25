// Bringing footage in from the phone: several videos, photos only, a mix (a photo first: the project still starts
// from the video), and several photos attached inside a project. The system picker can't be scripted, so the files
// it would return come from the runner (E2E_FIXTURES), handed over through Picker.override; uploading, the desktop
// importing them and the projects that come of it are all real. The runner checks the projects on the desktop after.
import 'package:agentshot_mobile/bridge/pick.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  /// Import footage → [choice] in the sheet; the picker returns [names].
  Future<void> importing(
    WidgetTester tester,
    String choice,
    Pick kind,
    List<String> names,
  ) async {
    Picker.override = (asked) async {
      expect(asked, kind, reason: '$choice asks the picker for $kind');
      return media(names);
    };
    await start(tester, 'Import footage');
    await waitFor(tester, find.text('What are you bringing in?'));
    await settle(tester);
    await tester.tap(find.text(choice));
  }

  Future<void> filesShow(WidgetTester tester, List<String> names) async {
    await tester.tap(find.byKey(const ValueKey('tab-Files')));
    for (final name in names) {
      await waitFor(
        tester,
        find.text(name),
        timeout: const Duration(seconds: 60),
      );
    }
  }

  testWidgets(
    'imports several videos, photos only, a mix, and attaches several photos',
    (tester) async {
      addTearDown(() => Picker.override = null);
      await launchPaired(tester);

      // several videos: one project, from the first
      await importing(tester, 'Videos', Pick.videos, [
        'Surf session.mp4',
        'Harbour drone.mp4',
      ]);
      await waitFor(
        tester,
        find.widgetWithText(AppBar, 'Surf session'),
        timeout: const Duration(minutes: 2),
      );
      await filesShow(tester, ['Surf session.mp4', 'Harbour drone.mp4']);
      await tester.pageBack();
      await waitFor(tester, find.byTooltip('Refresh'));

      // photos only: a project made from scratch in the chosen format, with the photos in it
      await importing(tester, 'Photos', Pick.photos, [
        'Dunes 1.jpg',
        'Dunes 2.jpg',
        'Dunes 3.jpg',
      ]);
      await waitFor(tester, find.text('Choose a format'));
      await tester.tap(find.text('9:16'));
      await waitFor(
        tester,
        find.widgetWithText(AppBar, 'From 3 photos'),
        timeout: const Duration(minutes: 2),
      );
      await filesShow(tester, ['Dunes 1.jpg', 'Dunes 2.jpg', 'Dunes 3.jpg']);
      await tester.pageBack();
      await waitFor(tester, find.byTooltip('Refresh'));

      // a mix with a photo first: the project still starts from the video
      await importing(tester, 'Photos and videos', Pick.media, [
        'Dunes 1.jpg',
        'Sunset walk.mp4',
      ]);
      await waitFor(
        tester,
        find.widgetWithText(AppBar, 'Sunset walk'),
        timeout: const Duration(minutes: 2),
      );
      await filesShow(tester, ['Sunset walk.mp4', 'Dunes 1.jpg']);

      // several photos attached to a note inside the project
      await tester.tap(find.byKey(const ValueKey('tab-Conversation')));
      Picker.override = (asked) async {
        expect(asked, Pick.photos);
        return media(['Dunes 2.jpg', 'Dunes 3.jpg']);
      };
      await waitFor(tester, find.byTooltip('Add'));
      await tester.tap(find.byTooltip('Add'));
      await waitFor(tester, find.text('Attach files'));
      await settle(tester);
      await tester.tap(find.text('Attach files'));
      await waitFor(tester, find.text('What are you bringing in?'));
      await settle(tester);
      await tester.tap(find.text('Photos'));
      await waitFor(
        tester,
        find.widgetWithText(InputChip, 'Dunes 2.jpg'),
        timeout: const Duration(seconds: 60),
      );
      await waitFor(tester, find.widgetWithText(InputChip, 'Dunes 3.jpg'));
    },
  );

  testWidgets(
    'records a video, turns away other files alone, and makes a 16:9 photo project',
    (tester) async {
      await launchPaired(tester);

      // Record: what the camera recorded starts a project
      Picker.recordOverride = () async =>
          (await media(['Recorded clip.mp4'])).first;
      await start(tester, 'Record');
      await waitFor(
        tester,
        find.widgetWithText(AppBar, 'Recorded clip'),
        timeout: const Duration(minutes: 2),
      );
      await tester.pageBack();
      await waitGone(tester, find.widgetWithText(AppBar, 'Recorded clip'));
      await settle(tester);

      // a text file alone can't start a film
      await importing(tester, 'Files', Pick.files, ['Shot list.txt']);
      await snack(tester, 'Start with a video or some photos');

      // one photo, landscape
      await importing(tester, 'Photos', Pick.photos, ['Dunes 2.jpg']);
      await waitFor(tester, find.text('Choose a format'));
      await tester.tap(find.text('16:9'));
      await waitFor(
        tester,
        find.widgetWithText(AppBar, 'From a photo'),
        timeout: const Duration(minutes: 2),
      );
    },
  );
}
