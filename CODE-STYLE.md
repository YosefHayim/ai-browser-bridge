# CODE-STYLE.md

How code is written in ai-browser-bridge. **Prescriptive** (how to write), not
descriptive (what exists — that's `AGENTS.md`). The load-bearing rules are mirrored
into the `AGENTS.md` `## Conventions` digest; **this file is the source — edit
here.** `deslop` reads this file to enforce style per-diff.

## Stack & framework practices

| Layer | Library | Role |
|-------|---------|------|
| Runtime & DI | `effect`, `@effect/platform-node` | Effect-first services, Layers, typed errors, resource management |
| CLI | `@effect/cli` | Command parsing, options, args — replaces Commander |
| Validation | `effect/Schema` | All internal + boundary schemas — replaces Zod |
| TUI | Ink / React | Terminal UI components (unchanged) |
| Browser | Playwright + CDP | Drives Chrome tabs |
| MCP | MCP SDK | Tool server exposed to ChatGPT |
| Tunnel | cloudflared | Ephemeral public HTTPS |
| Test | `@effect/vitest`, vitest | `it.effect` for all tests |

**Migration strategy:** Effect-first, feature-by-feature. New code is always Effect.
Existing code migrates when touched. No backward-compat wrappers — replace in place.

Formatting is owned by **Biome** (`biome.json`) — never hand-argue quotes/semis/
width; run `pnpm format`. See `docs/archive/adr/0002-adopt-biome-and-unified-ci.md`.

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

Load-bearing, project-specific rules. Each tagged:
- **[lint: `<rule>`]** — CI-enforced, zero tolerance.
- **[taste]** — team convention, not machine-checked (yet).

---

### 1. Cross-feature access through the feature's `index.ts` door [lint: check:boundaries]

✓ Cross-feature imports use the feature `index.ts` door.
✗ Deep-importing another feature's `internal/` or a service class.

Within a feature, import its files directly with a relative path. **Across** features
(`src/features/*`), import only through that feature's `index.ts` door. Index doors
are wildcard barrels (`export * from "./module.ts"`) so the source module owns its
public names. Wildcard exports are allowed only in `index.ts` / `index.tsx`. Cross-feature
imports use the **`@/` alias**, not `../../`. Enforced by
`src/scripts/gates/checkBoundaries.mjs` (content-based; resolves `@/`).

```ts
// ✗ cross-feature deep import
import { BridgeEngine } from "../../bridge/internal/bridgeEngine.ts";
// ✓ curated door via @/
import { startEngine } from "@/features/bridge";
```

---

### 2. Module-scope `const` arrow helpers, not private methods or declarations [taste]

✓ Private logic lives at module scope as `const` arrow functions.
✗ Private methods on classes/services or named `function` declarations.

Service Tags are thin facades; heavy lifting lives in plain functions beside them.
This keeps logic testable independently of the DI graph.

```ts
// ✓ module-scope helper
const resolveAbsPath = (rel: string, root: string): string => { /* … */ };

// inside the Layer
const SandboxLive = Layer.succeed(Sandbox, { validate: (p) => resolveAbsPath(p, root) });
```

---

### 3. Full Effect adoption — Effect-first, migrate feature-by-feature [taste]

✓ New code starts as Effect services with Tag + Layer.
✗ New classes, new `async function` services, new `try/catch` patterns.

Every new feature is an Effect service from day one. Existing code migrates when
touched — no partial wrappers, no `Effect.promise(() => oldService.doThing())` long-term.

---

### 4. Context.Tag + Layer replace classes entirely [taste]

✓ `Context.Tag` for the service identity; `Layer.effect` / `Layer.succeed` for implementation.
✗ `class FooService { … }` with constructor injection.

```ts
// ✓ Tag + Layer (one file)
export class Sandbox extends Context.Tag("Sandbox")<Sandbox, SandboxShape>() {}
export const SandboxLive = Layer.effect(Sandbox, Effect.gen(function* () { /* … */ }));

// ✗ class-based service
export class SandboxService { constructor(private root: string) {} }
```

---

### 5. Data.TaggedError + Effect.catchTag [lint: effect/no-untyped-errors]

✓ All errors are `Data.TaggedError` subclasses with a `_tag` discriminant.
✗ `throw new Error(…)`, untyped `Effect.fail("string")`.

```ts
export class PathEscapesRoot extends Data.TaggedError("PathEscapesRoot")<{
  readonly path: string;
  readonly root: string;
}> {}

// catching
pipe(effect, Effect.catchTag("PathEscapesRoot", (e) => /* … */));
```

---

### 6. One `runPromise` at external SDK edges only [lint: effect/no-inner-run]

✓ `Effect.runPromise` / `NodeRuntime.runMain` at the outermost boundary (CLI entry, MCP handler, test).
✗ `runPromise` inside a service or helper to "bridge" into Effect.

```ts
// ✓ edge — MCP handler
async invoke(args: unknown) {
  return Effect.runPromise(handleTool(args).pipe(Effect.provide(AppLive)));
}
// ✗ inside a service
const result = await Effect.runPromise(someEffect); // NEVER
```

---

### 7. Tag + Live in one `camelCase.ts` file [taste]

✓ The service Tag and its Live Layer colocate in a single module.
✗ Splitting Tag into `fooTag.ts` and Layer into `fooLive.ts`.

```text
src/features/store/internal/sessionStore.ts   ← exports SessionStore (Tag) + SessionStoreLive (Layer)
```

---

### 8. Doors export the public surface only [taste]

✓ `index.ts` re-exports the feature modules that form the public contract.
✗ Re-exporting private helpers or forwarding from compatibility files.

```ts
// src/features/store/index.ts
export * from "./internal/sessionStore.ts";
```

Feature-owned errors are public only when public APIs throw/fail with them; otherwise
they stay beside the internal module that raises them. Consumers catch Effect errors by
`_tag` when possible and import error classes only at tests or edge assertions.

---

### 9. `src/config` is one Schema leaf; `Effect.Config` for env [taste]

✓ Static provider metadata + defaults = one `src/config/index.ts`, validated with
  `Schema.decodeUnknownSync` (fail-fast at load).
✓ Runtime env knobs = `Effect.Config` / `Config.string(…)` in the same module.
✗ Split tables across files, hardcode a second provider list, or import features.

```ts
// src/config/index.ts — Schema + data SSOT
export const PROVIDER_CONFIG = Schema.decodeUnknownSync(ProviderConfigTableSchema)({ /* … */ });
export type BridgeProviderId = keyof typeof PROVIDER_CONFIG;
export const McpPortConfig = Config.integer("BRIDGE_MCP_PORT").pipe(
  Config.withDefault(DEFAULT_MCP_PORT),
);
```

---

### 10. `Effect.gen` default, `pipe` for one-liners [taste]

✓ `Effect.gen(function* () { … })` for multi-step logic.
✓ `pipe(effect, Effect.map(…))` when it fits one line.
✗ Deep `pipe` chains that could be clearer as `gen`.

```ts
// ✓ gen for multi-step
const program = Effect.gen(function* () {
  const sandbox = yield* Sandbox;
  const abs = yield* sandbox.validate(path);
  return yield* fs.readFileString(abs);
});

// ✓ pipe for a one-liner
const uppered = pipe(name, Effect.map(String.toUpperCase));
```

---

### 11. Pure helpers stay plain TypeScript [taste]

✓ Functions that take values and return values (no I/O, no errors) are plain TS.
✗ Wrapping `const add = (a, b) => a + b` in `Effect.succeed`.

```ts
// ✓ plain TS — no Effect overhead for pure logic
const isInsideRepo = (absPath: string, repoRoot: string): boolean => {
  return absPath.startsWith(repoRoot + "/");
};
```

---

### 12. Fire-and-forget: `forkDaemon` + silent swallow [taste]

✓ Non-critical I/O (logging, session events) uses `Effect.forkDaemon` with `Effect.catchAll(() => Effect.void)`.
✗ Blocking the main fiber on a log write; surfacing log failures to the user.

```ts
// ✓
yield* appendSessionEvent(event).pipe(
  Effect.catchAll(() => Effect.void),
  Effect.forkDaemon,
);
```

---

### 13. `NodeRuntime.runMain` as entrypoint [lint: effect/use-node-runtime]

✓ `src/main.ts` calls `NodeRuntime.runMain(program)` — one place, top of the world.
✗ `Effect.runPromise(…).catch(console.error)` as the entry.

```ts
// src/main.ts
import { NodeRuntime } from "@effect/platform-node";
NodeRuntime.runMain(program);
```

---

### 14. Tags PascalCase no suffix; Layers `Live` / `Test` [taste]

✓ `Sandbox`, `SessionStore`, `Tunnel` — no `Service`/`Tag`/`Svc` suffix.
✓ `SandboxLive`, `SandboxTest` — Layer suffix is the variant.
✗ `SandboxService`, `SandboxTag`, `SandboxLayer`.

---

### 15. Schema everywhere (internal + boundary) [taste]

✓ `Schema.Struct`, `Schema.Literal`, `Schema.Union` for all structured data.
✗ Zod schemas, `z.object(…)`, manual `typeof` validation on structured data.

```ts
import { Schema } from "effect";

const ToolResult = Schema.Struct({
  ok: Schema.Boolean,
  output: Schema.String,
});
type ToolResult = typeof ToolResult.Type;
```

---

### 16. Dedicated `<feature>Schemas.ts` per feature [taste]

✓ One `<feature>Schemas.ts` file holds all schemas for that feature.
✗ Schemas scattered across multiple files or inlined in service logic.

```text
src/features/tools/internal/toolsSchemas.ts    ← GrepArgs, ReadFileArgs, ApplyPatchArgs, etc.
src/features/store/internal/storeSchemas.ts    ← SessionMetadata, EventRecord, etc.
```

---

### 17. `@effect/cli` replaces Commander [taste]

✓ CLI commands defined with `Command.make`, options with `Options.text` / `Options.boolean`.
✗ `commander` / `program.command(…).option(…).action(…)`.

```ts
import { Command, Options } from "@effect/cli";

const repo = Options.directory("repo").pipe(Options.withDefault("."));
const ask = Command.make("ask", { repo, prompt: Options.text("prompt") }, ({ repo, prompt }) =>
  Effect.gen(function* () { /* … */ }),
);
```

---

### 18. Playwright unwrapped — providers are the Tag [taste]

✓ The provider service Tag (`ChatGpt`, `Gemini`) owns the Playwright `Page` internally.
✗ A generic `Browser` Tag that wraps Playwright; Effect managing Playwright's lifecycle with `Scope`.

Playwright has its own lifecycle (`browser.close()`). The provider Layer acquires the
page in `Layer.scoped` and exposes domain methods — `sendPrompt`, `captureReply` — not
raw Playwright primitives.

---

### 19. `@effect/platform-node` FileSystem [taste]

✓ `yield* FileSystem.FileSystem` for all file I/O in Effect code.
✗ Raw `fs/promises` in Effect services (plain helpers exempt per rule 11).

```ts
import { FileSystem } from "@effect/platform";

const content = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path);
});
```

---

### 20. `@effect/vitest` — `it.effect` for ALL tests [lint: check:tsdoc]

✓ Every test case uses `it.effect(…)` so the Effect runtime is available.
✗ `it("…", async () => { await Effect.runPromise(…) })` — no manual run in tests.

```ts
import { describe, it } from "@effect/vitest";

describe("Sandbox", () => {
  it.effect("rejects paths escaping repo root", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const result = yield* sandbox.validate("../../etc/passwd").pipe(Effect.either);
      expect(Either.isLeft(result)).toBe(true);
    }).pipe(Effect.provide(SandboxTest)),
  );
});
```

---

### 21. TSDoc on every public function [lint: check:tsdoc]

Every exported function-like value needs TSDoc with a summary, `@param` for every
parameter, `@returns`, and `@example` (no types — TS infers those). Enforced by
`src/scripts/gates/checkTsdoc.mjs`. Placeholder docs are forbidden: no
`Input values`, `Value value`, `The <symbol> result`, or examples that only rename the
function call without showing a real domain shape.

```ts
/**
 * Validate that a path resolves inside the repo root.
 *
 * @param path - Candidate path from a tool call.
 * @param repoRoot - Absolute repository root.
 * @returns The absolute path when it stays inside the repo.
 * @example
 * ```ts
 * const absPath = ensureInsideRepo("README.md", "/repo");
 * ```
 */
```

---

### 22. Named exports only, zero default exports [lint: noDefaultExport, check:boundaries]

Every implementation export is named (`export class/const/type`). Feature doors are
`index.ts` files, and they use wildcard re-exports (`export * from "./module.ts"`)
directly to the source modules they expose. Do not create forwarding door files like
`server.ts`, `api.ts`, or `public.ts` just to re-export another module. Non-index files
never use wildcard re-exports. Re-export declarations live before imports; implementation
exports stay inline on the declaration they expose.

---

### 23. Direct imports only — no `as` aliases [lint: check:boundaries]

Import the symbol name you mean to use. Do not hide naming collisions with
`import { Foo as Bar }` or `import * as Foo`; rename the local declaration instead.

```ts
// ✗ import alias
import { McpServer as McpProtocolServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ✓ direct import; local wrapper gets the distinct project name
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export class McpHttpServer {}
```

---

### 24. Static constants in the module prologue [lint: check:boundaries]

Static SCREAMING_CASE constants — literal tables, regexes, selector arrays, and
`String.raw` snippets — live in the module prologue immediately after imports and
re-export declarations, before interfaces, type aliases, functions, classes, or runtime
exports. Do not hide hardcoded values between functions.

---

### 25. Regex and replacement readability [lint: check:boundaries]

Non-obvious regexes, replacement strings, and positional captures must explain the
raw shape being parsed. Prefer named captures. When using positional access such as
`match?.[1]`, add a nearby comment that says what capture group 1 represents.

```ts
const CHATGPT_CONVERSATION_PATH = /\/c\/([^/?#]+)/;

// Matches ChatGPT conversation URLs like https://chatgpt.com/c/abc-123?model=gpt-4o.
// Capture group 1 is abc-123, the conversation id after /c/.
const match = CHATGPT_CONVERSATION_PATH.exec(url);
return match?.[1] ?? null;
```

---

### 26. No `any` — `unknown` + type guards [lint: noExplicitAny]

`tsconfig` is `strict` with `noUncheckedIndexedAccess`. Untyped input is `unknown`,
narrowed by an `is*` guard or a Schema decode. Casts (`as`) are sparse and purposeful.

---

### 27. No backward compat — replace in place [lint: check:no-deprecated]

No `@deprecated` aliases, legacy shims, or old names kept "just in case." Rename or
replace a symbol and you update **every** call site and delete the old one in the **same**
change. Enforced at zero by `src/scripts/gates/checkNoDeprecated.mjs`.

---

### 28. File and directory naming [taste]

- **Files are `camelCase.ts`** — no kebab-case, no invented dot-suffixes.
- **Directories are `camelCase`** — no kebab-case feature or helper directories.
- **TUI React components stay `PascalCase.tsx`.**
- **Only tool-mandated dots survive:** `*.test.ts`, `tsup.config.ts`, `vitest.config.ts`, `biome.json`.
- Verb prefixes: `is/has/get/build/resolve/load/create/read/capture/parse/normalize/find/wait/ensure/format`.
- Type suffixes: `*Input/*Options/*Result/*Context/*State/*Record`.

---

### 29. Tests co-located, `@effect/vitest` explicit imports [taste]

`*.test.ts` only (no `.spec.ts`), **co-located next to the module under test**.
`import { describe, it } from "@effect/vitest"` explicitly (no globals).
`describe` names a symbol; `it` names the scenario condition in plain English.
Real FS tests use `@effect/platform-node` test layers or `mkdtemp` + scoped cleanup.

---

## Never

Effect tells (CI-enforced):

- `async/await` in Effect code — use `Effect.gen` + `yield*` [lint: effect/no-async-await]
- `try/catch` inside Effect code — use `Effect.catchTag` / `Effect.catchAll` [lint: effect/no-try-catch]
- Raw `Promise` returns from services — return `Effect<…>` [lint: effect/no-raw-promise]
- `console.*` anywhere — use `Effect.log` / `Effect.logDebug` [lint: no-console]
- Class-based services — use `Context.Tag` + `Layer` [lint: effect/no-class-services]
- `Effect.runPromise` / `runSync` inside the app — edges only [lint: effect/no-inner-run]

Project tells (existing):

- Reach into another feature's `internal/`, add a wildcard export outside an `index.ts` door, use named re-exports inside an index door, or place a re-export declaration after imports.
- Use import aliases (`import { Foo as Bar }` or `import * as Foo`) instead of direct imported names.
- Keep a second provider list beside `config/index.ts`, or hardcode a tunable that duplicates `DEFAULTS`.
- Keep a backward-compat shim — a `@deprecated` alias, a legacy field, or an old name kept "just in case."
- Hide static SCREAMING_CASE constants between functions instead of keeping them in the module prologue.
- Use positional regex captures like `match?.[1]` without a raw-shape comment or named capture.
- Ship placeholder TSDoc such as `Input values`, `Value value`, `The <symbol> result`, or a no-op example.
- Re-introduce kebab-case files/directories or invented dot-suffixes (`.class`/`.factory`/`.types`/`.config`).
- Re-add `scripts/merge-*.mjs`, `fix-imports.mjs`, or a file/function-size check.
- `any`, default exports, or a named `function` declaration.
- Throw out of an MCP handler — return `{ ok, output }` at the `runPromise` edge.
- Prompt (Ink or otherwise) in a non-TTY / headless path.
- Zod or Commander in new code (replaced by `effect/Schema` and `@effect/cli`).

## Recipes

### Add a Feature (Effect version)

1. Create `src/features/<name>/internal/` and `src/features/<name>/index.ts`.
2. Add `<name>Schemas.ts` at the feature root — all structured types for the feature.
3. Add `<name>Errors.ts` in `internal/` — `Data.TaggedError` subclasses.
4. Add the service file (`camelCase.ts`) in `internal/` — exports `Tag` + `Live` Layer.
5. Wire the `index.ts` door with `export * from "./module.ts"` entries.
6. Compose the Live Layer into `AppLive` in `src/main.ts` or the relevant parent Layer.
7. Test with `it.effect` providing a `Test` Layer variant.

```text
src/features/sandbox/
├── index.ts                  ← door: exports Sandbox, SandboxLive
├── sandboxSchemas.ts         ← Schema definitions
└── internal/
    ├── sandbox.ts            ← Tag + SandboxLive Layer
    ├── sandboxErrors.ts      ← PathEscapesRoot, etc.
    └── sandbox.test.ts       ← co-located, uses SandboxTest Layer
```

### Add a CLI command

Define with `@effect/cli`'s `Command.make`. Both TUI slash commands and headless
subcommands share the same core Effect program — the command just provides the
entry Layer and output mode.

```ts
const ask = Command.make("ask", { prompt: Options.text("prompt") }, ({ prompt }) =>
  Effect.gen(function* () {
    const engine = yield* BridgeEngine;
    return yield* engine.ask(prompt);
  }),
);
```

TUI slash commands still register in the Ink component but call the same underlying
Effect program. Non-TTY paths never prompt — they print JSON to stdout and exit.

### Add a Tool (MCP)

1. Define args with `Schema.Struct` in `toolsSchemas.ts`.
2. Write the handler as an `Effect<ToolResult, ToolError, Sandbox | FileSystem>`.
3. Validate paths with the `Sandbox` service before any I/O.
4. Register in the MCP server; gate behind `PermissionMode`.
5. At the MCP SDK boundary, `Effect.runPromise` converts the Effect to `{ ok, output }`.

```ts
const GrepArgs = Schema.Struct({ pattern: Schema.String, glob: Schema.optional(Schema.String) });

const handleGrep = (args: typeof GrepArgs.Type) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const root = yield* sandbox.repoRoot;
    // … grep logic …
    return { ok: true, output: matches.join("\n") };
  });
```

### Add a provider

1. Add entry to `config/index.ts` (`ProviderConfigTableSchema` + table) — metadata + selectors. `BridgeProviderId` derives.
2. Create the provider Tag + Live Layer in `providers/<name>/internal/<name>Page.ts`.
   - The Layer acquires a Playwright page via `Layer.scoped` and exposes domain methods.
   - Plain chat? Use `GenericWebChatPage` factory from config. Bespoke DOM? Implement the
     `BrowserProvider` interface shape as service methods.
3. Bind in `providerRegistry.ts`; the door exports the Tag + Live.
4. Test co-located; mark `LIVE-VERIFY` until selectors are confirmed against the live DOM.

## Exemplars

Write new code like these (note: some await migration to full Effect — the patterns are correct):

- `src/config/index.ts` — data SSOT: Schema-validated keyed table with a derived id type.
- `src/features/providers/index.ts` — a wildcard `index.ts` door.
- `src/features/providers/providerErrors.ts` — typed provider-wide errors.
- `src/features/providers/chatgpt/chatgptConversationUrl.ts` — provider-specific pure helper with regex capture comments.
- `src/features/bridge/internal/orchestrator.ts` — thin facade delegating to module helpers (will become Tag + Layer).
- `src/features/domain/permissions.ts` — pure logic, derived types, guards.
- `src/features/tools/internal/mcpServer.ts` — the `{ ok, output }` boundary + Sandbox.

## Canonical example — Provider cleanup slice

This is the target shape for a small refactor: provider-wide errors live at the
provider root, while ChatGPT-only URL semantics live under `providers/chatgpt/`.

```ts
// src/features/providers/providerErrors.ts
import { Data } from "effect";
import type { BridgeProviderId } from "@/config";

/** Error raised when a provider id is not part of the configured provider table. */
export class UnknownProviderError extends Data.TaggedError("UnknownProviderError")<{
  readonly value: string;
  readonly validProviders: readonly BridgeProviderId[];
}> {
  override get message(): string {
    return `Unknown provider "${this.value}". Valid providers: ${this.validProviders.join(", ")}.`;
  }
}

/** Error raised when a provider page is still showing an unauthenticated shell. */
export class GuestSessionError extends Data.TaggedError("GuestSessionError")<{
  readonly providerId: BridgeProviderId;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.providerId} is not signed in: ${this.reason}`;
  }
}

