# Tacit Labs fork

Upstream: https://github.com/pixel-agents-hq/pixel-agents (MIT). Base: v1.4.1.

## What is different

One patch, in three server files, that reads `tacit_director`, `tacit_role` and
`tacit_job` from a Claude hook payload and shows them as the avatar's name.
Field names on the wire are generic (`owner`, `role`, `job`) so the patch can be
offered upstream. See `server/src/providers/hook/claude/claude.ts`
(`normalizeHookEvent`), `server/src/hookEventHandler.ts` (`applyLabel`) and
`core/src/provider.ts` (`AgentLabel`).

A second patch, in `server/src/clientMessageHandler.ts`, closes the gap left by
`--host`: every client message that mutates state (layout, seats, settings,
external asset directories, closing an agent) now requires the same
`ctx.privileged` token as the two hooks-consent messages already checked, so an
untokened LAN peer can only watch the office rather than change it.

A third patch extends the same labelling machinery two ways. In
`server/src/fileWatcher.ts`, `folderNameFromProjectDir` cuts a worktree's
project-dir name at the `--claude-worktrees-` marker before taking its last
segment, so a worktree session keys the Areas feature by its repo rather than
its branch. This covers the transcript-file resolution path only: the
hooks-only provider branch (OpenCode, Copilot, no transcript file) still keys
Areas by the plain `cwd` basename, so a worktree session under one of those
providers reads as its branch, not its repo, until that path gets its own fix.
And in `server/src/hookEventHandler.ts`, `applyLabel` now also resolves the
label's `owner` against an optional `ownerPalettes` map in config.json
(`server/src/configPersistence.ts`, read once and cached rather than on every
hook event), broadcasting a new `agentPalette` message whenever the palette or
the hueShift differs from the agent's current values (the two are always set
together, forced to 0, so the same owner always renders as the same colour),
so an avatar can be recoloured by the director who owns it. Because the
marker cut landed after `areaMappings` started being persisted, a director's
existing `config.json` may still hold folder keys from before it, e.g. a raw
`...--claude-worktrees-engineer-issue-549` key that now never matches, since
new sessions resolve to the repo name. Such a key is inert, not harmful, and
drops out the next time that mapping is edited and re-saved.

A fourth patch benches idle work instead of leaving it seated forever: once a
character has been continuously inactive past `LOUNGE_IDLE_SEC`
(`webview-ui/src/constants.ts`), `OfficeState` walks it to a free tile in the
Area named by an optional `loungeArea` config field (delivered on the same
`areaMappingsLoaded` message as `areaMappings`). It skips only a character
showing a permission bubble, never a "waiting for input" one: that flag
latches on Claude Code's ordinary 60-second idle notification and nothing
ever clears it, so gating on it would block every idle session from ever
lounging. It reserves its destination tile so two characters crossing the
threshold in the same frame don't stack, and sends it back to its own seat
once `setAgentActive(id, true)` marks it active again, as does `walkToTile` or
`sendToSeat` commanding it elsewhere directly. The same patch dims the floor
and wall tiles of any Area holding no character, as a standalone render pass
run after carpets so a carpeted room dims too
(`webview-ui/src/office/engine/renderer.ts`, `renderEmptyAreaDim`,
`EMPTY_AREA_DIM_ALPHA`), so a room nobody is working in reads as unlit next to
a busy one.

A fifth patch, in `server/src/hookEventHandler.ts` (`adoptLiveSession`), lets
the office pick up sessions that were already running when it started.
Upstream creates an agent from `SessionStart` alone and keeps agents only in
memory, so restarting the server makes every session already in flight
invisible: their later events resolve to no agent and are silently dropped,
and nothing brings them back until someone starts or resumes a conversation.
That is a shrug on a desktop and a real problem for an always-on office on a
shared machine, where each deploy emptied a room that had two dozen sessions
working in it.

