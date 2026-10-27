import 'package:flutter_test/flutter_test.dart';
import 'package:agentshot_mobile/ui/step_words.dart';
import 'package:agentshot_mobile/ui/steps.dart' show runProblem;

void main() {
  test('steps read in words, as the computer words them, never as commands', () {
    expect(stepTitle('look', {'image': 'media/IMG_9999.jpg'}), 'Looked at IMG_9999.jpg');
    expect(stepTitle('project_state', {}), 'Looked at the project');
    expect(stepTitle('rerender_timeline', {}), 'Rendered the film');
    expect(
      stepTitle('edit_timeline', {
        'edits': [
          {'op': 'trim'},
          {'op': 'trim'},
          {'op': 'delete'},
        ],
      }),
      'Edited the cut: trimmed 2 pieces, removed a piece',
    );
    expect(stepTitle('ffmpeg', {'args': ['-i', 'a.mp4', 'renders/out.mp4']}), 'Made out.mp4');
    expect(stepTitle('bash', {'command': 'ls renders'}), 'Looked through the project’s files');
    expect(stepTitle('bash', {'command': 'ffprobe -v error media/a.mp4'}), 'Checked a.mp4');
    expect(stepTitle('bash', {'command': 'grep -n "title" project.json'}), 'Searched project.json');
    expect(stepTitle('bash', {'command': 'python3 -c "\n# Measure each section\nprint(1)"'}), 'Measure each section');
    expect(stepTitle('bash', {'command': 'x' * 100}), 'Worked on the computer');
    expect(stepDetail('bash', {'command': 'ls renders'}), r'$ ls renders');
  });

  test('the AI problems say what they mean and what to do', () {
    expect(runProblem('An unknown error occurred'), startsWith('AgentShot stopped before it finished.'));
    expect(runProblem('429 Too Many Requests'), contains('Wait a minute'));
    expect(runProblem('fetch failed: ECONNRESET'), contains('internet connection'));
    expect(runProblem('Insufficient credit balance'), contains('credits'));
  });

  test('a failed step says what it means', () {
    expect(failureHint('read', "ENOENT: no such file or directory, open 'notes/brief.txt'"), 'That file isn’t in the project.');
    expect(failureHint('probe', 'moov atom not found'), 'That video file looks damaged or unfinished.');
    expect(failureHint('look', 'odd'), 'This step didn’t work; the agent carries on without it.');
  });
}