// src/features/providers/chatgpt/chatgptConversationUrl.ts
const CHATGPT_CONVERSATION_URL_PREFIX = "https://chatgpt.com/c/";
const CHATGPT_CONVERSATION_PATH = /\/c\/([^/?#]+)/;

/**
 * Extract a ChatGPT conversation id from a browser URL.
 *
 * @param url - Browser URL that may point at a ChatGPT conversation.
 * @returns Conversation id from a ChatGPT `/c/<id>` URL, or null for other URLs.
 * @example
 * ```ts
 * const conversationId = chatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123?model=gpt-4o");
 * ```
 */
export const chatGptConversationIdFromUrl = (url: string): string | null => {
  // Matches ChatGPT conversation URLs like https://chatgpt.com/c/abc-123?model=gpt-4o.
  // Capture group 1 is abc-123, the conversation id after /c/.
  const match = CHATGPT_CONVERSATION_PATH.exec(url);
  return match?.[1] ?? null;
};
```

## Reference example — Effect feature slice

A complete feature in the agreed style. Use this as the template for new features.

```ts
// ─── src/features/sandbox/internal/sandboxErrors.ts ───
import { Data } from "effect";

export class PathEscapesRoot extends Data.TaggedError("PathEscapesRoot")<{
  readonly path: string;
  readonly root: string;
}> {}

export class PathNotFound extends Data.TaggedError("PathNotFound")<{
  readonly path: string;
}> {}

// ─── src/features/sandbox/internal/sandboxSchemas.ts ───
import { Schema } from "effect";

export const ValidatePathInput = Schema.Struct({
  path: Schema.String,
});
export type ValidatePathInput = typeof ValidatePathInput.Type;

// ─── src/features/sandbox/internal/sandbox.ts ───
import { Context, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { PathEscapesRoot, PathNotFound } from "./sandboxErrors.ts";
import path from "node:path";

// ── pure helper (plain TS, rule 11) ──
const resolveAndConfine = (rel: string, root: string): string => {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + "/") && abs !== root) {
    throw new PathEscapesRoot({ path: rel, root });
  }
  return abs;
};

// ── service shape ──
export interface SandboxShape {
  /** Resolve a relative path, failing if it escapes the repo root. */
  readonly validate: (relativePath: string) => Effect.Effect<string, PathEscapesRoot>;
  /** Read a file that must be inside the repo. */
  readonly readConfined: (relativePath: string) => Effect.Effect<string, PathEscapesRoot | PathNotFound>;
  /** The absolute repo root. */
  readonly repoRoot: string;
}

// ── Tag ──
export class Sandbox extends Context.Tag("Sandbox")<Sandbox, SandboxShape>() {}

// ── Live Layer ──
export const SandboxLive = (root: string) =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return {
        repoRoot: root,
        validate: (relativePath) =>
          Effect.try({
            try: () => resolveAndConfine(relativePath, root),
            catch: (e) => e as PathEscapesRoot,
          }),
        readConfined: (relativePath) =>
          Effect.gen(function* () {
            const abs = yield* Effect.try({
              try: () => resolveAndConfine(relativePath, root),
              catch: (e) => e as PathEscapesRoot,
            });
            return yield* fs.readFileString(abs).pipe(
              Effect.catchTag("SystemError", () => Effect.fail(new PathNotFound({ path: relativePath }))),
            );
          }),
      };
    }),
  );

