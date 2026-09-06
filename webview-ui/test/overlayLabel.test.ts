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
  nameLeadsPanel,
  PERMISSION_ACTIVITY_TEXT,
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
