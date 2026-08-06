# Product health — ai-browser-bridge

status: post-land
updated: 2026-08-06

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip / origin/main | `ef0a81c` | landed land-wave tip |
| backup/main-before-messy-2026-08-06 | `4683b8e` | pre-wave restore (pushed) |
| reorg/structure-cleanup | `b6a5047` | capstone integration branch (merged via #17) |

## Features

| id | paths | tests | risk | wave disposition |
|----|-------|-------|------|------------------|
| structure | cross-cutting | full suite | med | **merged** #17 |
| domain | `src/features/domain/**` | unit | low | **merged** #31 |
| store | `src/features/store/**` | unit | low | **merged** #34 |
| browser | `src/features/browser/**` | unit | low | **merged** #30 |
| bridge | `src/features/bridge/**` | unit | low | **merged** #32 |
| tools+tunnel | tools + tunnel | unit | low | **merged** #36 |
| agentGateway | `src/features/agentGateway/**` | unit | low | **merged** #33 |
| userConfig | `src/features/userConfig/**` | unit | low | **merged** #29 |
| conversationCatalog | conversationCatalog | unit+ | low | **merged** #28 |
| providers | `src/features/providers/**` | unit | low | **OPEN FIX #35** (retargeted → main) |
| terminal | `src/features/terminal/**` | unit | med | **OPEN FIX #37** (retargeted → main) |

## Structure tree (top levels)

```text
src/
  main.ts
  config.ts
  features/
    agentGateway/ bridge/ browser/ conversationCatalog/
    domain/ providers/ store/ terminal/ tools/ tunnel/ userConfig/
scripts/
  checkBoundaries.mjs checkStyleGuide.mjs checkNoCompatibility.mjs
  dev/
docs/agent/messy-repo/
```

## Tests (post-land tip)

| Layer | Command | Result |
|-------|---------|--------|
| unit | `pnpm test` | **pass 306/306** (54 files) |
| full gate | `pnpm run verify` | **pass** (biome, style-guide, typecheck, test, build, boundaries, no-compatibility) |
| e2e live providers | — | **skip** (no live Chrome env) |

## Branches

| Class | Count | Names |
|-------|-------|-------|
| merged this land | 9 | #17, #31, #34, #30, #32, #36, #33, #29, #28 |
| open FIX | 2 | #35 providers, #37 terminal (base now main) |
| backups | 1 | backup/main-before-messy-2026-08-06 |
| dry-land local | 1 | audit/dry-land-* (local only; safe to remove at close-wave) |

## Worktrees

| Path | Keep? | Reason |
|------|-------|--------|
| `.worktrees/refactor-*` | until close-wave | original lanes; FIX #35/#37 still useful |
| `.worktrees/audit-dry-land-*` | optional remove | prove only |

## Residual

- **#35** providers — same-branch deslop (chatgptPage/flow*) then re-audit/land
- **#37** terminal — same-branch deslop (handle*/cliTypes/??) then re-audit/land
- Live browser e2e when env available
- Optional close-wave: remove local worktrees after reachability proven
- Optional lean-prove if tip still feels fat

## Merged via land-wave

Order executed:
1. Residual into `reorg/structure-cleanup`: #31 → #34 → #30 → #32 → #36 → #33 → #29 → #28
2. Capstone #17 `reorg/structure-cleanup` → `main` @ `ef0a81c`
3. Skipped FIX #35, #37 (AUDIT)
