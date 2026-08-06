# Product health — ai-browser-bridge

status: audit-draft
updated: 2026-08-06

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip | `reorg/structure-cleanup` @ `d369dd1` | PR base / real product tip |
| origin/main | `4683b8e` | GitHub default (pre-capstone) |
| backup/main-before-messy-2026-08-06 | `4683b8e` | restore (pushed) |
| audit dry-land (local) | `45a6ff2` | all residual merged, not pushed |

## Features

| id | paths | tests (approx) | risk | wave disposition |
|----|-------|----------------|------|------------------|
| structure | cross-cutting | full suite | med | MERGE #17 |
| domain | `src/features/domain/**` | 11 unit | low | MERGE #31 |
| store | `src/features/store/**` | 22 unit | low | MERGE #34 |
| browser | `src/features/browser/**` | 14 unit | low | MERGE #30 |
| providers | `src/features/providers/**` | large suite | low | **FIX #35** |
| bridge | `src/features/bridge/**` | 24 unit | low | MERGE #32 |
| tools+tunnel | `tools/**` + `tunnel/**` | 18 unit | low | MERGE #36 |
| agentGateway | `src/features/agentGateway/**` | 18 unit | low | MERGE #33 |
| userConfig | `src/features/userConfig/**` | 15 unit | low | MERGE #29 |
| conversationCatalog | `src/features/conversationCatalog/**` | 7 unit | low | MERGE #28 |
| terminal | `src/features/terminal/**` | large suite | med | **FIX #37** |

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
  dev/  (capture/verify helpers)
docs/
  adr/current/
  agent/messy-repo/  (MATRIX AUDIT HEALTH planpage)
```

## How code is written (slices)

### 1. domain — permissions (after #31)

Status is the single authority for tool permission decisions; normalize uses early guards, not `??`. Data bags are `type` aliases.

### 2. store — sessionStore (after #34)

Free functions implement create/load/list; `SessionStore` is a thin options-bound handle. Path helpers use domain names (`posixPath`, `relativePath`).

### 3. providers — selectorDrivenProvider (after #35 partial)

Shared adapter wait-options and factory rename improved; **chatgptPage / flow modules still need FIX pass**.

### 4. conversationCatalog — search (after #28)

Named ranking phases (score → sort → slice) with expanded business tests for provider preference and limits.

## Tests

| Layer | Count / command | Result |
|-------|-----------------|--------|
| unit (tip alone) | `pnpm test` ~302 | pass (setup) |
| unit (dry-land all residual) | `pnpm test` **306** | **pass** |
| boundaries | `pnpm run check:boundaries` | OK |
| style-guide | `pnpm run check:style-guide` | OK (32 rules) |
| e2e live providers | deferred | **skip** (no env) |
| stale deleted this wave | factories/internal/ | via #17 + residuals |

## Branches

| Class | Count | Names (sample) |
|-------|-------|----------------|
| product lanes open | 11 | #17 reorg; #28–#37 residual |
| merged this land | 0 | audit does not merge |
| backups | 1+ | `backup/main-before-messy-2026-08-06` |
| dry-land local | 1 | `audit/dry-land-20260806-231037` |
| wip / deferred | 2 | FIX #35, #37 residual style |

## Worktrees

| Path | Keep? | Reason |
|------|-------|--------|
| `.worktrees/refactor-*-*` | until close-wave | lane agents |
| `.worktrees/audit-dry-land-*` | until close-wave or delete local | prove only; not product tip |

## Residual

- FIX #35 providers incomplete deslop
- FIX #37 terminal handle*/cliTypes/??
- Live browser e2e
- Promote tip → default after land
- Stacked CI Actions only after #17 → main
EOF