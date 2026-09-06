import type { AgentStateStore } from './agentStateStore.js';
import { IDLE_CULL_MS, IDLE_GHOST_MS, IDLE_SWEEP_INTERVAL_MS } from './constants.js';
import { type LivenessMap, probeLiveness } from './processLiveness.js';
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
 *
 * A ghost is never wrong in the same way a cull can be, which is why the two
 * exemptions below apply only to the cull: an agent that must not be removed
 * is still an agent nobody has heard from, and saying so costs nothing.
 *
 * Silence is only the fallback, though. An agent whose hook wrapper reported
 * its pid is judged by the OS instead (processLiveness.ts): a running Claude
 * process is 'live' however long it has been quiet, because a director who
 * left a session open at a prompt has not lost anything, and the lounge is
 * where that character belongs, drawn solid. A process that is gone is
 * culled on the sweep that notices, not twelve hours later. The two silence
 * thresholds still apply to any agent the OS cannot answer for.
 */
export type IdleVerdict = 'live' | 'ghost' | 'cull';

/** Why an agent was culled: its process is gone, or nothing has been heard
 *  from it for IDLE_CULL_MS and it never reported a pid. */
export type CullReason = 'gone' | 'silent';

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
  cull: (id: number, reason: CullReason) => void,
  liveness: LivenessMap = new Map(),
): void {
  const toCull: Array<[number, CullReason]> = [];

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

    // The OS's answer beats the clocks whenever there is one.
    const known = agent.pid !== undefined ? liveness.get(agent.pid) : undefined;
    if (known === 'gone' && agent.leadAgentId === undefined) {
      // No process, no session: nothing a director could still answer, so
      // the permission exemption below does not apply. A teammate still goes
      // with its lead, whose own pid check ends the team.
      toCull.push([id, 'gone']);
      continue;
    }
    const verdict: IdleVerdict = known === 'alive' ? 'live' : classifyIdle(now - seen);

    // Two agents are never culled, however long the silence runs.
    //
    // A teammate dies with its lead (removeTeammates), so removing one
    // directly would race that path and leave the lead's children
    // half-removed. The lead's own silence is what ends the team.
    //
    // An agent with a permission ask outstanding is asking a director for
    // something, and removing the character removes the ask along with it —
    // silently, twelve hours after it was raised, which is exactly when
    // nobody is looking. It stays, and the ghost below says how long it has
    // been standing there unanswered.
    const cullExempt = agent.leadAgentId !== undefined || agent.permissionSent;

    if (verdict === 'cull' && !cullExempt) {
      toCull.push([id, 'silent']);
      continue;
    }

    // Anything still here past IDLE_GHOST_MS is ghosted — including an exempt
    // agent past the cull threshold, which would otherwise miss its ghost
    // entirely if the two thresholds were crossed between one sweep and the
    // next (a laptop asleep overnight does exactly that).
    const stale = verdict !== 'live';
    if ((agent.isStale ?? false) === stale) continue;
    agent.isStale = stale;
    agents.broadcast({ type: 'agentStale', id, stale });
  }

  // Collected first: cull() removes from the store the loop is walking.
  for (const [id, reason] of toCull) cull(id, reason);
}

/** Every pid the sweep would want an answer for. */
export function reportedPids(agents: AgentStateStore): number[] {
  const pids = new Set<number>();
  for (const agent of agents.values()) {
    if (agent.isExternal && agent.pid !== undefined) pids.add(agent.pid);
  }
  return [...pids];
}

/**
 * One timed pass: ask the OS about every reported pid, then sweep with the
 * answers. A probe still in flight when the next tick fires is left to
 * finish; the tick is skipped rather than stacked.
 */
export function startIdleAgentSweep(
  agents: AgentStateStore,
  cull: (id: number, reason: CullReason) => void,
  probe: (pids: number[]) => Promise<LivenessMap> = probeLiveness,
): ReturnType<typeof setInterval> {
  let inFlight = false;
  return setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    probe(reportedPids(agents))
      .catch(() => new Map<number, never>())
      .then((liveness) => sweepIdleAgents(agents, Date.now(), cull, liveness))
      .finally(() => {
        inFlight = false;
      });
  }, IDLE_SWEEP_INTERVAL_MS);
}
