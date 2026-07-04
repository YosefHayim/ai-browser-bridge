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

## Scripts — shared `package.json` contract

This repo follows the **workspace-wide script contract** — the same script _names_ across every
sibling repo so muscle memory and CI carry across projects. SSOT + full table:
`dufflebag/templates/mdFiles/CODE-STYLE.md → Scripts`. Only `dev`/`build`/`start` bend to the stack.

- **Canonical names** — `dev` · `build` · `start` · `cli` · `test` (`vitest run`) · `test:watch` ·
  `typecheck` (`tsc --noEmit`) · `lint` · `lint:fix` (`biome check --write ./`) · `format` ·
  `check:ci` (`biome ci ./`) · `prepare` (`husky`) · `verify` — the one gate.
- **`ns:action`** — variants nest under `:` (`test:watch`, `lint:fix`, `verify:push`), never a dash.
- **One `verify` gate** — never re-split into `qa`/`quality`/`validate`.
- **`cli`** — the interactive front door (bare = menu, `-- <sub>` = direct, non-TTY never hangs).

_Aligned 2026-07-02:_ added `lint:fix`; `verify`/`verify:push`/`test:watch`/`check:ci` were already
present. This repo keeps a lint-only `lint` = `biome lint ./` plus its extra
`check:class-api`/`check:tsdoc`/`check:boundaries` gates, which `verify` chains after the canonical four.

## Rules

Load-bearing, project-specific rules. Each is a one-liner plus a real before/after.

### Cross-feature access goes through the feature's `index.ts` door — never its `internal/`

Within a feature, import its files directly with a relative path. **Across** features
(`src/features/*`), import only through that feature's **curated `index.ts` door** — a
file of **named** re-exports (`export { X } from "./providerRegistry.ts"`), never a
wildcard `export *`. Cross-feature imports use the **`@/` alias**, not `../../`. A
feature's service classes live in `internal/` and are private to it. Enforced by
`src/scripts/dev/checkBoundaries.mjs` (content-based; resolves `@/` and flags cross-feature
imports of any module declaring a non-error class).

```ts
// before  (src/features/terminal/internal/cliRunner.ts)
import { BridgeEngine } from "../../bridge/internal/bridgeEngine.ts";        // ✗ cross-feature service class
import { extractAllMessages } from "../../providers/chatgpt/chatgptPage.ts"; // ✗ deep provider import
// after — every cross-feature import goes through the door via @/
import { startEngine } from "@/features/bridge";                            // ✓ curated index.ts door
import { getBrowserProvider, loadManifest } from "@/features/providers";    // ✓ one door, named exports
```
_Why:_ one public surface per feature, one owner per file; `internal/` stays private and greppable.

### Static data lives in `src/config` (the SSOT); features hold behavior

Which providers exist, their metadata, and their core DOM selectors live in
`src/config/providersConfig.ts`; `BridgeProviderId` derives from it (`keyof`). Tunable
defaults live in `src/config/defaultsConfig.ts`. `src/config` imports nothing from
`features/*` — it is a leaf the features depend on. The provider registry reads the
table and binds behavior; a missing adapter is a compile error, never a stale copy.

```ts
// src/config/providersConfig.ts — data SSOT
export const PROVIDER_CONFIG = { chatgpt: { /* … */ selectors: { composer, assistant } } /* … */ }
  satisfies Record<string, ProviderConfigEntry>;
export type BridgeProviderId = keyof typeof PROVIDER_CONFIG;
// src/features/providers/providerRegistry.ts — behavior binds the data
export const PROVIDERS: Record<BridgeProviderId, BrowserProvider> = { /* … */ };
```
_Why:_ the old parallel provider list drifted to 2-of-6 and shipped a label bug; one keyed table can't.

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
// boundary — src/features/tools/internal/mcpServer.ts (invokeToolHandler)
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
// src/features/bridge/internal/bridgeEngine.ts
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
`src/scripts/dev/checkClassApi.mjs`), each delegating to a module-level `function`.
Private helpers live at module scope, not as private methods. **Exempt:** classes
implementing `BrowserProvider` (fixed ~17-method contract) and `Orchestrator`.
Every public method gets a single-line `/** … */` TSDoc (no types in
`@param`/`@returns`), enforced by `src/scripts/dev/checkTsdoc.mjs`.

### One canonical `PermissionMode`

The `read-only | ask | auto` type is `PermissionMode`, derived from
`PERMISSION_MODES` in `domain/permissions.ts`. Never redeclare it as a literal union.

```ts
// before  (domain/types/bridgeTypes.ts)      // after
export type BridgePermissionMode = "read-only" | "ask" | "auto";  // deleted
// use PermissionMode = (typeof PERMISSION_MODES)[number] everywhere
```

### No backward compatibility — replace in place, delete the old name

No `@deprecated` aliases, legacy shims, or old names kept "just in case." Rename or
replace a symbol and you update **every** call site and delete the old one in the **same**
change. `@deprecated` is the tell — enforced at zero in `src/` by
`src/scripts/dev/checkNoDeprecated.mjs` (chained into `verify`).

```ts
// before — src/features/bridge/createEngineFactory.ts (removed)
/** @deprecated Use {@link BridgeEngine} directly. */
export interface Engine { /* … a full duplicate of the BridgeEngine shape … */ }
export type { BridgeEngine as EngineInstance };   // ✗ alias kept for old imports
// after — one name; callers updated; alias and duplicate gone
export { BridgeEngine };
```
_Why:_ a dead alias (`Engine`, `EngineInstance`, `browserProfilePath`) rots into a second
source of truth; a pre-1.0 agent CLI guards no external API — git history is the archive.

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
- **A feature's implementation classes live in `internal/`;** its public surface is a
  curated **`index.ts` door** (named re-exports) at the feature root, alongside
  `*Types.ts`. Cross-feature code imports the door via the **`@/` alias**
  (`@/features/<name>`), never `internal/`. Static data belongs in `src/config`, not the feature.
