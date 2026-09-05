# Tacit Labs fork

Upstream: https://github.com/pixel-agents-hq/pixel-agents (MIT). Base: v1.4.1.

## What is different

One patch, in three server files, that reads `tacit_director`, `tacit_role` and
`tacit_job` from a Claude hook payload and shows them as the avatar's name.
Field names on the wire are generic (`owner`, `role`, `job`) so the patch can be
offered upstream. See `server/src/providers/hook/claude/claude.ts`
(`normalizeHookEvent`), `server/src/hookEventHandler.ts` (`applyLabel`) and
`core/src/provider.ts` (`AgentLabel`).

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
