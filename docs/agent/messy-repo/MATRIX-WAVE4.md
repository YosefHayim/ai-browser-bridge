# Messy-repo MATRIX wave 4 — terminal + pure domains

Updated: 2026-08-07
Mode: **setup-wave complete** → next **audit-wave**
Product tip: `main` @ `fc6e654`
Backup: `backup/main-before-wave3-2026-08-07`
Host: A

## Why

Terminal under-split in wave 1. Wave 4 splits CLI vs TUI subtrees and pure domains.

## Lanes

| Surface | Issue | Branch | Worktree | Globs | PR |
|---------|-------|--------|----------|-------|-----|
| terminal-cli | #71 | `refactor/w4-71-terminal-cli` | `.worktrees/refactor-w4-71-terminal-cli` | `src/features/terminal/*.ts` | **#96** `149b92a` |
| terminal-tui-composer | #72 | `refactor/w4-72-terminal-tui-composer` | `.worktrees/refactor-w4-72-terminal-tui-composer` | `src/features/terminal/tui/composer/**` | **#95** `2636e00` |
| terminal-tui-shell | #73 | `refactor/w4-73-terminal-tui-shell` | `.worktrees/refactor-w4-73-terminal-tui-shell` | `src/features/terminal/tui/shell/**,src/features/terminal/tui/assist/**` | **#84** `5d8f9e0` |
| terminal-tui-suggestions | #74 | `refactor/w4-74-terminal-tui-suggestions` | `.worktrees/refactor-w4-74-terminal-tui-suggestions` | `src/features/terminal/tui/suggestions/**` | **#89** `2344fdf` |
| terminal-tui-status | #75 | `refactor/w4-75-terminal-tui-status` | `.worktrees/refactor-w4-75-terminal-tui-status` | `src/features/terminal/tui/status/**` | **#83** `001767d` |
| store | #76 | `refactor/w4-76-store` | `.worktrees/refactor-w4-76-store` | `src/features/store/**` | **#94** `bf78e2e` |
| domain | #77 | `refactor/w4-77-domain` | `.worktrees/refactor-w4-77-domain` | `src/features/domain/**` | **#85** `b1b6ad2` |
| user-config | #78 | `refactor/w4-78-user-config` | `.worktrees/refactor-w4-78-user-config` | `src/features/userConfig/**` | **#91** `8a1ce33` |
| conversation-catalog | #79 | `refactor/w4-79-conversation-catalog` | `.worktrees/refactor-w4-79-conversation-catalog` | `src/features/conversationCatalog/**` | **#88** `c697ea0` |

## Merge order (after audit)

1. domain → store → user-config → conversation-catalog
2. terminal-cli
3. terminal-tui-status → suggestions → shell → composer

## Next

```text
/messy-repo audit
```

Score only these wave PRs — do not re-bag surfaces.
