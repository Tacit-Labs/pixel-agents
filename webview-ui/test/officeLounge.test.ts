/**
 * Unit tests for the idle-to-lounge bench (Tacit patch): a character
 * continuously inactive past LOUNGE_IDLE_SEC is walked to a free tile inside
 * the Area named by OfficeState.loungeArea, frozen there (skipping the
 * ordinary inactive wander/seat-rest cycle) until reactivated, at which point
 * setAgentActive(id, true) sends it back to its own seat.
 *
 * Mirrors agentPalette.test.ts / greeter.test.ts / teammateSeating.test.ts in
 * constructing a real OfficeState directly rather than a fake, and in
 * injecting a seat straight into `os.seats` rather than routing through the
 * furniture catalog (which needs loaded asset manifests) — the same
 * shortcut those files use to keep this a fast, catalog-free unit test of
 * the OfficeState DOMAIN MODEL.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { LOUNGE_IDLE_SEC } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

/** All-floor layout, no furniture — no catalog needed, every tile walkable.
 *  Tile (4, 2) is labeled "Lounge"; every other tile is unzoned. */
function loungeLayout(cols = 6, rows = 4): OfficeLayout {
  const areaTiles = new Array<string | null>(cols * rows).fill(null);
  areaTiles[2 * cols + 4] = 'Lounge';
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
    // `areas` (label -> display color) is a rendering-only concern and unread
    // by any OfficeState lounge logic under test here, so it's omitted.
    areaTiles,
  };
}

/** Seat one tile left of the lounge tile — adjacent, so a dispatched walk is
 *  a single-step path and settles in a couple of deterministic ticks. */
function seatOffice(): { os: OfficeState; seatUid: string } {
  const os = new OfficeState(loungeLayout());
  const seatUid = 'seat-1';
  os.seats.set(seatUid, {
    uid: seatUid,
    seatCol: 3,
    seatRow: 2,
    facingDir: Direction.DOWN,
    assigned: false,
  });
  return { os, seatUid };
}

test('an agent inactive past LOUNGE_IDLE_SEC is pathed into the lounge Area', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true); // skip spawn effect: keeps update() call counts matching the comments below
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  assert.equal(ch.seatId, seatUid, 'sanity: seated before going idle');
  ch.inactiveSec = LOUNGE_IDLE_SEC; // skip the real-time wait

  os.update(1); // dispatch to the lounge tile + first (only) walk step
  os.update(1); // arrival: WALK-complete transitions to IDLE
  os.update(1); // frozen tick: inLounge + inactive + not WALK => no FSM tick

  assert.equal(ch.inLounge, true);
  assert.equal(ch.tileCol, 4, 'walked onto the lounge tile');
  assert.equal(ch.tileRow, 2);
  assert.equal(ch.state, CharacterState.IDLE, 'parked, not mid-walk');
});

test('a character heads for the lounge on the first tick after its turn ends', () => {
  // LOUNGE_IDLE_SEC is zero: no real-time wait, nothing set by hand. The
  // Stop that ends a turn is what the server turns into setAgentActive(false),
  // and the very next update() must already have the character walking.
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  assert.equal(ch.inLounge, false, 'sanity: not benched before any tick');
  os.update(0.016);
  assert.equal(ch.inLounge, true, 'dispatched on the first frame');
  assert.equal(ch.state, CharacterState.WALK, 'and already walking');
});

test('the next hook event sends a benched character back to its desk', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);
  const ch = os.characters.get(1)!;
  os.update(1);
  os.update(1);
  assert.equal(ch.inLounge, true, 'sanity: benched');

  // A PreToolUse arrives: agentStatus active.
  os.setAgentActive(1, true);
  assert.equal(ch.inLounge, false, 'no longer benched');
  assert.equal(ch.seatId, seatUid, 'still owns its desk');
  assert.equal(ch.state, CharacterState.WALK, 'walking back');
});

test('a stale waitingAwaitingInput flag does not block the lounge (regression)', () => {
  // agentStatus{waiting, awaitingInput:true} -> showWaitingBubble(id, true) is
  // what the server sends for Claude Code's Notification(idle_prompt), which
  // means "this REPL has been idle 60 seconds" -- not "a director was asked
  // something" -- and nothing ever clears ch.waitingAwaitingInput afterward.
  // Gating the lounge on it (the original bug) latches every idle session at
  // T+60s and blocks it from ever benching, forever. Drive the SAME public
  // API the server drives, not the field directly, so this test would have
  // caught that bug.
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);
  os.showWaitingBubble(1, true);

  const ch = os.characters.get(1)!;
  assert.equal(ch.waitingAwaitingInput, true, 'sanity: latched, as any idle session would be');
  ch.inactiveSec = LOUNGE_IDLE_SEC; // skip the real-time wait

  os.update(1);
  os.update(1);
  os.update(1);

  assert.equal(ch.inLounge, true, 'a stale awaitingInput flag must not block lounging');
  assert.equal(ch.tileCol, 4, 'walked onto the lounge tile');
  assert.equal(ch.tileRow, 2);
});

test('a character with a permission bubble is never sent to the lounge either', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.bubbleType = 'permission';
  ch.inactiveSec = LOUNGE_IDLE_SEC;

  os.update(1);
  os.update(1);
  os.update(1);

  assert.equal(ch.inLounge, false);
});

