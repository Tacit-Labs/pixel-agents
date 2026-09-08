import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  IDLE_CULL_MS,
  IDLE_GHOST_MS,
  IDLE_SWEEP_INTERVAL_MS,
  LIVE_IDLE_CULL_MS,
  LIVE_IDLE_GHOST_MS,
} from '../src/constants.js';
import {
  classifyIdle,
  lastSeenAt,
  reportedPids,
  startIdleAgentSweep,
  sweepIdleAgents,
} from '../src/idleAgentSweep.js';
import type { Liveness } from '../src/processLiveness.js';
import type { AgentState } from '../src/types.js';

/**
 * The sweep is the only thing that ends a session which died without saying
 * so: no SessionEnd hook, and a transcript still sitting on disk. Everything
 * here is about which agents that applies to and which it must leave alone.
 */
function agent(id: number, over: Partial<AgentState> = {}): AgentState {
  return {
    id,
    sessionId: `sess-${id}`,
    isExternal: true,
    projectDir: '/tmp/project',
    jsonlFile: `/tmp/project/sess-${id}.jsonl`,
    lastDataAt: 0,
    ...over,
  } as unknown as AgentState;
}

const NOW = 1_800_000_000_000;

describe('classifyIdle', () => {
  it('reads silence in three bands', () => {
    expect(classifyIdle(0)).toBe('live');
    expect(classifyIdle(IDLE_GHOST_MS - 1)).toBe('live');
    expect(classifyIdle(IDLE_GHOST_MS)).toBe('ghost');
    expect(classifyIdle(IDLE_CULL_MS - 1)).toBe('ghost');
    expect(classifyIdle(IDLE_CULL_MS)).toBe('cull');
  });

  it('reads the same three bands on the short clocks when the process is up', () => {
    expect(classifyIdle(0, true)).toBe('live');
    expect(classifyIdle(LIVE_IDLE_GHOST_MS - 1, true)).toBe('live');
    expect(classifyIdle(LIVE_IDLE_GHOST_MS, true)).toBe('ghost');
    expect(classifyIdle(LIVE_IDLE_CULL_MS - 1, true)).toBe('ghost');
    expect(classifyIdle(LIVE_IDLE_CULL_MS)).toBe('live'); // the long clocks say otherwise
    expect(classifyIdle(LIVE_IDLE_CULL_MS, true)).toBe('cull');
  });

  it('gives a live process a longer benefit of the doubt, not a permanent one', () => {
    expect(LIVE_IDLE_GHOST_MS).toBeLessThan(IDLE_GHOST_MS);
    expect(LIVE_IDLE_CULL_MS).toBeLessThan(IDLE_CULL_MS);
  });
});

describe('lastSeenAt', () => {
  it('takes whichever clock is later', () => {
    expect(lastSeenAt(agent(1, { lastDataAt: 500, lastHookAt: 900 }))).toBe(900);
    expect(lastSeenAt(agent(1, { lastDataAt: 900, lastHookAt: 500 }))).toBe(900);
  });

  it('falls back to the hook clock alone, which is the shared-office case', () => {
    // Another account's transcript is 0600, so lastDataAt never moves past
    // creation. The hook clock is all this agent has.
    expect(lastSeenAt(agent(1, { lastDataAt: 0, lastHookAt: 900 }))).toBe(900);
  });
});