The patch treats an event for an unknown session as the evidence it is: a
tool call or a stop means that session is alive now. It stores the session as
pending, and the existing confirmation path turns it into an agent on the
next event. It never fires on `sessionStart` (handled above it) or
`sessionEnd`, requires a transcript path or cwd, and defers to
`isTrackedSession`, so with Watch All Sessions off it still only adopts a
project directory some existing agent already occupies. Upstream behaviour
with Watch All off is therefore unchanged.

A sixth patch, in `server/src/fileWatcher.ts` (`startStaleExternalAgentCheck`),
stops the office despawning characters it cannot see the transcript of. The
check decides a session has ended by `stat`-ing its transcript, and a bare
`catch` read every failure as a deletion. The commonest other failure is
`EACCES`: Claude Code writes a session's project directory `0700` and its
transcript `0600`, so a server running as its own account can never stat
anyone else's, no matter how alive that session is. The result was a character
appearing on a hook event and being reaped again within the minute, over and
over. Only `ENOENT` now removes an agent; anything else is treated as "cannot
tell" and the character stays. A session that has really ended is still
cleaned up by `SessionEnd`, or by `ENOENT` once its transcript is gone.

The same patch also honours the per-agent half of the module's own hooks/
heuristic switch. Its header states that mode is chosen by `hookDelivered`
per agent and `hooksEnabledRef` globally; the stale check consulted only the
global flag. That flag records whether the app installed the hooks itself,
not whether hook events are arriving, so an operator who installs hooks by
their own means, as this office does, got heuristic-mode reaping applied to
hook-driven agents. An agent that has had a hook delivered is now skipped,
because `SessionEnd` already owns its lifecycle. An agent that has never had
one is still reaped on `ENOENT`, since for that agent the file is the only
signal there is.

This is the other half of the fifth patch: adoption put the characters back,
and this is what lets them stay.

A seventh change is CI-only and touches no shipped code. The macOS end-to-end
shards ran every spec and failed every one of them inside two minutes:
`@vscode/test-electron` on darwin-arm64 reports a successful download and
returns a path that does not exist, so `electron.launch` dies with `ENOENT`
before any test executes. That took out the `tests/standalone` specs too,
which need no VS Code at all, leaving macOS with no signal about anything.

macOS now runs `tests/standalone` only, with `E2E_SKIP_VSCODE=1`, which
`e2e/global-setup.ts` honours by not downloading VS Code. The one spec under
that directory which does launch an extension host, the multi-server
contamination test, skips itself when that variable is set rather than
failing. Linux and Windows are untouched and still run everything.

Dropping macOS from the matrix was the alternative and costs more: this
office is deployed on macOS, so the standalone specs are precisely the
coverage worth keeping there. Restore the full run by clearing `specs` and
`skip_vscode` in the matrix once the upstream download is fixed.

An eighth patch gives the office a clock. Until it, an agent could leave by
exactly two routes, both evidence-driven: a `SessionEnd` hook, or its
transcript disappearing. Neither fires for a session that dies without saying
so — an ssh drop, a terminal closed on a running Claude, `kill -9`, a machine
rebooting mid-turn — and every one of those leaves a perfectly healthy
transcript behind. The character sat at its desk, walked to the lounge ten
minutes later, and stayed there until someone restarted the daemon. On an
always-on office that is days, and the lounge slowly filled with the dead.

`server/src/idleAgentSweep.ts` runs every `IDLE_SWEEP_INTERVAL_MS` and reads
one number: how long since anything was heard from each agent. Past
`IDLE_GHOST_MS` (1h) the character is ghosted — still in the room, drawn at
`STALE_CHARACTER_ALPHA`, visibly out of contact. Past `IDLE_CULL_MS` (12h) it
is removed. The gap between the two is the point: the ghost is what a director
reads, and the cull is bookkeeping agreeing with it half a day later.

