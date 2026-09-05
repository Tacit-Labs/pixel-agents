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
  os.addAgent(1, 0, 0, seatUid);
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

test('a character still waiting on the director is never sent to the lounge', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid);
  os.setAgentActive(1, false);

  const ch = os.characters.get(1)!;
  // The waiting BUBBLE SPRITE (bubbleType) is long gone by the time
  // LOUNGE_IDLE_SEC elapses -- it clears itself after WAITING_BUBBLE_DURATION_SEC
  // (2s). waitingAwaitingInput is the signal that survives that long, and the
  // one ToolOverlay's own "Waiting for input" label is driven by -- so it must
  // be what gates the bench, not the already-faded bubble.
  ch.bubbleType = null;
  ch.waitingAwaitingInput = true;
  ch.inactiveSec = LOUNGE_IDLE_SEC;

  os.update(1);
  os.update(1);
  os.update(1);

  assert.equal(ch.inLounge, false);
  assert.equal(ch.tileCol, 3, 'still at its own seat tile');
  assert.equal(ch.tileRow, 2);
});

test('a character with a permission bubble is never sent to the lounge either', () => {
  const { os, seatUid } = seatOffice();
  os.setLoungeArea('Lounge');
  os.addAgent(1, 0, 0, seatUid);
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
  os.addAgent(1, 0, 0, seatUid);
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

test('with no loungeArea configured, an inactive agent is left exactly where it was', () => {
  const { os, seatUid } = seatOffice();
  // loungeArea left at its default (null) — no setLoungeArea call.
  os.addAgent(1, 0, 0, seatUid);
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
  os.addAgent(1, 0, 0, seatUid);
  // A second agent occupies the only lounge tile directly (no seat needed for
  // this stand-in -- addAgent falls back to a walkable-tile spawn when no
  // free seat exists, and every tile here besides the seat is unzoned except
  // the lounge tile itself, so it has nowhere else to land).
  os.addAgent(2, 1, 0);
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
