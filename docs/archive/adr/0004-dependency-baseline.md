# Dependency baseline and modernization

An audit found two dead dependencies and an opportunity to modernize two majors.

## Kept (with rationale)

- `@modelcontextprotocol/sdk` — the MCP server/tool protocol; core.
- `commander` — CLI arg parsing.
- `ink` + `ink-text-input` — the terminal UI; the only prompt system.
- `playwright` — drives the real browser tab (the whole point).
- `react` — Ink's renderer.
- `zod` — MCP tool parameter schemas (the only validation surface using it).

## Removed

- **`inquirer`** — a production dependency never imported anywhere; all prompting is
  Ink. Dead weight in the published package.
- **`knip`** — a dead-code/dependency finder installed with no config and no script,
  so it never ran (it would have flagged `inquirer` and the deleted scripts).

## Modernization (tracked, own verify cycle)

Each bump landed as a deliberate, separately-verified change behind `pnpm verify`.

- **`zod` 3 → 4 — landed (`zod@4.4.3`).** The MCP SDK already declares
  `zod: ^3.25 || ^4.0`, so v4 is supported. Our usage is core (`z.string()`,
  `z.number().optional()`, `z.array()`) and was unaffected; the full gate stayed green
  after the bump.
- **`react` 18 → 19 — attempted, reverted, deferred.** The published peer ranges
  (`ink@5.2.1` → `react >=18`, `ink-text-input@6` → `react >=18`) *say* 19 is allowed,
  but the range lies: `ink@5` reaches for `ReactCurrentOwner`, a React-18
  internal that **React 19 removed**. Under React 19 every Ink render throws
  `Cannot read properties of undefined (reading 'ReactCurrentOwner')` and nine TUI
  test files fail. React 19 therefore requires **`ink@5 → 6`**, a coupled migration
  we chose not to fold into this change. Reverted to `react@^18.3.1` /
  `@types/react@^18.3.12`; the gate is green on 18.

**Deferred:** the `react@19 + ink@6` upgrade lands as its own tracked change (its own
`pnpm verify` cycle), decoupled from this baseline.

## Consequences

Leaner install; the toolchain moves `zod` to its current major while `react`/`ink`
stay on their last mutually-compatible pair (18 / 5) until the coupled `ink@6`
migration is done. Peer/dependency ranges of the retained libraries are respected —
and, where a published range is misleading, verified empirically rather than trusted.
