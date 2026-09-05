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
its branch; and in `server/src/hookEventHandler.ts`, `applyLabel` now also
resolves the label's `owner` against an optional `ownerPalettes` map in
config.json (`server/src/configPersistence.ts`), broadcasting a new
`agentPalette` message when it differs from the agent's current palette so an
avatar can be recoloured by the director who owns it.

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
