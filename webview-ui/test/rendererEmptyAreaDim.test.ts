/**
 * Unit tests for `renderEmptyAreaDim` (Tacit patch): the standalone render
 * pass behind "dim a room nobody is working in", covering its three skip
 * rules -- an unzoned tile, the lounge Area itself, and an occupied Area are
 * never dimmed -- plus the positive case (an empty, non-lounge, zoned tile
 * IS dimmed). No canvas is available under vitest's node environment, so a
 * minimal stub counts `fillRect` calls rather than asserting on pixels, per
 * the renderer's own testing note (mirrors rendererOccupiedAreas.test.ts).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { TILE_SIZE } from '../src/constants.js';
import { renderEmptyAreaDim } from '../src/office/engine/renderer.js';

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimal CanvasRenderingContext2D stub: records fillRect calls, no-ops
 *  everything else the pass touches (save/restore/fillStyle/globalAlpha). */
function makeCtxStub(): { ctx: CanvasRenderingContext2D; calls: FillRectCall[] } {
  const calls: FillRectCall[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    fillStyle: '',
    globalAlpha: 1,
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ x, y, w, h });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// 1x3 grid: col 0 unzoned, col 1 "Lounge", col 2 "A".
const COLS = 3;
const ROWS = 1;
const AREA_TILES: Array<string | null> = [null, 'Lounge', 'A'];

test('never dims an unzoned tile', () => {
  const { ctx, calls } = makeCtxStub();
  renderEmptyAreaDim(ctx, AREA_TILES, COLS, ROWS, 0, 0, 1, new Set(), 'Lounge');
  // Only "A" (col 2) should be dimmed; col 0 (unzoned) must contribute no call.
  assert.equal(
    calls.some((c) => c.x === 0 * TILE_SIZE),
    false,
  );
});

test('never dims the lounge Area, even though it holds no character', () => {
  const { ctx, calls } = makeCtxStub();
  renderEmptyAreaDim(ctx, AREA_TILES, COLS, ROWS, 0, 0, 1, new Set(), 'Lounge');
  // Col 1 is the lounge tile -- must never be dimmed, empty or not.
  assert.equal(
    calls.some((c) => c.x === 1 * TILE_SIZE),
    false,
  );
});

test('never dims an occupied Area', () => {
  const { ctx, calls } = makeCtxStub();
  renderEmptyAreaDim(ctx, AREA_TILES, COLS, ROWS, 0, 0, 1, new Set(['A']), 'Lounge');
  assert.equal(calls.length, 0, 'the only non-lounge, zoned tile ("A") is occupied');
});

test('dims an empty, non-lounge, zoned tile', () => {
  const { ctx, calls } = makeCtxStub();
  renderEmptyAreaDim(ctx, AREA_TILES, COLS, ROWS, 0, 0, 1, new Set(), 'Lounge');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { x: 2 * TILE_SIZE, y: 0, w: TILE_SIZE, h: TILE_SIZE });
});

test('is a no-op with no areaTiles', () => {
  const { ctx, calls } = makeCtxStub();
  renderEmptyAreaDim(ctx, undefined, COLS, ROWS, 0, 0, 1, new Set(), 'Lounge');
  assert.equal(calls.length, 0);
});
