/**
 * The two pure decisions behind "dim a room nobody is working in" (Tacit
 * patch), kept out of renderer.ts so they can be unit tested.
 *
 * WHY THEIR OWN FILE. `webview-ui/tsconfig.node.json` compiles `test/**` with
 * `lib: ["ES2023"]` and no DOM, so a test that imports renderer.ts drags every
 * `CanvasRenderingContext2D` in that file into a project that has no such
 * type: `tsc -b` then fails with 30-odd errors in code nobody touched. Vitest
 * never notices, because it does not typecheck, and neither does the root
 * `check-types`, which covers `adapters/`, `server/` and `core/` but not this
 * package. Holding the policy here lets the tests import it without a canvas.
 */

import type { Character } from '../types.js';

/**
 * Distinct Area labels currently occupied by at least one character (the
 * greeter included, since it renders like one), keyed off each character's
 * live tile position. Pure and cheap, a handful of characters, so it is
 * rebuilt every frame rather than cached.
 */
export function occupiedAreaLabels(
  characters: Character[],
  areaTiles: Array<string | null> | undefined,
  cols: number,
): Set<string> {
  const out = new Set<string>();
  if (!areaTiles || areaTiles.length === 0 || cols <= 0) return out;
  for (const ch of characters) {
    const label = areaTiles[ch.tileRow * cols + ch.tileCol];
    if (label) out.add(label);
  }
  return out;
}

/**
 * Should this tile be dimmed? Three skip rules, in order: an unzoned tile is
 * never dimmed, the lounge is never dimmed (idle characters are sent there, so
 * dimming it would darken the room most likely to hold someone), and an Area
 * holding a character is not empty.
 */
export function shouldDimAreaTile(
  label: string | null | undefined,
  occupiedAreas: Set<string>,
  loungeArea: string | null | undefined,
): boolean {
  if (!label) return false;
  if (label === loungeArea) return false;
  return !occupiedAreas.has(label);
}
