# Product health — ai-browser-bridge

status: post-land + close-wave
updated: 2026-08-06

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip / origin/main | `2bb95f2` | campaign complete tip |
| backup/main-before-messy-2026-08-06 | `4683b8e` | pre-wave restore (pushed, retained) |
| reorg/structure-cleanup | retained remote | merged via #17; remote kept |

## Features

| id | disposition |
|----|-------------|
| structure | merged #17 |
| domain | merged #31 |
| store | merged #34 |
| browser | merged #30 |
| bridge | merged #32 |
| tools+tunnel | merged #36 |
| agentGateway | merged #33 |
| userConfig | merged #29 |
| conversationCatalog | merged #28 |
| providers | merged #39 (FIX pass; #35 closed during rebase) |
| terminal | merged #37 |
| biome format follow-up | merged #40 |

## Tests (tip)

| Layer | Result |
|-------|--------|
| `pnpm run verify` | **pass** |
| unit | **306/306** |
| e2e live providers | skip (no env) |

## Close-wave

| Item | Status |
|------|--------|
| Local worktrees under `.worktrees/` | **removed** |
| Remote feature/backup branches | **retained** (no remote deletes) |
| Open campaign PRs | **none** |
| cmux workspaces | n/a (host A) |

## Residual

- Live browser e2e when env available
- Optional remote branch delete only if user names them later
- Optional lean-prove if desired
