import type { AgentStateStore } from './agentStateStore.js';
import { IDLE_CULL_MS, IDLE_GHOST_MS, IDLE_SWEEP_INTERVAL_MS } from './constants.js';
import type { AgentState } from './types.js';

/**
 * Age out agents nothing has been heard from (Tacit patch).
 *
 * An agent leaves the office by exactly two routes today: a SessionEnd hook,
 * or its transcript disappearing (startStaleExternalAgentCheck, ENOENT only).
 * Both are evidence-driven, and both are missing whenever a session dies
 * without saying so -- an ssh drop, a closed terminal, kill -9, a machine
 * rebooting mid-turn. Claude Code emits no SessionEnd for any of those, and
 * the transcript it leaves behind is a perfectly healthy file, so the
 * character sits at its desk (and, past LOUNGE_IDLE_SEC, in the lounge) until
 * someone restarts the server. On an always-on shared office that is days.
 *
 * This is the missing third route: a clock. Silence past IDLE_GHOST_MS ghosts
 * the character -- still there, visibly not working -- and silence past
 * IDLE_CULL_MS removes it. The two thresholds are deliberately far apart: the
 * ghost is the part a director reads, the cull is only bookkeeping catching up
 * with what the ghost already said.
 *
 * Deliberately NOT dismissing the transcript on a cull, unlike closeAgent: a
 * culled session may simply have been quiet, and the next hook event it sends
 * should bring its character straight back via adoptLiveSession. A cull is a
 * statement about what we have heard, not about whether the session exists.
 */
export type IdleVerdict = 'live' | 'ghost' | 'cull';

export function classifyIdle(idleMs: number): IdleVerdict {
  if (idleMs >= IDLE_CULL_MS) return 'cull';
  if (idleMs >= IDLE_GHOST_MS) return 'ghost';
  return 'live';
}

/**
 * When this agent was last heard from, by either clock.
 *
 * `lastDataAt` is transcript-driven and stops updating the moment the file
 * cannot be read -- which on a shared box is every session but the server's
 * own, since Claude Code writes transcripts 0600. `lastHookAt` is set on
 * every delivered hook event, so it keeps ticking for exactly the agents the
 * transcript clock cannot see. Taking the max means neither has to be
 * complete on its own.
 */
export function lastSeenAt(agent: AgentState): number {
  return Math.max(agent.lastDataAt ?? 0, agent.lastHookAt ?? 0);
}

/**
 * One pass. Ghost flags flip through the store's broadcast (so every connected
 * client agrees), culls are handed to the caller, which owns agent removal.
 */
export function sweepIdleAgents(
  agents: AgentStateStore,
  now: number,
  cull: (id: number) => void,
): void {
  const toCull: number[] = [];

  for (const [id, agent] of agents) {
    // A terminal-backed agent is never culled: it has a terminal to focus,
    // and its silence says nothing about whether the session is still there.
    // Same guard the transcript stale check applies.
    if (!agent.isExternal) continue;

    const seen = lastSeenAt(agent);
    if (seen === 0) {
      // No clock yet -- an agent restored from persistence at startup, or one
      // created before its first event. Start the clock here rather than
      // reading "never" as "12 hours ago" and culling it on the first sweep.
      agent.lastHookAt = now;
      continue;
    }

    const verdict = classifyIdle(now - seen);

    if (verdict === 'cull') {
      // Teammates die with their lead (removeTeammates), so culling one
      // directly would race that path and leave the lead's children
      // half-removed. The lead's own silence is what ends the team.
      if (agent.leadAgentId !== undefined) continue;
      toCull.push(id);
      continue;
    }

    const stale = verdict === 'ghost';
    if ((agent.isStale ?? false) === stale) continue;
    agent.isStale = stale;
    agents.broadcast({ type: 'agentStale', id, stale });
  }

  // Collected first: cull() removes from the store the loop is walking.
  for (const id of toCull) cull(id);
}

export function startIdleAgentSweep(
  agents: AgentStateStore,
  cull: (id: number) => void,
): ReturnType<typeof setInterval> {
  return setInterval(() => sweepIdleAgents(agents, Date.now(), cull), IDLE_SWEEP_INTERVAL_MS);
}
