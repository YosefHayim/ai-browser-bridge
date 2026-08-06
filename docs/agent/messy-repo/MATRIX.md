# Messy-repo MATRIX — ai-browser-bridge

Updated: 2026-08-06
Mode: **setup-wave complete** (handoff → **audit-wave**, not re-fan-out)
Host mode: **A** (background subagents)

## Product tip & backups

| Ref | SHA | Role |
|-----|-----|------|
| `origin/main` | `4683b8e` | GitHub default (pre-cleanup structure) |
| `reorg/structure-cleanup` | `5640c1e`+ | **Product tip** / residual PR base (capstone head; docs commit may advance tip) |
| `backup/main-before-messy-2026-08-06` | `4683b8e` | Restore point (pushed) |

Capstone PR: **#17** → `main` — https://github.com/YosefHayim/ai-browser-bridge/pull/17

## Lanes

| Feature | Issue | Branch | Worktree | Host | cmux | PR | Head SHA | Verify | Notes |
|---------|-------|--------|----------|------|------|-----|----------|--------|-------|
| structure-capstone | — | `reorg/structure-cleanup` | repo root | orchestrator | — | **#17** | tip | `pnpm verify` pass | Land first into main |
| providers | #18 | `refactor/18-providers` | `.worktrees/refactor-18-providers` | A | — | **#35** | `525e745` | providers tests pass | base: reorg |
| bridge | #19 | `refactor/19-bridge` | `.worktrees/refactor-19-bridge` | A | — | **#32** | `1629ec5` | bridge 24/24 | base: reorg |
| browser | #20 | `refactor/20-browser` | `.worktrees/refactor-20-browser` | A | — | **#30** | `9df19c4` | browser 14/14 | base: reorg |
| tools+tunnel | #21 | `refactor/21-tools` | `.worktrees/refactor-21-tools` | A | — | **#36** | `c2cf3dc` | tools 18/18 | base: reorg |
| terminal | #22 | `refactor/22-terminal` | `.worktrees/refactor-22-terminal` | A | — | **#37** | `70b9e55` | suite pass focused | base: reorg |
| store | #23 | `refactor/23-store` | `.worktrees/refactor-23-store` | A | — | **#34** | `644df36` | store 22/22 | base: reorg |
| agentGateway | #24 | `refactor/24-agent-gateway` | `.worktrees/refactor-24-agent-gateway` | A | — | **#33** | `4f5ed07` | gateway 18/18 | base: reorg |
| domain | #25 | `refactor/25-domain` | `.worktrees/refactor-25-domain` | A | — | **#31** | `60e2a1a` | domain 11 + full verify | base: reorg |
| userConfig | #26 | `refactor/26-user-config` | `.worktrees/refactor-26-user-config` | A | — | **#29** | `2c0e1f0` | userConfig 15/15 | base: reorg |
| conversationCatalog | #27 | `refactor/27-conversation-catalog` | `.worktrees/refactor-27-conversation-catalog` | A | — | **#28** | `8eb8bb1` | catalog 7/7 | base: reorg |

## Recommended merge order

1. **#17** structure-capstone → `main` (product tip advances)
2. Residual PRs into tip (after #17 or still base `reorg/structure-cleanup`):
   - #31 domain
   - #34 store
   - #30 browser
   - #35 providers
   - #32 bridge
   - #36 tools+tunnel
   - #33 agentGateway
   - #29 userConfig
   - #28 conversationCatalog
   - #37 terminal (UI last)

## Overlaps

- Capstone already flattened `internal/` and dropped factories — residual lanes are deslop/CODE-STYLE, not re-structure.
- `providers` ↔ `bridge` ↔ `browser` share runtime contracts via doors.
- `tools` lane owns `tunnel`.
- Dry-land may surface door/export conflicts between residual PRs — resolve at audit/land, do not open replacement PRs.

## Deferred mess

- Live provider e2e (headed/headless browser; env-dependent)
- Promote tip → GitHub default after land-wave
- Host B (cmux) unused
- Optional `lean-prove` scan if tip still fat post-land

## Next command for human

```text
/messy-repo audit
```

or: **audit messy PRs** on ai-browser-bridge — scores existing MATRIX PRs only; **does not** open a second feature-PR wave.
EOF