/**
 * Unit test for `OfficeState.setAgentPalette` (Tacit patch): an avatar can be
 * recolored by the director who owns it once its label resolves, not only at
 * creation. Mirrors greeter.test.ts / teammateSeating.test.ts / petEntity.test.ts
 * in constructing a real OfficeState directly rather than a fake — this is the
 * OfficeState DOMAIN MODEL, not UI internals, so a unit test is the right tool
 * (see greeter.test.ts's header for the "E2E over webview unit tests" carve-out).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

/** All-floor layout, no furniture — no catalog needed, every tile walkable. */
function floorLayout(cols = 9, rows = 7): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

test('setAgentPalette changes the character palette', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0);

  os.setAgentPalette(1, 3);

  const ch = os.characters.get(1)!;
  assert.equal(ch.palette, 3);
  assert.equal(ch.hueShift, 0, 'hueShift left untouched when not given');
});

test('setAgentPalette also updates hueShift when given', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0);

  os.setAgentPalette(1, 2, 90);

  const ch = os.characters.get(1)!;
  assert.equal(ch.palette, 2);
  assert.equal(ch.hueShift, 90);
});

test('setAgentPalette on an unknown id is a no-op', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0);

  os.setAgentPalette(999, 5);

  assert.equal(os.characters.has(999), false);
  assert.equal(os.characters.get(1)!.palette, 0, 'existing agent untouched');
});