Three details carry the patch. The clock is `lastHookAt`
(`server/src/hookEventHandler.ts`, stamped where `hookDelivered` is set),
because the existing `lastDataAt` is transcript-driven and stops moving for
every session this process cannot read — which on a shared box is all of them
but its own. A cull does _not_ dismiss the transcript, unlike `closeAgent`, so
a session that was merely quiet returns through `adoptLiveSession` on its next
event. And three agents are never culled: a terminal-backed one, which has a
terminal to focus whatever it last said; a teammate, which dies with its lead;
and one with a permission ask outstanding (`permissionSent`), because removing
the character removes the ask along with it, silently, half a day after a
director was asked something. All three are still ghosted — a ghost is never
wrong the way a cull can be, and an agent that must not be removed is still an
agent nobody has heard from.

The ghost flag rides a new `agentStale` message (declared in
`core/asyncapi.yaml`, from which `core/src/messages.ts` is generated —
`npm run asyncapi:generate`). It is broadcast when the flag flips, cleared on
the next hook event rather than at the following sweep, and replayed by
`resendAgentActivity`, so a director opening the page mid-morning sees the
same office as one who left it open. The render decision itself is
`webview-ui/src/office/engine/characterAlpha.ts`: a pure module, tested
directly, kept clear of the canvas types for the reason the build note below
gives.

A ninth patch changes what the label panel above an avatar leads with. Upstream
gives its largest line to what the agent is running -- a truncated shell command
or `Reading foo.ts` -- and puts the agent's name above it in small type. In this
fork every session carries a name (`applyLabel`: director, role, job), and with
two dozen characters on screen the name is the line that says whose work you are
looking at, while a command clipped to fit a panel says nothing anyone can act
on. `webview-ui/src/office/components/overlayLabel.ts` (`nameLeadsPanel`) now
decides which line gets the large type: normally the name, with the activity
demoted underneath it in small type -- nothing is hidden, it just stops shouting.

Two states are exempt, because they ask the director for something rather than
narrating: `Needs approval` and `Waiting for input` keep the large line and the
name steps down. The predicate lives in its own React-free module so
`webview-ui/test/overlayLabel.test.ts` can test it without dragging the DOM into
the node test project, the same reason `areaDim.ts` exists. A session with no
name at all -- upstream's normal case -- renders exactly as before.

The demoted line is then cut to one word (`shortActivityText`, same module).
The full status is written to be read at the top of a panel on its own —
`Running: cd ~/tacit-claude/.claude/worktrees/…` — and under a name, on a
phone, it is a line of noise ending in an ellipsis: long enough to crowd the
panel, cut too early to identify anything. `Running`, `Reading`, `Searching`
answers the only question that line is being asked. The cut is generic rather
than a table of tool names — text before the first colon, then its first word
— so it follows any provider's phrasing without a second copy of that
vocabulary living in the webview to drift. A third director-facing state,
`Waiting for your answer` (AskUserQuestion), joined the two exempt ones for
this: it is the one status whose first word survives the cut while losing the
entire point of the sentence.

## Syncing upstream

    git fetch upstream --tags
    git switch -c chore/sync-vX.Y.Z main
    git merge upstream/vX.Y.Z
    npm ci && npm run build && npm test
    # resolve the three files above if they conflict, then PR to main

The Mini runs a pinned tag (`tacit/vX.Y.Z-N`), so a merge here changes nothing
on the machine until `install-office.sh` is re-run at the new tag.

## Always run `npm run build` before merging

`npm run check-types` covers `adapters/`, `server/` and `core/`, and NOT
`webview-ui/`. `npm run test:webview` runs vitest, which does not typecheck. So
a webview type error passes both and only surfaces in `npm run build`, whose
`build:webview` step runs `tsc -b`.

That is not academic. `webview-ui/tsconfig.node.json` compiles `test/**` with
`lib: ["ES2023"]` and no DOM, so a test importing a file that names
`CanvasRenderingContext2D` (renderer.ts, matrixEffect.ts, spriteCache.ts)
drags those types into a project that has none, and `tsc -b` fails with dozens
of errors in code the change never touched. On 2026-09-06 that broke the
office install on the Mini after two clean review rounds. Keep canvas-typed
modules out of `test/` imports: put the pure decision in its own module and
test that, as `src/office/engine/areaDim.ts` does.

## Baseline

`npm run test:server` at v1.4.1: 550 tests pass.
