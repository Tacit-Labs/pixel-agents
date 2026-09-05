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
});

test("an owner's mapped colour is stable across agents created at different times", () => {
  // The rendered colour is the (palette, hueShift) PAIR, and pickDiversePalette
  // hands a random 45-315 degree hueShift to every agent past the first six --
  // the normal case on a shared office. hookEventHandler.applyLabel now always
  // sends hueShift explicitly (0) alongside a mapped palette, so two agents
  // owned by the same director -- one an early agent that landed on hueShift
  // 0, one a later one that landed on a nonzero shift -- must render
  // IDENTICALLY once the mapping applies to both, not merely share a palette
  // index while differing in hue tint.
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 2, 0);
  os.addAgent(2, 2, 90);

  os.setAgentPalette(1, 4, 0);
  os.setAgentPalette(2, 4, 0);

  const a = os.characters.get(1)!;
  const b = os.characters.get(2)!;
  assert.equal(a.palette, b.palette);
  assert.equal(a.hueShift, b.hueShift);
  assert.equal(a.hueShift, 0, 'a mapped colour is never tinted');
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
