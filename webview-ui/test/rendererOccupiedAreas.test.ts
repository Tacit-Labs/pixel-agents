/**
 * Unit tests for `occupiedAreaLabels` (Tacit patch): the pure helper behind
 * "dim a room nobody is working in" — renderTileGrid dims the floor/wall
 * tiles of any Area holding no character, using this Set to know which
 * Areas count as occupied this frame. Kept as a canvas-free unit test per the
 * renderer's own testing note (a pixel-level assertion would need a real
 * canvas); this only exercises the pure occupancy computation, mirroring the
 * "minimal Character stub" pattern from petEntity.test.ts.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { occupiedAreaLabels } from '../src/office/engine/areaDim.js';
import type { Character } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

/** Minimal Character stub (only fields occupiedAreaLabels reads: tileCol/tileRow). */
function makeChar(id: number, col: number, row: number): Character {
  return {
    id,
    state: CharacterState.TYPE,
    dir: Direction.DOWN,
    x: col * 16 + 8,
    y: row * 16 + 8,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 5,
    isActive: true,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    inactiveSec: 0,
    inLounge: false,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: 200_000,
  };
}

const COLS = 5;

/** 3x5 grid, tiles labeled row-major: row0 = "A", row1 = null (unzoned), row2 = "B". */
function areaTiles(): Array<string | null> {
  return ['A', 'A', 'A', 'A', 'A', null, null, null, null, null, 'B', 'B', 'B', 'B', 'B'];
}

test('returns the label of every Area a character currently stands in', () => {
  const characters = [makeChar(1, 2, 0), makeChar(2, 4, 2)];
  const labels = occupiedAreaLabels(characters, areaTiles(), COLS);
  assert.deepEqual([...labels].sort(), ['A', 'B']);
});

test('a character on an unzoned tile contributes no label', () => {
  const characters = [makeChar(1, 0, 1)];
  const labels = occupiedAreaLabels(characters, areaTiles(), COLS);
  assert.equal(labels.size, 0);
});

test('an Area with no character in it is absent from the set', () => {
  const characters = [makeChar(1, 2, 0)]; // only "A" is occupied
  const labels = occupiedAreaLabels(characters, areaTiles(), COLS);
  assert.equal(labels.has('A'), true);
  assert.equal(labels.has('B'), false);
});

test('two characters in the same Area contribute one label, not two', () => {
  const characters = [makeChar(1, 0, 0), makeChar(2, 4, 0)]; // both row 0 = "A"
  const labels = occupiedAreaLabels(characters, areaTiles(), COLS);
  assert.deepEqual([...labels], ['A']);
});

test('returns empty when there is no areaTiles array', () => {
  const characters = [makeChar(1, 2, 0)];
  assert.equal(occupiedAreaLabels(characters, undefined, COLS).size, 0);
  assert.equal(occupiedAreaLabels(characters, [], COLS).size, 0);
});

test('returns empty for an empty character list', () => {
  assert.equal(occupiedAreaLabels([], areaTiles(), COLS).size, 0);
});
