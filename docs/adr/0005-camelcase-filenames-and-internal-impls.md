# camelCase filenames, no invented dot-suffixes, `internal/` implementations

ADR 0002-era code used a dot-suffix filename system (`*.class.ts`, `*.factory.ts`,
`*.types.ts`, `*.config.ts`, `*.profiles.ts`, `*.helpers.ts`) over kebab-case bases.
The suffix carried role information and drove the boundary/gate scripts (which keyed
on `.class.ts`). It had already leaked — small classes (`guest-session-error.ts`,
`composer-history.ts`) never took the `.class.ts` suffix — and the owner's taste is
plain camelCase.

## Decision

- **Filenames are `camelCase.ts`.** No kebab-case, no invented dot-suffixes. The old
  role-suffix folds into the name: `create-provider.factory.ts` →
  `createProviderFactory.ts`, `browser-provider.types.ts` → `browserProviderTypes.ts`,
  `role-theme.config.ts` → `roleThemeConfig.ts`, `use-composer-state.ts` →
  `useComposerState.ts`. A class module is just `camelCase.ts` — the `.class` is dropped
  (one class per module is implied by content).
- **TUI React components stay `PascalCase.tsx`** (`MessagePane.tsx`); a `.tsx` helper
  that is not a component is `camelCase.tsx`.
- **Only tool-mandated dots survive:** `*.test.ts` (vitest glob), `tsup.config.ts`,
  `vitest.config.ts`, `biome.json`, `tsconfig.json`. These are external contracts.
- **Directories stay kebab-case** (`input-suggestions/`, `user-config/`). Renaming dir
  segments multiplies import-path churn for little gain; revisit separately if wanted.
- **A feature's implementation classes live in `internal/`.** Four service classes
  whose door and impl shared a stem (`orchestrator`, `browserManager`, `sessionStore`,
  `cloudflareTunnel`) would collide when `.class` was dropped, so each impl moved to
  `<feature>/**/internal/<name>.ts`; the same-dir public **door** (`<name>.ts`, a
  re-export with no own class) stays as the cross-feature entry.
- **Docs use TSDoc** (`@param`/`@returns` without types), and the JSDoc gate is renamed
  `check:tsdoc`.
- **Gate scripts detect classes by content** (`export class`, minus `Error` subclasses)
  instead of the `.class.ts` filename, and **dev-only scripts moved to `scripts/dev/`**
  (`checkBoundaries.mjs`, `checkClassApi.mjs`, `checkTsdoc.mjs`) — they are never
  shipped (`package.json` `files` is `["dist"]`).

## Consequences

- One mechanical migration: ~100 files renamed, 112 import specifiers rewritten, 4
  impls relocated to `internal/`. `tsc` + Biome + 190 tests gate it — a broken path
  fails instantly.
- The boundary guarantee is preserved: cross-feature imports still cannot reach a
  service class, now enforced by content rather than a naming convention that had
  already leaked. The content check also picks up the two previously-unprotected
  classes (12 class files scanned, up from 10).
- Supersedes the ADR 0002 naming/detection details; the Biome + unified-gate decision
  itself stands.
