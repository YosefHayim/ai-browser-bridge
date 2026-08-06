# Messy-repo MATRIX — ai-browser-bridge

Updated: 2026-08-06
Mode: **setup-wave** (handoff → **audit-wave**, not re-fan-out)
Host mode: **A** (background subagents)

## Product tip & backups

| Ref | SHA | Role |
|-----|-----|------|
| `origin/main` | `4683b8e` | GitHub default (pre-cleanup structure) |
| `reorg/structure-cleanup` | `5640c1e` | **Product tip** for residual lanes / capstone head |
| `backup/main-before-messy-2026-08-06` | `4683b8e` | Restore point (pushed) |

Capstone PR: **#17** → `main` — https://github.com/YosefHayim/ai-browser-bridge/pull/17

## Lanes

| Feature | Issue | Branch | Worktree | Host | cmux | PR | Head SHA | Verify | Notes |
|---------|-------|--------|----------|------|------|-----|----------|--------|-------|
| structure-capstone | — | `reorg/structure-cleanup` | repo root | orchestrator | — | **#17** | `5640c1e` | verify pass local | Land first into main |
| providers | #18 | `refactor/18-providers` | `.worktrees/refactor-18-providers` | A | — | pending | | | base: reorg |
| bridge | #19 | `refactor/19-bridge` | `.worktrees/refactor-19-bridge` | A | — | pending | | | base: reorg |
| browser | #20 | `refactor/20-browser` | `.worktrees/refactor-20-browser` | A | — | pending | | | base: reorg |
| tools+tunnel | #21 | `refactor/21-tools` | `.worktrees/refactor-21-tools` | A | — | pending | | | base: reorg |
| terminal | #22 | `refactor/22-terminal` | `.worktrees/refactor-22-terminal` | A | — | pending | | | base: reorg |
| store | #23 | `refactor/23-store` | `.worktrees/refactor-23-store` | A | — | pending | | | base: reorg |
| agentGateway | #24 | `refactor/24-agent-gateway` | `.worktrees/refactor-24-agent-gateway` | A | — | pending | | | base: reorg |
| domain | #25 | `refactor/25-domain` | `.worktrees/refactor-25-domain` | A | — | pending | | | base: reorg |
| userConfig | #26 | `refactor/26-user-config` | `.worktrees/refactor-26-user-config` | A | — | pending | | | base: reorg |
| conversationCatalog | #27 | `refactor/27-conversation-catalog` | `.worktrees/refactor-27-conversation-catalog` | A | — | pending | | | base: reorg |

## Recommended merge order

1. **#17** structure-capstone → `main` (product tip advances)
2. Residual stacked PRs (after re-base onto updated tip if needed): domain → store → browser → providers → bridge → tools → tunnel/agentGateway → userConfig → conversationCatalog → terminal (UI last)
3. Or keep residual PRs targeting `reorg/structure-cleanup` until #17 lands, then retarget `main`

## Overlaps

- Capstone already moved all features off `internal/` and killed factories — residual lanes should be **small** deslop/CODE-STYLE, not re-structure.
- `providers` ↔ `bridge` ↔ `browser` share runtime contracts; stay within doors.
- `tools` lane includes `tunnel` (small surface).

## Deferred mess

- Headed/browser e2e against live providers (env-dependent)
- Promoting product tip to GitHub default after land-wave
- cmux host B (not used this wave)
- Full `lean-prove` only if tip still fat after land

## Next command for human

```text
/messy-repo audit
```

or: **audit messy PRs** on ai-browser-bridge — scores open MATRIX PRs only; does **not** open a second wave of feature PRs.