describe('sweepIdleAgents', () => {
  let agents: AgentStateStore;
  let culled: number[];
  let broadcasts: Array<Record<string, unknown>>;

  beforeEach(() => {
    agents = new AgentStateStore();
    culled = [];
    broadcasts = [];
    agents.on('broadcast', (msg: Record<string, unknown>) => broadcasts.push(msg));
  });

  it('leaves a recently active agent alone', () => {
    agents.set(1, agent(1, { lastHookAt: NOW - 1000 }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
    expect(agents.get(1)?.isStale).toBeFalsy();
    expect(broadcasts).toEqual([]);
  });

  it('ghosts an agent past the ghost threshold, once', () => {
    agents.set(1, agent(1, { lastHookAt: NOW - IDLE_GHOST_MS }));

    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(agents.get(1)?.isStale).toBe(true);
    expect(broadcasts).toEqual([{ type: 'agentStale', id: 1, stale: true }]);

    // A second pass changes nothing, so it says nothing.
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(broadcasts).toHaveLength(1);
    expect(culled).toEqual([]);
  });

  it('un-ghosts an agent that has spoken since', () => {
    agents.set(1, agent(1, { lastHookAt: NOW - IDLE_GHOST_MS, isStale: true }));
    sweepIdleAgents(agents, NOW - IDLE_GHOST_MS + 1000, (id) => culled.push(id));
    expect(agents.get(1)?.isStale).toBe(false);
    expect(broadcasts).toEqual([{ type: 'agentStale', id: 1, stale: false }]);
  });

  it('culls an agent past the cull threshold', () => {
    agents.set(1, agent(1, { lastHookAt: NOW - IDLE_CULL_MS }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([1]);
  });

  it('never culls a terminal-backed agent, however quiet', () => {
    agents.set(1, agent(1, { isExternal: false, lastHookAt: NOW - IDLE_CULL_MS * 10 }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
    expect(agents.get(1)?.isStale).toBeFalsy();
  });

  it('never culls a teammate directly — its lead ends the team', () => {
    agents.set(1, agent(1, { leadAgentId: 7, lastHookAt: NOW - IDLE_CULL_MS }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
  });

  it('never culls an agent with a permission ask outstanding', () => {
    // Removing it removes the ask along with it — silently, twelve hours
    // after a director was asked something, which is exactly when nobody is
    // looking.
    agents.set(1, agent(1, { permissionSent: true, lastHookAt: NOW - IDLE_CULL_MS }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
  });

  it('culls one whose permission ask has since been answered', () => {
    // permissionSent is cleared by the next PreToolUse and by Stop, so the
    // exemption cannot outlive the ask that earned it.
    agents.set(1, agent(1, { permissionSent: false, lastHookAt: NOW - IDLE_CULL_MS }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([1]);
  });

  it('still ghosts an exempt agent seen for the first time past the cull band', () => {
    // Nothing ghosted these on the way through — the process was not running
    // when they crossed IDLE_GHOST_MS — so this pass meets them already past
    // the cull threshold. They stay, and they say they are out of contact.
    agents.set(1, agent(1, { permissionSent: true, lastHookAt: NOW - IDLE_CULL_MS }));
    agents.set(2, agent(2, { leadAgentId: 7, lastHookAt: NOW - IDLE_CULL_MS }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
    expect(agents.get(1)?.isStale).toBe(true);
    expect(agents.get(2)?.isStale).toBe(true);
    expect(broadcasts).toEqual([
      { type: 'agentStale', id: 1, stale: true },
      { type: 'agentStale', id: 2, stale: true },
    ]);
  });

  it('starts a clock rather than culling an agent that has no clock yet', () => {
    // Restored from persistence at startup: lastDataAt 0, no hook seen. Read
    // literally that is "last heard from in 1970", which would cull it on the
    // first sweep, seconds after the server came up.
    agents.set(1, agent(1, { lastDataAt: 0 }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
    expect(agents.get(1)?.lastHookAt).toBe(NOW);
  });

  describe('with a reported pid', () => {
    const alive = (pid: number) => new Map<number, Liveness>([[pid, 'alive']]);
    const gone = (pid: number) => new Map<number, Liveness>([[pid, 'gone']]);

    it('leaves a running process alone while it is only briefly quiet', () => {
      // A director reading the last turn's output has lost nothing, and the
      // character belongs on a sofa, drawn solid.
      agents.set(1, agent(1, { pid: 4242, lastHookAt: NOW - (LIVE_IDLE_GHOST_MS - 1000) }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), alive(4242));
      expect(culled).toEqual([]);
      expect(agents.get(1)?.isStale).toBeFalsy();
      expect(broadcasts).toEqual([]);
    });

    it('ghosts a running process that has gone quiet past the short threshold', () => {
      // A live pid says nothing crashed. It does not say anyone is there: the
      // desktop app holds a process per open tab for as long as the box is up.
      agents.set(1, agent(1, { pid: 4242, lastHookAt: NOW - LIVE_IDLE_GHOST_MS }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), alive(4242));
      expect(culled).toEqual([]);
      expect(agents.get(1)?.isStale).toBe(true);
      expect(broadcasts).toEqual([{ type: 'agentStale', id: 1, stale: true }]);
    });

    it('culls a running process quiet past the short cull threshold', () => {
      const reasons: string[] = [];
      agents.set(1, agent(1, { pid: 4242, lastHookAt: NOW - LIVE_IDLE_CULL_MS }));
      sweepIdleAgents(
        agents,
        NOW,
        (id, reason) => {
          culled.push(id);
          reasons.push(reason);
        },
        alive(4242),
      );
      expect(culled).toEqual([1]);
      expect(reasons).toEqual(['idle']);
    });

    it('never culls a running process with a permission ask outstanding', () => {
      // Unlike a gone process, this one could still be answered.
      agents.set(
        1,
        agent(1, { pid: 4242, permissionSent: true, lastHookAt: NOW - LIVE_IDLE_CULL_MS * 10 }),
      );
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), alive(4242));
      expect(culled).toEqual([]);
      expect(agents.get(1)?.isStale).toBe(true);
    });

    it('un-ghosts one the clocks had ghosted once the OS says it is running', () => {
      agents.set(1, agent(1, { pid: 4242, isStale: true, lastHookAt: NOW - 1000 }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), alive(4242));
      expect(agents.get(1)?.isStale).toBe(false);
      expect(broadcasts).toEqual([{ type: 'agentStale', id: 1, stale: false }]);
    });

    it('culls an agent whose process is gone on the sweep that notices', () => {
      // Seconds of silence, not hours: the process is the evidence.
      const reasons: string[] = [];
      agents.set(1, agent(1, { pid: 4242, lastHookAt: NOW - 1000 }));
      sweepIdleAgents(
        agents,
        NOW,
        (id, reason) => {
          culled.push(id);
          reasons.push(reason);
        },
        gone(4242),
      );
      expect(culled).toEqual([1]);
      expect(reasons).toEqual(['gone']);
    });

    it('culls a gone process even with a permission ask outstanding', () => {
      // Nobody can answer an ask whose session no longer exists.
      agents.set(1, agent(1, { pid: 4242, permissionSent: true, lastHookAt: NOW - 1000 }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), gone(4242));
      expect(culled).toEqual([1]);
    });

    it('still leaves a teammate to its lead when the process is gone', () => {
      agents.set(1, agent(1, { pid: 4242, leadAgentId: 7, lastHookAt: NOW - 1000 }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), gone(4242));
      expect(culled).toEqual([]);
    });

    it('falls back to the clocks when the OS has no answer for the pid', () => {
      // ps unavailable, or the control pid missing from its output: the map
      // is empty and the sweep behaves exactly as before pids existed.
      agents.set(1, agent(1, { pid: 4242, lastHookAt: NOW - IDLE_GHOST_MS }));
      sweepIdleAgents(agents, NOW, (id) => culled.push(id), new Map());
      expect(agents.get(1)?.isStale).toBe(true);
      expect(culled).toEqual([]);
    });

    it('reports the silent reason for a clock-driven cull', () => {
      const reasons: string[] = [];
      agents.set(1, agent(1, { lastHookAt: NOW - IDLE_CULL_MS }));
      sweepIdleAgents(agents, NOW, (_id, reason) => reasons.push(reason));
      expect(reasons).toEqual(['silent']);
    });
  });

  describe('reportedPids', () => {
    it('collects each external agent pid once, skipping terminal-backed agents', () => {
      agents.set(1, agent(1, { pid: 10 }));
      agents.set(2, agent(2, { pid: 10 }));
      agents.set(3, agent(3, { pid: 11, isExternal: false }));
      agents.set(4, agent(4));
      expect(reportedPids(agents)).toEqual([10]);
    });
  });

  describe('startIdleAgentSweep', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('probes every reported pid and sweeps with the answers', async () => {
      const probed: number[][] = [];
      agents.set(1, agent(1, { pid: 4242, lastHookAt: Date.now() }));
      const timer = startIdleAgentSweep(
        agents,
        (id) => culled.push(id),
        async (pids) => {
          probed.push(pids);
          return new Map<number, Liveness>([[4242, 'gone']]);
        },
      );
      await vi.advanceTimersByTimeAsync(IDLE_SWEEP_INTERVAL_MS);
      clearInterval(timer);
      expect(probed).toEqual([[4242]]);
      expect(culled).toEqual([1]);
    });

    it('treats a probe failure as no answer', async () => {
      agents.set(1, agent(1, { pid: 4242, lastHookAt: Date.now() }));
      const timer = startIdleAgentSweep(
        agents,
        (id) => culled.push(id),
        async () => {
          throw new Error('no ps here');
        },
      );
      await vi.advanceTimersByTimeAsync(IDLE_SWEEP_INTERVAL_MS);
      clearInterval(timer);
      expect(culled).toEqual([]);
      expect(agents.get(1)?.isStale).toBeFalsy();
    });
  });

  it('culls every eligible agent in one pass', () => {
    agents.set(1, agent(1, { lastHookAt: NOW - IDLE_CULL_MS }));
    agents.set(2, agent(2, { lastHookAt: NOW - IDLE_CULL_MS }));
    agents.set(3, agent(3, { lastHookAt: NOW - 1000 }));
    sweepIdleAgents(agents, NOW, (id) => {
      culled.push(id);
      agents.delete(id);
    });
    expect(culled).toEqual([1, 2]);
    expect([...agents.keys()]).toEqual([3]);
  });
});
