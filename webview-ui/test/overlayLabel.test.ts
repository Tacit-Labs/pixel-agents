/**
 * Unit tests for `nameLeadsPanel` (Tacit patch): which of the label panel's two
 * lines gets the large type. The name normally leads and the tool status drops
 * to the small line under it; the two states that ask the director for
 * something keep the large line instead.
 *
 * It tests the predicate rather than ToolOverlay.tsx, which pulls React and the
 * DOM into a project (`tsconfig.node.json`) compiled without them — the same
 * hazard rendererEmptyAreaDim.test.ts documents.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  ASK_ACTIVITY_TEXT,
  nameLeadsPanel,
  PERMISSION_ACTIVITY_TEXT,
  shortActivityText,
  WAITING_INPUT_ACTIVITY_TEXT,
} from '../src/office/components/overlayLabel.js';

test('a labelled session leads with its name, not the command it is running', () => {
  assert.equal(nameLeadsPanel('chris · director', 'Running cd ~/projects/kuji'), true);
  assert.equal(nameLeadsPanel('chris · engineer · issue-549', 'Reading foo.ts'), true);
  assert.equal(nameLeadsPanel('LEAD', 'Idle'), true);
});

test('an unlabelled session is unchanged: the activity keeps the large line', () => {
  assert.equal(nameLeadsPanel(null, 'Reading foo.ts'), false);
  assert.equal(nameLeadsPanel('', 'Reading foo.ts'), false);
});

test('a state that asks the director for something outranks the name', () => {
  assert.equal(nameLeadsPanel('chris · director', PERMISSION_ACTIVITY_TEXT), false);
  assert.equal(nameLeadsPanel('chris · director', WAITING_INPUT_ACTIVITY_TEXT), false);
});

test('the demoted line is cut to one word', () => {
  // Every shape the Claude provider's formatToolStatus produces.
  assert.equal(shortActivityText('Running: cd ~/tacit-claude/.claude/worktrees/x'), 'Running');
  assert.equal(shortActivityText('Reading officeState.ts'), 'Reading');
  assert.equal(shortActivityText('Editing notebook'), 'Editing');
  assert.equal(shortActivityText('Searching files'), 'Searching');
  assert.equal(shortActivityText('Fetching web content'), 'Fetching');
  assert.equal(shortActivityText('Subtask: audit the deps'), 'Subtask');
  assert.equal(shortActivityText('Creating team: reviewers'), 'Creating');
});

test('a status that is already one word is left alone', () => {
  assert.equal(shortActivityText('Idle'), 'Idle');
  assert.equal(shortActivityText('Planning'), 'Planning');
});

test('an empty status yields the original rather than an empty line', () => {
  assert.equal(shortActivityText(''), '');
  assert.equal(shortActivityText('   '), '   ');
});

test('the three director-facing states never reach the shortener', () => {
  // They lead the panel instead, in full — "Waiting" alone would say nothing.
  for (const s of [PERMISSION_ACTIVITY_TEXT, WAITING_INPUT_ACTIVITY_TEXT, ASK_ACTIVITY_TEXT]) {
    assert.equal(nameLeadsPanel('chris · director', s), false);
  }
});