test('setAgentActive(id, true) sends a lounged character back to its seat', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC;
  os.update(1);
  os.update(1);
  os.update(1);
  assert.equal(ch.inLounge, true, 'sanity: benched before reactivating');

  os.setAgentActive(1, true);

  assert.equal(ch.inLounge, false, 'no longer flagged as benched');
  assert.equal(ch.isActive, true);
  assert.equal(ch.state, CharacterState.WALK, 'sendToSeat pathed it away from the lounge tile');
  assert.deepEqual(
    ch.path[ch.path.length - 1],
    { col: 3, row: 2 },
    'final path step is its own seat',
  );
});

test('setAgentActive(id, true) un-benches a lounged character even when its seat is gone', () => {
  // rebuildFromLayout nulls seatId when a character can't be re-seated (its
  // desk was deleted). sendToSeat itself returns early in that case, before
  // ever reaching its own ch.inLounge = false -- so setAgentActive must clear
  // the flag unconditionally rather than relying on sendToSeat to do it.
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC;
  os.update(1);
  os.update(1);
  os.update(1);
  assert.equal(ch.inLounge, true, 'sanity: benched before its desk disappears');

  ch.seatId = null; // simulates rebuildFromLayout after the desk was deleted

  os.setAgentActive(1, true);

  assert.equal(
    ch.inLounge,
    false,
    'no longer flagged as benched, despite having no seat to return to',
  );
  assert.equal(ch.isActive, true);

  // Resumes the ordinary cycle: on the next tick, an active seatless
  // character types in place (characters.ts' IDLE case), rather than staying
  // frozen where tickLounge would otherwise have parked it.
  os.update(0.1);
  assert.equal(ch.state, CharacterState.TYPE);
});

test('walkToTile on a lounged character ends the bench', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC;
  os.update(1);
  os.update(1);
  os.update(1);
  assert.equal(ch.inLounge, true, 'sanity: benched before the external command');

  const moved = os.walkToTile(1, 0, 0);

  assert.equal(moved, true);
  assert.equal(ch.inLounge, false, 'an externally commanded move ends the bench');
});

test('sendToSeat on a lounged character ends the bench', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC;
  os.update(1);
  os.update(1);
  os.update(1);
  assert.equal(ch.inLounge, true, 'sanity: benched before the external command');

  os.sendToSeat(1);

  assert.equal(ch.inLounge, false, 'an externally commanded move ends the bench');
});

test('with no loungeArea configured, an inactive agent is left exactly where it was', () => {
  const { os, seatUid } = seatOffice();
  // loungeArea left at its default (null) — no setLoungeArea call.
  os.addAgent(1, 0, 0, seatUid, true);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC + 10;

  os.update(1);
  os.update(1);

  assert.equal(ch.inLounge, false);
  assert.equal(
    ch.tileCol,
    3,
    'no lounge configured -- never leaves its own seat tile via lounging',
  );
  assert.equal(ch.tileRow, 2);
});

test('a full lounge (no free tile) leaves the agent exactly where it was', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid, true);
  // A second agent occupies the only lounge tile directly (no seat needed for
  // this stand-in -- addAgent falls back to a walkable-tile spawn when no
  // free seat exists, and every tile here besides the seat is unzoned except
  // the lounge tile itself, so it has nowhere else to land).
  os.addAgent(2, 1, 0, undefined, true);
  const blocker = os.characters.get(2)!;
  blocker.tileCol = 4;
  blocker.tileRow = 2;

  os.setAgentActive(1, false);
  const ch = os.characters.get(1)!;
  ch.inactiveSec = LOUNGE_IDLE_SEC;

  os.update(1);

  assert.equal(ch.inLounge, false, 'no free lounge tile -- behaves as today');
  assert.equal(ch.tileCol, 3);
  assert.equal(ch.tileRow, 2);
});

test('two characters crossing the threshold in the same frame do not stack on the same lounge tile', () => {
  // Two lounge tiles, (4,2) and (5,2) -- both closer to each seat than any
  // other free tile, so without reserving an in-flight destination both
  // characters would independently compute the SAME nearest tile (4,2) and
  // walk onto each other.
  const layout = loungeLayout(7, 4);
  layout.areaTiles![2 * 7 + 5] = 'Lounge';
  const os = new OfficeState(layout);
  os.seats.set('seat-1', {
    uid: 'seat-1',
    seatCol: 3,
    seatRow: 2,
    facingDir: Direction.DOWN,
    assigned: false,
  });
  os.seats.set('seat-2', {
    uid: 'seat-2',
    seatCol: 1,
    seatRow: 2,
    facingDir: Direction.DOWN,
    assigned: false,
  });
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, 'seat-1', true);
  os.addAgent(2, 1, 0, 'seat-2', true);
  os.setAgentActive(1, false);
  os.setAgentActive(2, false);
  os.characters.get(1)!.inactiveSec = LOUNGE_IDLE_SEC;
  os.characters.get(2)!.inactiveSec = LOUNGE_IDLE_SEC;

  os.update(1); // both cross the threshold and dispatch in this one frame

  const a = os.characters.get(1)!;
  const b = os.characters.get(2)!;
  assert.equal(a.inLounge, true);
  assert.equal(b.inLounge, true);
  const destOf = (ch: typeof a) =>
    ch.path.length > 0 ? ch.path[ch.path.length - 1] : { col: ch.tileCol, row: ch.tileRow };
  assert.notDeepEqual(destOf(a), destOf(b), 'must be heading to two different lounge tiles');
});
