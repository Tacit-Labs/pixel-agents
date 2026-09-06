import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; the
// package only resolves inside the extension host. Same stub the dismissal
// suite uses, and it must be declared before the fileWatcher import.
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import { AgentStateStore } from '../src/agentStateStore.js';
import { EXTERNAL_STALE_CHECK_INTERVAL_MS } from '../src/constants.js';
import { setAgentRemovalCallback, startStaleExternalAgentCheck } from '../src/fileWatcher.js';
import type { AgentState } from '../src/types.js';

/**
 * The stale check despawns an external agent whose transcript has been
 * deleted. It decides that by stat'ing the file, so what it does with a stat
 * that fails for some OTHER reason is the whole question here.
 *
 * The case that matters in production: an always-on server showing several
 * people's sessions runs as its own account, and Claude Code writes a
 * session's project directory 0700 and its transcript 0600. Every stat of
 * someone else's transcript is EACCES, forever, for a session that is
 * perfectly alive.
 */
function externalAgent(id: number, jsonlFile: string): AgentState {
  return {
    id,
    sessionId: `sess-${id}`,
    terminalRef: undefined,
    isExternal: true,
    projectDir: path.dirname(jsonlFile),
    jsonlFile,
  } as unknown as AgentState;
}

describe('startStaleExternalAgentCheck', () => {
  let tmp: string;
  let agents: AgentStateStore;
  let removed: number[];
  let timer: ReturnType<typeof setInterval> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-agent-'));
    agents = new AgentStateStore();
    removed = [];
    setAgentRemovalCallback((id) => removed.push(id));
  });

  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = undefined;
    setAgentRemovalCallback(null);
    vi.useRealTimers();
    // Restore traversal before cleanup, or the rmSync cannot descend either.
    for (const entry of fs.readdirSync(tmp)) {
      const p = path.join(tmp, entry);
      try {
        if (fs.lstatSync(p).isDirectory()) fs.chmodSync(p, 0o700);
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('removes an agent whose transcript has actually been deleted', () => {
    const file = path.join(tmp, 'gone.jsonl');
    agents.set(1, externalAgent(1, file));
    // Never created, so stat fails with ENOENT.
    timer = startStaleExternalAgentCheck(agents, new Set([file]));
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS + 1);
    expect(removed).toEqual([1]);
  });

  it('keeps an agent whose transcript exists', () => {
    const file = path.join(tmp, 'alive.jsonl');
    fs.writeFileSync(file, '{}\n');
    agents.set(2, externalAgent(2, file));
    timer = startStaleExternalAgentCheck(agents, new Set([file]));
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS + 1);
    expect(removed).toEqual([]);
  });

  it("keeps an agent whose transcript exists but cannot be stat'd", () => {
    // A directory with no traversal bit: the file inside is real and
    // untouched, but stat'ing it raises EACCES rather than ENOENT. This is
    // exactly what a server sees for another account's 0700 project dir.
    const dir = path.join(tmp, 'private');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'locked.jsonl');
    fs.writeFileSync(file, '{}\n');
    fs.chmodSync(dir, 0o000);

    let code: string | undefined;
    try {
      fs.statSync(file);
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    // Running as root defeats the permission bits entirely, in which case
    // this test would pass vacuously. Refuse to pretend it proved anything.
    expect(code, 'expected EACCES; are these tests running as root?').toBe('EACCES');

    agents.set(3, externalAgent(3, file));
    timer = startStaleExternalAgentCheck(agents, new Set([file]));
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS * 3 + 1);
    expect(removed).toEqual([]);
  });

  it('does not run at all while hooks are active', () => {
    const file = path.join(tmp, 'gone-too.jsonl');
    agents.set(4, externalAgent(4, file));
    timer = startStaleExternalAgentCheck(agents, new Set([file]), { current: true });
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS + 1);
    expect(removed).toEqual([]);
  });
});