// ── Test Layer (in-memory, no real FS) ──
export const SandboxTest = (root: string, files: Record<string, string>) =>
  Layer.succeed(Sandbox, {
    repoRoot: root,
    validate: (relativePath) =>
      Effect.try({
        try: () => resolveAndConfine(relativePath, root),
        catch: (e) => e as PathEscapesRoot,
      }),
    readConfined: (relativePath) =>
      Effect.gen(function* () {
        const abs = resolveAndConfine(relativePath, root);
        const content = files[abs];
        if (content === undefined) return yield* Effect.fail(new PathNotFound({ path: relativePath }));
        return content;
      }),
  });

// ─── src/features/sandbox/index.ts (door) ───
export * from "./internal/sandbox.ts";
// errors stay internal — consumers catch by _tag string

// ─── src/features/sandbox/internal/sandbox.test.ts ───
import { describe, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { expect } from "vitest";
import { Sandbox, SandboxTest } from "../index.ts";

describe("Sandbox", () => {
  const TestLayer = SandboxTest("/repo", { "/repo/src/main.ts": "console.log('hi')" });

  it.effect("resolves a valid path inside the repo", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const abs = yield* sandbox.validate("src/main.ts");
      expect(abs).toBe("/repo/src/main.ts");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails with PathEscapesRoot for traversal", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const result = yield* sandbox.validate("../../etc/passwd").pipe(Effect.either);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("PathEscapesRoot");
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reads a confined file", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const content = yield* sandbox.readConfined("src/main.ts");
      expect(content).toBe("console.log('hi')");
    }).pipe(Effect.provide(TestLayer)),
  );
});
```

## Static data in `src/config`

`src/config/index.ts` is the **shared data leaf** — Schema-validated provider tables and
defaults, plus env-backed `Effect.Config` knobs. Features depend on it; it depends on
nothing from `features/`.

```ts
// src/config/index.ts — data SSOT
export const PROVIDER_CONFIG = Schema.decodeUnknownSync(ProviderConfigTableSchema)({ /* … */ });
export type BridgeProviderId = keyof typeof PROVIDER_CONFIG;
export const DEFAULTS = Schema.decodeUnknownSync(DefaultsSchema)({ /* … */ });
```

## Big provider pages are legitimate hand-edited source

Provider pages (`ChatGptPage`, `GeminiPage`) will migrate to Tag + Layer but remain
large by nature (~17 domain methods). There is **no** merge/concat build and **no**
file- or function-size rule. Keep them sectioned; delegate to module-level helpers.

## One canonical `PermissionMode`

The `read-only | ask | auto` type is `PermissionMode`, derived from
`PERMISSION_MODES` in `domain/permissions.ts`. Never redeclare it as a literal union.
This stays plain TS (rule 11 — pure logic).
