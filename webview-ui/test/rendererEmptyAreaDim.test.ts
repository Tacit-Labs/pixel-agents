/**
 * Unit tests for `shouldDimAreaTile` (Tacit patch): the decision behind "dim a
 * room nobody is working in", covering its three skip rules -- an unzoned
 * tile, the lounge Area itself, and an occupied Area are never dimmed -- plus
 * the positive case (an empty, non-lounge, zoned tile IS dimmed).
 *
 * It tests the predicate rather than `renderEmptyAreaDim`, whose signature
 * names `CanvasRenderingContext2D`. `tsconfig.node.json` compiles `test/**`
 * with no DOM lib, so importing renderer.ts from here fails `tsc -b` with
 * 30-odd errors in untouched code, which is what broke the Mini's build on
 * 2026-09-06. The render pass is one loop around this predicate; see
 * `src/office/engine/areaDim.ts`.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { shouldDimAreaTile } from '../src/office/engine/areaDim.js';

const LOUNGE = 'Lounge';

test('never dims an unzoned tile', () => {
  assert.equal(shouldDimAreaTile(null, new Set(), LOUNGE), false);
  assert.equal(shouldDimAreaTile(undefined, new Set(), LOUNGE), false);
});

test('never dims the lounge Area, empty or not', () => {
  assert.equal(shouldDimAreaTile(LOUNGE, new Set(), LOUNGE), false);
  assert.equal(shouldDimAreaTile(LOUNGE, new Set([LOUNGE]), LOUNGE), false);
});

test('never dims an Area holding a character', () => {
  assert.equal(shouldDimAreaTile('A', new Set(['A']), LOUNGE), false);
});

test('dims an empty, non-lounge, zoned tile', () => {
  assert.equal(shouldDimAreaTile('A', new Set(), LOUNGE), true);
  assert.equal(shouldDimAreaTile('A', new Set(['B']), LOUNGE), true);
});

test('with no lounge configured, only zoning and occupancy decide', () => {
  assert.equal(shouldDimAreaTile('A', new Set(), null), true);
  assert.equal(shouldDimAreaTile('A', new Set(['A']), undefined), false);
  assert.equal(shouldDimAreaTile(null, new Set(), null), false);
});
