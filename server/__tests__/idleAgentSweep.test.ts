import { beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { IDLE_CULL_MS, IDLE_GHOST_MS } from '../src/constants.js';
import { classifyIdle, lastSeenAt, sweepIdleAgents } from '../src/idleAgentSweep.js';
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

  it('starts a clock rather than culling an agent that has no clock yet', () => {
    // Restored from persistence at startup: lastDataAt 0, no hook seen. Read
    // literally that is "last heard from in 1970", which would cull it on the
    // first sweep, seconds after the server came up.
    agents.set(1, agent(1, { lastDataAt: 0 }));
    sweepIdleAgents(agents, NOW, (id) => culled.push(id));
    expect(culled).toEqual([]);
    expect(agents.get(1)?.lastHookAt).toBe(NOW);
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
