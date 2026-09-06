import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; the
// package only resolves inside the extension host. Same stub the stale-agent
// suite uses, and it must be declared before the fileWatcher import.
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import { AgentStateStore } from '../src/agentStateStore.js';
import { TRANSCRIPT_DENIED_RETRY_MS } from '../src/constants.js';
import { readNewLines } from '../src/fileWatcher.js';
import type { AgentState } from '../src/types.js';

/**
 * readNewLines runs on a 500 ms poll per agent. A shared office serves
 * sessions owned by other accounts, whose transcripts it may never open, and
 * the read error it logged on every poll was nine tenths of the office log.
 * Once refused it must say so once, stay quiet, and try again only on the
 * retry schedule, until the day the file opens.
 */
function agentFor(id: number, jsonlFile: string): AgentState {
  return {
    id,
    sessionId: `sess-${id}`,
    isExternal: true,
    projectDir: path.dirname(jsonlFile),
    jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: true,
  } as unknown as AgentState;
}

type LogSpy = MockInstance<typeof console.log>;
const readErrors = (log: LogSpy): string[] =>
  log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Watcher: Agent'));

describe('readNewLines on a transcript this process may not open', () => {
  let tmp: string;
  let agents: AgentStateStore;
  let log: LogSpy;
  const timers = () => new Map<number, ReturnType<typeof setTimeout>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denied-transcript-'));
    agents = new AgentStateStore();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    vi.useRealTimers();
    // Restore read (and traversal, for the directory case) before cleanup.
    for (const entry of fs.readdirSync(tmp)) {
      try {
        fs.chmodSync(path.join(tmp, entry), 0o700);
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A real file with no read bit: stat succeeds, open is EACCES. */
  function deniedFile(name: string): string {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, '{"type":"user","message":{"role":"user","content":"hi"}}\n');
    fs.chmodSync(file, 0o000);
    let code: string | undefined;
    try {
      fs.openSync(file, 'r');
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    // Root ignores the mode bits, in which case nothing here proves anything.
    expect(code, 'expected EACCES; are these tests running as root?').toBe('EACCES');
    return file;
  }

  it('says so once, then polls in silence', () => {
    const file = deniedFile('locked.jsonl');
    agents.set(1, agentFor(1, file));

    for (let i = 0; i < 20; i++) {
      readNewLines(1, agents, timers(), timers());
      vi.advanceTimersByTime(500);
    }

    expect(readErrors(log)).toEqual([
      '[Pixel Agents] Watcher: Agent 1 - cannot read transcript (EACCES); hook events only until it opens',
    ]);
    // The mark carries the time of the latest refusal, and it still reads the
    // first poll's: the nineteen inside the retry window never asked.
    expect(agents.get(1)!.transcriptDeniedAt).toBe(1_000_000);
  });

  it('asks again after the retry window, still without a word', () => {
    const file = deniedFile('still-locked.jsonl');
    agents.set(2, agentFor(2, file));

    readNewLines(2, agents, timers(), timers());
    vi.advanceTimersByTime(TRANSCRIPT_DENIED_RETRY_MS);
    readNewLines(2, agents, timers(), timers());

    expect(readErrors(log)).toHaveLength(1);
    // The mark moved to the second refusal, which is how we know the second
    // poll asked; and the next window is a full one.
    expect(agents.get(2)!.transcriptDeniedAt).toBe(1_000_000 + TRANSCRIPT_DENIED_RETRY_MS);
  });

  it('reads the file the first time it opens, and says that too', () => {
    const file = deniedFile('unlocked-later.jsonl');
    agents.set(3, agentFor(3, file));

    readNewLines(3, agents, timers(), timers());
    fs.chmodSync(file, 0o600);
    vi.advanceTimersByTime(TRANSCRIPT_DENIED_RETRY_MS);
    readNewLines(3, agents, timers(), timers());

    const agent = agents.get(3)!;
    expect(agent.transcriptDeniedAt).toBeUndefined();
    expect(agent.fileOffset).toBe(fs.statSync(file).size);
    expect(agent.linesProcessed).toBe(1);
    expect(readErrors(log)).toEqual([
      '[Pixel Agents] Watcher: Agent 3 - cannot read transcript (EACCES); hook events only until it opens',
      '[Pixel Agents] Watcher: Agent 3 - transcript readable again',
    ]);
  });

  it('is still silent about a transcript that does not exist yet', () => {
    agents.set(4, agentFor(4, path.join(tmp, 'not-yet.jsonl')));
    readNewLines(4, agents, timers(), timers());
    readNewLines(4, agents, timers(), timers());
    expect(readErrors(log)).toEqual([]);
    expect(agents.get(4)!.transcriptDeniedAt).toBeUndefined();
  });

  it('still reports every other read error every time', () => {
    // A directory where the transcript should be: stat succeeds, the read is
    // EISDIR. Not a permission problem, so not one to go quiet about.
    const dir = path.join(tmp, 'dir.jsonl');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'pad'), 'x'.repeat(10));
    agents.set(5, agentFor(5, dir));
    readNewLines(5, agents, timers(), timers());
    readNewLines(5, agents, timers(), timers());
    const errors = readErrors(log);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Agent 5 - read error: .*EISDIR/);
    expect(agents.get(5)!.transcriptDeniedAt).toBeUndefined();
  });
});
