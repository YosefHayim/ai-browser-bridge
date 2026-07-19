# Adopt Biome for formatting + linting, and unify the CI gate

The repo had **no** formatter or linter config (no Biome/Prettier/ESLint/
editorconfig), yet a consistent de-facto style (double quotes, semicolons, 2-space,
trailing commas). Enforcement was fragmented: `verify:push` (pre-push) ran
`typecheck + test + build + check:class-api + check:tsdoc`, but CI ran a *different*
set (`tsc + test + build + --help smoke + pack + git diff --check`) and skipped the
custom checks entirely. Two more checks (`check-max-lines`, `check-function-style`)
existed as files but were wired nowhere and massively violated.

## Decision

- **Biome** owns formatting and general linting (`biome.json`): 2-space, width 100,
  double quotes, semicolons always, trailing commas all, `organizeImports` on,
  `linter.recommended`. Scripts: `format`, `format:check`, `lint`, `check:ci`
  (`biome ci ./`). The path is `./`, **not** a bare `.`: this repo's `.gitignore`
  ignores all dotfiles (`.*`), and with `vcs.useIgnoreFile` on, Biome matches that
  glob against the bare `.` argument itself and silently processes **zero** files
  (`No files were processed`). `./` sidesteps the match.
- **The architectural boundary** (no cross-feature service-class imports) is
  enforced by a custom `scripts/dev/checkBoundaries.mjs`, **not** Biome
  `noRestrictedImports` — the latter matches literal specifiers and cannot reliably
  catch relative imports across varying directory depths. The custom check mirrors
  the `checkClassApi.mjs` / `checkTsdoc.mjs` family. _(Superseded by ADR 0005: the
  boundary is now content-based — flags imports of any module declaring a non-error
  class — since filenames no longer carry a `.class` suffix; dev scripts moved to
  `scripts/dev/`.)_
- **One gate, everywhere.** A single `verify` script =
  `check:ci + typecheck + test + build + check:class-api + check:tsdoc +
  check:boundaries`. `verify:push` calls it; CI runs the same via reusable
  workflows.
- **CI** is the dufflebag reusable-workflow set (`ci.yml` orchestrator + a `CI Gate`
  aggregate + single-purpose `biome`/`typecheck`/`test`/`build`/`checks` legs +
  `report-failure` on default-branch red), adapted to this repo: branch `master`
  (not `main`), a `--help` smoke step retained in `build`, `e2e.yml` shipped
  opt-in (Playwright-ready).
- **Local hooks:** pre-push runs `pnpm verify`; a fast pre-commit runs Biome on
  staged files via lint-staged.
- The dormant `check-max-lines.mjs` and `check-function-style.mjs` are **deleted**;
  there is intentionally no file/function-size rule.

## Consequences

- First `biome format` reflows the large hand-edited files — a one-time healthy diff.
- CI and pre-push now enforce the *same* thing; the class-API/TSDoc/boundary checks
  can no longer pass locally and silently skip in CI.
- Boundary drift fails a real gate, backing the "no crosses" rule in `CODE-STYLE.md`.
