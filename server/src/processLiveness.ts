import { execFile } from 'node:child_process';

/**
 * Ask the OS which of a set of session processes are still Claude sessions
 * (Tacit patch).
 *
 * The office cannot read a director's transcript (0600) and a session that
 * dies without a clean exit sends no SessionEnd, so until now the only way to
 * learn a session was gone was to wait for it to be silent for twelve hours.
 * The hook wrapper now reports the session's own pid, and `ps` answers for a
 * process of any user, which is the whole reason this works from ghrunner.
 *
 * One `ps` per sweep, for every pid at once. A pid is 'alive' when it is
 * listed AND its command line names claude — every way a session runs here
 * (the versioned binary under ~/.local/share/claude, the desktop app's
 * bundle, the remote ccd-cli) has "claude" in the path, and a recycled pid
 * running something else must not pass for a live session. Listed but not
 * claude, or not listed at all, is 'gone'.
 *
 * The server's own pid rides in every query as a control: if it is missing
 * from the answer then ps itself failed (absent on Windows, or refused), and
 * the result is unknown for everyone rather than "all gone". Unknown makes
 * the sweep fall back to the silence clocks, which is what it did before.
 */
export type Liveness = 'alive' | 'gone';
export type LivenessMap = ReadonlyMap<number, Liveness>;

const CLAUDE_COMMAND = /claude/i;

export function parsePsOutput(stdout: string, pids: number[], controlPid: number): LivenessMap {
  const listed = new Map<number, string>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) listed.set(Number(m[1]), m[2]);
  }
  if (!listed.has(controlPid)) return new Map();

  const out = new Map<number, Liveness>();
  for (const pid of pids) {
    const cmd = listed.get(pid);
    out.set(pid, cmd !== undefined && CLAUDE_COMMAND.test(cmd) ? 'alive' : 'gone');
  }
  return out;
}

export function probeLiveness(pids: number[]): Promise<LivenessMap> {
  if (pids.length === 0) return Promise.resolve(new Map());
  const controlPid = process.pid;
  const list = [...new Set([...pids, controlPid])].join(',');
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-o', 'pid=,command=', '-p', list],
      { timeout: 5_000, windowsHide: true },
      (_err, stdout) => {
        // `ps -p` exits non-zero when any pid is missing, which is the normal
        // case here, so the exit code says nothing; the control pid does.
        resolve(parsePsOutput(typeof stdout === 'string' ? stdout : '', pids, controlPid));
      },
    );
  });
}
