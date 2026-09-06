import { describe, expect, it, vi } from 'vitest';

// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; the 'vscode'
// package only resolves inside the extension host. Stub the two APIs fileWatcher actually
// touches at runtime (vscode.window.activeTerminal / terminals) so the module loads
// under vitest. Must be declared BEFORE the fileWatcher import.
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import { folderNameFromProjectDir } from '../src/fileWatcher.js';

describe('folderNameFromProjectDir', () => {
  it('takes the last hyphen-separated segment of a plain repo dir', () => {
    expect(folderNameFromProjectDir('-Users-chris-projects-kuji')).toBe('kuji');
  });

  it('cuts at the worktree marker so a worktree session reads as its repo', () => {
    expect(
      folderNameFromProjectDir('-Users-chris-projects-kuji--claude-worktrees-engineer-issue-549'),
    ).toBe('kuji');
  });

  it('leaves a dir with no worktree marker unchanged in behavior', () => {
    expect(folderNameFromProjectDir('-Users-chris-projects-sip')).toBe('sip');
  });

  it('falls back to the whole (leading-hyphen-stripped) name when there are no hyphens left', () => {
    expect(folderNameFromProjectDir('kuji')).toBe('kuji');
  });

  it('handles an empty-ish dir name without throwing', () => {
    expect(folderNameFromProjectDir('')).toBe('');
    expect(folderNameFromProjectDir('---')).toBe('---');
  });

  // Pins CURRENT behavior for a hyphenated repo name -- this is a known
  // limitation (the last-hyphen-segment rule can't tell "horizon-suite" is
  // one repo name), not something this test asserts is correct. A merged PR
  // that changes it should update these two cases deliberately, not by
  // accident.
  it('takes only the last segment for a hyphenated repo name (pins existing behavior, not a fix)', () => {
    expect(folderNameFromProjectDir('-Users-chris-projects-horizon-suite')).toBe('suite');
  });

  it('the same hyphenated-repo limitation applies after cutting the worktree marker', () => {
    expect(
      folderNameFromProjectDir(
        '-Users-chris-projects-horizon-suite--claude-worktrees-engineer-issue-1',
      ),
    ).toBe('suite');
  });
});