- Verb prefixes: `is/has/get/build/resolve/load/create/read/capture/parse/normalize/
  find/wait/ensure/format`. Type suffixes: `*Input/*Options/*Result/*Context/*State/*Record`.
- **Directories stay kebab-case** (`input-suggestions/`, `user-config/`); classes/types
  `PascalCase`; module constants `SCREAMING_SNAKE_CASE`.

### Tests

- `*.test.ts` only (no `.spec.ts`), **co-located next to the module under test** —
  `loadConfig.test.ts` sits beside `loadConfig.ts`; a test of an `internal/` module
  lives in that same `internal/` dir. Tests are typechecked (`tsc` includes `src/**`)
  and run by vitest (`include: src/**/*.test.ts`); they never enter the bundle (tsup's
  entry is `src/main.ts`) and the gate scripts skip `*.test.ts`.
- **Test imports obey the same boundary rule as source:** the module under test and
  same-feature files are imported **relatively** (`./loadConfig.ts`, `../tui/App.tsx`);
  anything in another feature or shared support uses the **`@/` alias**
  (`@/features/store/paths.ts`, `@/test-support/fakeComposer.ts`).
- `import { describe, it, expect } from "vitest"` explicitly (no globals). `describe`
  names a symbol; `it` names the scenario condition in plain English.
- Real FS tests use `mkdtemp` + `chdir` in `beforeEach`/`afterEach`. Browser surfaces
  use `{} as unknown as Page` fakes; shared fakes live in `src/test-support/`.

## Recipes

### Add a Tool (MCP)
1. Define the handler in `tools/` returning `{ ok, output }`; validate params with a Zod schema.
2. Confine every path with the Sandbox (`isInsideRepo`) before any I/O.
3. Register it on the MCP server; gate it behind the right `PermissionMode`.
4. Test the pure handler with literal inputs; no real browser.

### Add a CLI command
- **Headless subcommand:** register in `terminal/registerCli.ts`; the action must
  redirect `console.log`→stderr, call the shared `startEngine`/`engine.ask` core,
  and end with an explicit `process.exit`. Never prompt in a non-TTY. **Exception —
  a long-running server (`serve`, the outbound MCP `ask` gateway): return the promise
  and block on the transport instead of exiting, and since stdout is then a JSON-RPC
  channel, redirect `console.info`/`debug` to stderr too.**
- **TUI slash command:** add to the metadata array + the `executeCommand` registry
  in `terminal/internal/cliRunner.ts`; both modes must call the same underlying function.
- Bare `bridge` opens the TUI in a TTY and defers (never mounts Ink) when non-TTY.

### Add a feature
Create `src/features/<name>/`, put the service class in `<name>/internal/`, and expose a
curated `<name>/index.ts` door (named re-exports) as its only cross-feature entry —
reached as `@/features/<name>`. Keep types in `*Types.ts`; static data goes in `src/config`.

### Add a web-chat provider
1. Add an entry to `config/providersConfig.ts` — metadata + `selectors` (composer,
   assistant, optional user/stop/signedOut). `BridgeProviderId`, `--provider` help, and
   `bridge login` all derive from it.
2. **Plain chat?** Nothing else — `providerRegistry.ts` builds a `GenericWebChatPage`
   from the config entry. **Bespoke DOM (like ChatGPT)?** Add
   `providers/<name>/<name>Page.ts` implementing `BrowserProvider`, read its core
   selectors from the config entry, and bind it in `providerRegistry.ts`.
3. A fake-page test co-located beside the provider (`providers/<name>/<name>Page.test.ts`,
   or `providers/` for the generic path); then verify selectors against the live,
   signed-in DOM (mark `LIVE-VERIFY` until confirmed).

## Exemplars

Write new code like these:
- `src/config/providersConfig.ts` — data SSOT: a keyed table with a derived id type.
- `src/features/providers/index.ts` — a curated door (named re-exports, no `export *`).
- `src/features/bridge/internal/orchestrator.ts` — thin facade delegating to module helpers.
- `src/features/domain/permissions.ts` — pure logic, derived types, guards.
- `src/features/tools/internal/mcpServer.ts` — the `{ ok, output }` boundary + Sandbox.

## Never

- Reach into another feature's `internal/`, or add a wildcard `export *` barrel (curated `index.ts` doors only).
- Keep a second provider list beside `config/providersConfig.ts`, or hardcode a tunable that duplicates `defaultsConfig`.
- Keep a backward-compat shim — a `@deprecated` alias, a legacy field, or an old name kept "just in case" (removed: `Engine`/`EngineInstance` in `createEngineFactory.ts`, `browserProfilePath` in `bridgeTypes.ts`). Rename = update every call site + delete the old name in the same change (`src/scripts/dev/checkNoDeprecated.mjs` enforces zero `@deprecated`).
- Re-introduce kebab-case files or invented dot-suffixes (`.class`/`.factory`/`.types`/`.config`).
- Re-add `scripts/merge-*.mjs`, `fix-imports.mjs`, or a file/function-size check.
- `any`, default exports, or a module-level arrow function.
- Throw out of an MCP handler, or use a thrown-error function as a boolean.
- Prompt (Ink or otherwise) in a non-TTY / headless path.
