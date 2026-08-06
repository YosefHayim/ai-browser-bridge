# Product health — ai-browser-bridge

status: post-land + close-wave (waves 1–4)
updated: 2026-08-07

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip / origin/main | `62e88a4` | all residual deslop waves landed |
| backup/main-before-messy-2026-08-06 | retained | pre-campaign restore |
| backup/main-before-provider-lanes-2026-08-07 | retained | pre-WAVE2 |
| backup/main-before-wave3-2026-08-07 | retained | pre-WAVE3/4 |

## Campaign waves

| Wave | Scope | Status | Docs |
|------|-------|--------|------|
| 1 | bagged surface deslop | complete | HEALTH.md (historical) |
| 2 | per-provider | complete | HEALTH-WAVE2.md |
| 3 | core runtime fine-grained | complete | HEALTH-WAVE3.md |
| 4 | terminal + pure domains | complete | HEALTH-WAVE4.md |

## WAVE3+4 merges (this session)

| PR | Feature |
|----|---------|
| #92 | tools |
| #80 | tunnel |
| #90 | browser |
| #87 | bridge-engine |
| #93 | bridge-fanout |
| #86 | agent-gateway-ask |
| #81 | agent-gateway-chatgpt |
| #82 | agent-gateway-flow |
| #85 | domain |
| #94 | store |
| #91 | user-config |
| #88 | conversation-catalog |
| #96 | terminal-cli |
| #83 | terminal-tui-status |
| #89 | terminal-tui-suggestions |
| #84 | terminal-tui-shell |
| #95 | terminal-tui-composer |
| #98 | biome format post-land |

## Tests (tip)

| Layer | Result |
|-------|--------|
| `pnpm run verify` | **pass** |
| unit | **320/320** |
| e2e live | skip (no env) |

## Close-wave

- Local `.worktrees/*` for w3/w4 + dry-land removed
- Remote feature branches retained (no force-delete)
- Backups retained
