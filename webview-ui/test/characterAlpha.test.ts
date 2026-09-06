/**
 * Unit tests for `characterAlpha` (Tacit patch): how solid a character draws,
 * given the two independent reasons to fade it. Headless is a preference and
 * obeys its setting; stale is the office reporting it has heard nothing from
 * the session for an hour, so it ignores every setting and wins outright.
 *
 * It tests the predicate rather than the renderer that calls it, for the
 * reason spelled out in rendererEmptyAreaDim.test.ts: `tsconfig.node.json`
 * compiles `test/**` with no DOM lib, so importing renderer.ts here fails
 * `tsc -b` in code the change never touched.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { HEADLESS_CHARACTER_ALPHA, STALE_CHARACTER_ALPHA } from '../src/constants.js';
import { characterAlpha } from '../src/office/engine/characterAlpha.js';

test('an ordinary character draws solid', () => {
  assert.equal(characterAlpha({}, false), 1);
  assert.equal(characterAlpha({}, true), 1);
});

test('a headless character fades only while the setting is on', () => {
  assert.equal(characterAlpha({ isHeadless: true }, false), 1);
  assert.equal(characterAlpha({ isHeadless: true }, true), HEADLESS_CHARACTER_ALPHA);
});

test('a stale character fades whatever the headless setting says', () => {
  assert.equal(characterAlpha({ isStale: true }, false), STALE_CHARACTER_ALPHA);
  assert.equal(characterAlpha({ isStale: true }, true), STALE_CHARACTER_ALPHA);
});

test('stale wins over headless, so the two never read as one state', () => {
  assert.equal(characterAlpha({ isHeadless: true, isStale: true }, true), STALE_CHARACTER_ALPHA);
  assert.notEqual(STALE_CHARACTER_ALPHA, HEADLESS_CHARACTER_ALPHA);
});
