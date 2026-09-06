import { describe, expect, it } from 'vitest';

import { parsePsOutput, probeLiveness } from '../src/processLiveness.js';

/**
 * The parser is what turns one `ps` answer into per-pid verdicts; the probe
 * itself is exercised once against the real OS with the test's own pid.
 */
describe('parsePsOutput', () => {
  const CONTROL = 999;
  const ps = (...lines: string[]) => lines.join('\n') + '\n';

  it('calls a listed claude process alive and an unlisted pid gone', () => {
    const out = ps(
      `  999 node /usr/local/tacit/office/app/dist/cli.js`,
      ` 4242 /Users/chris/.local/share/claude/versions/2.1.260 --print --sdk-url x`,
    );
    const map = parsePsOutput(out, [4242, 4243], CONTROL);
    expect(map.get(4242)).toBe('alive');
    expect(map.get(4243)).toBe('gone');
  });

  it('calls a recycled pid running something else gone', () => {
    // Pids wrap; a session that died overnight could hand its number to a
    // shell by morning, and that shell must not pass for the session.
    const out = ps(`  999 node cli.js`, ` 4242 /bin/zsh -l`);
    expect(parsePsOutput(out, [4242], CONTROL).get(4242)).toBe('gone');
  });

  it('recognises every way a session runs on the Mini', () => {
    const out = ps(
      `  999 node cli.js`,
      ` 1 /Users/chris/Library/Application Support/Claude/claude-code/2.1.260/claude.app/Contents/MacOS/claude --output-format stream-json`,
      ` 2 /Users/chris/.claude/remote/ccd-cli/2.1.260 --output-format stream-json`,
      ` 3 /Users/joe/.local/bin/claude remote-control --name tacit-mini`,
    );
    const map = parsePsOutput(out, [1, 2, 3], CONTROL);
    expect([map.get(1), map.get(2), map.get(3)]).toEqual(['alive', 'alive', 'alive']);
  });

  it('answers nothing at all when the control pid is missing', () => {
    // ps failed or refused: an empty map, never "everyone is gone".
    expect(parsePsOutput('', [4242], CONTROL).size).toBe(0);
    expect(parsePsOutput(ps(` 4242 claude`), [4242], CONTROL).size).toBe(0);
  });
});

describe('probeLiveness', () => {
  it('answers nothing for no pids without touching the OS', async () => {
    expect((await probeLiveness([])).size).toBe(0);
  });

  it('finds this very process, on a platform that has ps', async () => {
    const map = await probeLiveness([process.pid]);
    if (process.platform === 'win32') {
      expect(map.size).toBe(0);
      return;
    }
    // The test runner is node, not claude: listed, so not unknown, and not
    // a claude command line, so gone. Both halves of the rule in one call.
    expect(map.get(process.pid)).toBe('gone');
  });
});
