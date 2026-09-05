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

A third patch extends the same labelling machinery two ways: in
`server/src/fileWatcher.ts`, `folderNameFromProjectDir` cuts a worktree's
project-dir name at the `--claude-worktrees-` marker before taking its last
segment, so a worktree session keys the Areas feature by its repo rather than
its branch (applied to both the transcript-file and the hooks-only,
no-transcript resolution paths); and in `server/src/hookEventHandler.ts`,
`applyLabel` now also resolves the label's `owner` against an optional
`ownerPalettes` map in config.json (`server/src/configPersistence.ts`, read
once and cached rather than on every hook event), broadcasting a new
`agentPalette` message — palette AND hueShift forced to 0 together, so the
same owner always renders as the same colour — when either differs from the
agent's current values so an avatar can be recoloured by the director who
owns it. Because the marker cut landed after `areaMappings` started being
persisted, a director's existing `config.json` may still hold folder keys
from before it (e.g. a raw `...--claude-worktrees-engineer-issue-549` key
that now never matches, since new sessions resolve to the repo name); such a
key is inert, not harmful, and drops out the next time that mapping is edited
and re-saved.

A fourth patch benches idle work instead of leaving it seated forever: once a
character has been continuously inactive past `LOUNGE_IDLE_SEC`
(`webview-ui/src/constants.ts`), `OfficeState` walks it to a free tile in the
Area named by an optional `loungeArea` config field (delivered on the same
`areaMappingsLoaded` message as `areaMappings`), skipping only a character
showing a permission bubble (never a "waiting for input" one — that flag
latches on Claude Code's ordinary 60-second idle notification and nothing
ever clears it, so gating on it would block every idle session from ever
lounging), reserving its destination tile so two characters crossing the
threshold in the same frame don't stack, and sends it back to its own seat
once `setAgentActive(id, true)` marks it active again (as does `walkToTile` or
`sendToSeat` commanding it elsewhere directly). The same patch dims the floor
and wall tiles of any Area holding no character, as a standalone render pass
run after carpets so a carpeted room dims too
(`webview-ui/src/office/engine/renderer.ts`, `renderEmptyAreaDim`,
`EMPTY_AREA_DIM_ALPHA`), so a room nobody is working in reads as unlit next to
a busy one.

## Syncing upstream

    git fetch upstream --tags
    git switch -c chore/sync-vX.Y.Z main
    git merge upstream/vX.Y.Z
    npm ci && npm run build && npm test
    # resolve the three files above if they conflict, then PR to main

The Mini runs a pinned tag (`tacit/vX.Y.Z-N`), so a merge here changes nothing
on the machine until `install-office.sh` is re-run at the new tag.

## Baseline

`npm run test:server` at v1.4.1: 550 tests pass.
