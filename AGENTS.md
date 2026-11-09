# AGENTS.md — ai-browser-bridge

Steps an agent needs in this repo. Rules for code style and git live in `~/.claude/rules`.

## Read first

- `PROJECT.md` before changing user-facing behavior.
- `LANGUAGE.md` before renaming a concept, command, tool, or public API.
- `CONTEXT.md` before moving code between folders.

## Commands

- `pnpm dev`: rebuild `dist/` on every change.
- `pnpm prod`: build, then run `dist/bridge.js` as a release build.
- `pnpm build`: production build to `dist/`.
- `pnpm test`: Vitest, one run. `pnpm test:watch`: watch mode.
- `pnpm lint`: Biome check, then knip. `pnpm lint:fix`: write the Biome fixes.
- `pnpm typecheck`: `tsc --noEmit`.
- `pnpm check`: lint, typecheck, test and build through Turborepo. Run it once when a task is finished.

## Hooks and CI

- `pnpm install` installs the git hooks. A new worktree needs it before its first commit.
- The pre-commit runs Biome on staged files and never writes. No hook runs the full check.
- GitHub CI runs on push to `main` only. Pull requests get no CI run.

## Release

1. Merge a PR that sets `version` in `package.json`.
2. Tag that commit on `main` as `vX.Y.Z` and push the tag.
3. `publish.yml` runs `pnpm check` and publishes with npm trusted publishing.

## Safety

- All file operations go through sandbox validation.
- MCP tools never run a raw shell.
- Do not commit unless asked.
