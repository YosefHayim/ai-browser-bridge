# CODE-STYLE.md

How code is written in ai-browser-bridge. **Prescriptive** (how to write), not
descriptive (what exists — that's `AGENTS.md`). The load-bearing rules are mirrored
into the `AGENTS.md` `## Conventions` digest; **this file is the source — edit
here.** `deslop` reads this file to enforce style per-diff.

## Stack & framework practices

For framework/library best-practices, follow these skills (don't restate them here):

- **Claude API / Anthropic SDK work** → `claude-api`
- This file covers only what's specific to THIS project on top of those.

Formatting is owned by **Biome** (`biome.json`) — never hand-argue quotes/semis/
width; run `pnpm format`. See `docs/adr/0002-adopt-biome-and-unified-ci.md`.

## Rules

Load-bearing, project-specific rules. Each is a one-liner plus a real before/after.

### Cross-feature access goes through a factory or door — never another feature's `internal/`

Within a feature, import its files directly. **Across** features (`src/features/*`),
import only through that feature's public surface — its `create<Name>Factory.ts` or a
door module (a re-export file with no own class). A feature's service classes live in
`internal/` and are private to it. Pure re-export barrels are deleted. Enforced by
`scripts/dev/checkBoundaries.mjs` (content-based: flags cross-feature imports of any
module declaring a non-error class).

```ts
// before  (src/features/terminal/cliRunner.ts)
import { BridgeEngine } from "../bridge/internal/bridgeEngine.ts";         // ✗ cross-feature service class
import { extractAllMessages, loadManifest }
  from "../providers/chatgpt/chatgptPage.ts";                             // ✗ deep provider import
// after
import { startEngine } from "../bridge/createEngineFactory.ts";           // ✓ factory front door
import { loadManifest } from "../providers/attachments.ts";               // ✓ single-job door
import { getBrowserProvider } from "../providers/createProviderFactory.ts"; // ✓
```
_Why:_ pureness, single jobs, no crossings — each file has one owner and one reason to change.

### Big facade classes are legitimate hand-edited source

Provider (`ChatGptPage`, `GeminiPage`) and CLI (`CliRunner`) classes are large by
nature. They are the real source of truth — there is **no** merge/concat build and
**no** file- or function-size rule. Keep them sectioned; delegate to module-level helpers.

```ts
// there is NO merge step. Do not add scripts/merge-*.mjs back; editing the class
// module directly is correct. `// --- actions/… ---` comments are not markers.
```
_Why:_ the abandoned split-and-merge left dangerous dormant generators; the monolith won.

### Layered error contract — boundaries return, internals throw

MCP tool handlers **return** `{ ok, output }` and never throw. Internals **throw**
`Error`. Exactly one catch-net per boundary converts throws → results. A custom
`Error` subclass only when a caller branches on its type; otherwise `throw new Error(msg)`.

```ts
// boundary — src/features/tools/mcpServer.ts (invokeToolHandler)
try { return await handler(args); }
catch (e) { return { ok: false, output: e.message }; }   // catch-net
// internal — throw, never a sentinel
if (!isInsideRepo(absPath, repoRoot)) throw new Error(`Path escapes repo root: ${absPath}`);
```
_Why:_ callers of Tools get data; internals fail loudly; the boundary is the single seam.

### Non-critical I/O is fire-and-forget

Logging, session-event persistence, config saves, and hook runs never block or
surface failures.

```ts
// src/features/bridge/bridgeEngine.ts
appendSessionEvent(...).catch(() => {});
saveConfig(input.config).catch(() => {});
```
_Why:_ a failed log write must not derail a live browser turn.

### `function` declarations for module helpers; arrows only inline

No module-level `const f = () =>`. Class methods are methods. React components and
hooks are `function` declarations; arrows appear only as callbacks / `useCallback` /
`useMemo` bodies.

```ts
// before (never)                         // after
const resolveEngineLog = (o) => {...};    function resolveEngineLog(options: StartEngineOptions) {...}
```

### Named exports only — zero default exports

Every export is named (`export class/function/const/type`). Re-export via named
`export { … }` blocks, not a default.

### No `any` — `unknown` + type guards at boundaries

`tsconfig` is `strict` with `noUncheckedIndexedAccess`. Untyped input is `unknown`,
narrowed by an `is*` guard. Casts (`as`) are sparse and purposeful.

```ts
// after
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null; }
```

### Thin service classes — ≤5 public methods, delegate to module helpers

Service classes are facades: ≤5 public methods (enforced by
`scripts/dev/checkClassApi.mjs`), each delegating to a module-level `function`.
Private helpers live at module scope, not as private methods. **Exempt:** classes
implementing `BrowserProvider` (fixed ~17-method contract) and `Orchestrator`.
Every public method gets a single-line `/** … */` TSDoc (no types in
`@param`/`@returns`), enforced by `scripts/dev/checkTsdoc.mjs`.

### One canonical `PermissionMode`

The `read-only | ask | auto` type is `PermissionMode`, derived from
`PERMISSION_MODES` in `domain/permissions.ts`. Never redeclare it as a literal union.

```ts
// before  (domain/types/bridgeTypes.ts)      // after
export type BridgePermissionMode = "read-only" | "ask" | "auto";  // deleted
// use PermissionMode = (typeof PERMISSION_MODES)[number] everywhere
```

### File & naming conventions

- **Files are `camelCase.ts`** — no kebab-case, no invented dot-suffixes. The old
  role-suffix is **folded into the name**: `createProviderFactory.ts` (was
  `create-provider.factory.ts`), `browserProviderTypes.ts` (`.types`),
  `roleThemeConfig.ts` (`.config`), `openaiProfiles.ts` (`.profiles`),
  `statusBarHelpers.ts` (`.helpers`), `useComposerState.ts` (hooks). A class module
  is just its `camelCase.ts` — no `.class`.
- **TUI React components stay `PascalCase.tsx`** (`MessagePane.tsx`,
  `ComposerAssistPanel.tsx`). `.tsx` that is a helper, not a component, is `camelCase.tsx`.
- **Only tool-mandated dots survive:** `*.test.ts` (vitest glob), `tsup.config.ts` /
  `vitest.config.ts` / `biome.json` / `tsconfig.json` (tool contracts). Never invent
  new ones.
- **A feature's implementation classes live in `internal/`;** its public surface
  (factory, door, `*Types.ts`, `*Config.ts`) sits at the feature root and re-exports
  from `internal/`. Cross-feature code imports the public surface, never `internal/`.
- Verb prefixes: `is/has/get/build/resolve/load/create/read/capture/parse/normalize/
  find/wait/ensure/format`. Type suffixes: `*Input/*Options/*Result/*Context/*State/*Record`.
- **Directories stay kebab-case** (`input-suggestions/`, `user-config/`); classes/types
  `PascalCase`; module constants `SCREAMING_SNAKE_CASE`.

### Tests

- `*.test.ts` only (no `.spec.ts`), mirroring `src/` under `tests/features/**`.
- `import { describe, it, expect } from "vitest"` explicitly (no globals). `describe`
  names a symbol; `it` names the scenario condition in plain English.
- Real FS tests use `mkdtemp` + `chdir` in `beforeEach`/`afterEach`. Browser surfaces
  use `{} as unknown as Page` fakes; shared fakes live in `tests/support/`.

## Recipes

### Add a Tool (MCP)
1. Define the handler in `tools/` returning `{ ok, output }`; validate params with a Zod schema.
2. Confine every path with the Sandbox (`isInsideRepo`) before any I/O.
3. Register it on the MCP server; gate it behind the right `PermissionMode`.
4. Test the pure handler with literal inputs; no real browser.

### Add a CLI command
- **Headless subcommand:** register in `terminal/registerCli.ts`; the action must
  redirect `console.log`→stderr, call the shared `startEngine`/`engine.ask` core,
  and end with an explicit `process.exit`. Never prompt in a non-TTY.
- **TUI slash command:** add to the metadata array + the `executeCommand` registry
  in `terminal/cliRunner.ts`; both modes must call the same underlying function.
- Bare `bridge` opens the TUI in a TTY and defers (never mounts Ink) when non-TTY.

### Add a feature
Create `src/features/<name>/`, expose a `create<Name>Factory.ts` (or a door) as its
only cross-feature entry, put the service class in `<name>/internal/`, keep types in
`*Types.ts`, static config in `*Config.ts`.

### Add a web-chat provider
1. `src/features/providers/<name>/<name>Page.ts` — the Playwright automation class
   implementing `BrowserProvider`. One class, TSDoc'd public methods.
2. `<name>ProviderConfig.ts` — the `BrowserProvider` config (origin, selectors, flags).
3. Add one line to `providers/providerRegistry.ts` — id type, `--provider` help, and
   `bridge login` all derive from it.
4. A fake-page test under `tests/features/providers/<name>/`; verify selectors against
   the live, signed-in DOM.

## Exemplars

Write new code like these:
- `src/features/bridge/internal/orchestrator.ts` — thin facade delegating to module helpers.
- `src/features/domain/permissions.ts` — pure logic, derived types, guards.
- `src/features/tools/mcpServer.ts` — the `{ ok, output }` boundary + Sandbox.
- `src/features/terminal/tui/useComposer.ts` — vertically composed hooks.

## Never

- Add a cross-feature service-class import (reach into another feature's `internal/`), or a pure re-export barrel.
- Re-introduce kebab-case files or invented dot-suffixes (`.class`/`.factory`/`.types`/`.config`).
- Re-add `scripts/merge-*.mjs`, `fix-imports.mjs`, or a file/function-size check.
- `any`, default exports, or a module-level arrow function.
- Throw out of an MCP handler, or use a thrown-error function as a boolean.
- Prompt (Ink or otherwise) in a non-TTY / headless path.
