# Co-locate tests beside their subject; move dev scripts under `src/scripts/dev/`

Tests lived in a parallel `tests/features/**` tree that mirrored `src/features/**`, and
dev/gate scripts lived in a top-level `scripts/dev/` (ADR 0005). Both are sibling trees to
`src/` that a reader has to cross-reference by hand: to find a module's test you walked a
second tree, and the checker tooling sat outside the source it guards. The owner's taste is
a **single source tree** — the test next to the file it tests, the tooling under `src/`.

## Decision

- **Tests are co-located.** `x.test.ts` sits in the **same directory as the module it
  tests** — `loadConfig.test.ts` beside `loadConfig.ts`; a test whose subject lives in an
  `internal/` dir lives in that same `internal/`. The `tests/` tree is gone. Shared test
  fakes move to **`src/test-support/`** (`fakeComposer.ts`), reached via `@/test-support/…`.
- **Test imports obey the source boundary rule.** The module under test and same-feature
  files are imported **relatively** (`./loadConfig.ts`, `../tui/App.tsx`); anything in
  another feature or shared support uses the **`@/` alias** (`@/features/store/paths.ts`).
- **Tests are now typechecked.** `tsconfig` already includes `src/**`, so co-located
  `*.test.ts` join `tsc --noEmit` for the first time (vitest uses esbuild and never
  typechecked them). This surfaced 20 latent fixture-type errors — all fixed (e.g. missing
  `Attachment.role`, insufficient engine/page fakes); `DomSnapshotNode` is now exported from
  `chatgptPage.ts` for its co-located test. `vitest.config.ts` `include` is
  `src/**/*.test.{ts,tsx}`; tsup's entry stays `src/main.ts`, so tests never enter the bundle.
- **Dev/gate scripts move `scripts/dev/` → `src/scripts/dev/`.** The four gate scripts
  (`checkBoundaries`, `checkClassApi`, `checkTsdoc`, `checkNoDeprecated`) and the recon
  scripts (`capture*`, `verifyProviders`, `probeReplyContainer`) all move; `package.json`
  `check:*` paths, the scripts' own usage strings, and two source comments follow. The
  repo-root resolver in each gate goes from `import.meta.dirname/../..` to `../../..` (one
  level deeper). `.mjs` stays invisible to `tsc`/`tsup`/Biome-typecheck.
- **Gate scripts skip `*.test.ts`.** `checkClassApi`/`checkTsdoc` already excluded tests;
  `checkBoundaries` and `checkNoDeprecated` now do too — tests are not part of the
  cross-feature public surface, so they may reach a neighbour to build a fixture.

This **supersedes the "dev-only scripts moved to `scripts/dev/`" clause of ADR 0005**; the
camelCase-filename and `internal/`-implementation decisions of 0005 stand.

## Consequences

- One mechanical migration: 43 test files relocated with every import rewritten (same-feature
  relative, cross-feature `@/`), 10 scripts moved, docs/ADRs/memory refreshed. The `verify`
  gate (biome ci + typecheck + 231 tests + build + four checkers) passes green.
- Locality: the test for a file is now a sibling, not a mirror-tree lookup; the tooling that
  guards `src/` lives under `src/`.
- Tests gained real type coverage — a class of fixture drift (a field added to `Attachment`
  but not to its test doubles) now fails `typecheck` instead of rotting silently.
- `files: ["dist"]` still ships only the bundle; co-located `*.test.ts` and `src/scripts/dev/`
  never leave the repo (see ADR 0008).
