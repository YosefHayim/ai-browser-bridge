# Safe structure cleanup: tunnel twin, script triage, empty trees

Status: accepted
Date: 2026-07-19

## Context

A structure review (Uncle Bob + repo `CODE-STYLE.md`) found real debt that did not
require reshuffling the feature map:

- `tunnel` shipped both an unused Effect Tag/Live path and the runtime
  `CloudflareTunnelClass`, with duplicated spawn logic.
- `src/scripts/dev/` mixed CI gates, maintainer capture/verify tools, and one-off
  DOM recon probes from feature work.
- An empty `src/skills/` tree and doc drift (`user-config` vs `userConfig`) added noise.

## Decision

- **Keep the feature map.** Debt is inside modules, not the folder tree.
- **Tunnel:** delete the unused Effect twin and `CloudflareTunnelError` schema; keep
  `CloudflareTunnelClass` as the sole runtime API until engines migrate for real.
- **Scripts:** split tracked tooling into `src/scripts/gates/` (verify checks) and
  `src/scripts/maintain/` (selector capture / provider verify). Delete one-off
  `probe*` / login recon scripts not wired into `package.json` or README.
- **Delete** the empty `src/skills/` placeholder tree.
- **Docs:** current paths live in `CODE-STYLE.md` / `package.json` / README; older ADRs
  that say `src/scripts/dev/` remain historical (superseded here for script location).

## Follow-up passes (same poll, later commits)

- **Done:** real-split `store/` into purpose modules (`paths`, `sessionStore`,
  `checkpoints`, `logging`, `fileResolver`) — no more god `internal/sessionStore.ts`.
- **Done:** group `terminal/tui/` by purpose (`shell/`, `composer/`, `assist/`,
  `status/`, `suggestions/`).
- **Deferred:** `chatgptPage.ts` carve (~5k lines already marker-annotated for split).
  A bulk extract + export/TSDoc rewrite proved regression-prone; keep the monolith until
  a purpose-by-purpose extract with tests per module (attachments → connector → rewind).
- **Deferred:** `cliRunner.ts` carve and broader Effect migration.

## Consequences

- `pnpm` `check:*` scripts point at `src/scripts/gates/`.
- Maintainer recapture path is `node src/scripts/maintain/captureProviderSelectors.mjs`.
- No dual tunnel implementation; Effect migration for tunnel is YAGNI until BridgeEngine
  is Effect-first end-to-end.
- Store public doors are real implementations, not re-export shells.
- TUI imports go through purpose folders; CLI entry uses `tui/shell/App.tsx`.
