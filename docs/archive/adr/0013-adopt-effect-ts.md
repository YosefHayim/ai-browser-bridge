# Adopt Effect as the core runtime

Status: accepted
Date: 2025-07-05

The codebase relied on thin facade classes, constructor injection, raw Promise-based async,
and unstructured error handling. This worked for the initial build but created drag as
complexity grew — concurrency is ad-hoc (`Promise.allSettled`), logging is raw `console.log`
(89 calls in `cliRunner.ts` alone), errors are split between two conventions (MCP handlers
return `{ ok, output }`, internals throw), and dependency wiring is manual constructor
plumbing with no compile-time guarantees.

## Decision

- **Adopt the `effect` ecosystem as the application runtime.** All new code is written
  Effect-first; existing features migrate one module at a time. The packages in scope:
  - `effect` core — `Effect`, `Layer`, `Context`, `Data`, `Schema`, `Config`, `Logger`,
    `Fiber`, `Stream`.
  - `@effect/platform-node` — `FileSystem`, `NodeRuntime.runMain`.
  - `@effect/cli` — replaces Commander for CLI definition and argument parsing.
  - `@effect/vitest` — `it.effect` test integration with automatic runtime provision.

- **Remove packages made redundant by Effect:**
  - `commander` — replaced by `@effect/cli` (typed commands, built-in help, Effect-native).
  - `zod` — replaced by `effect/Schema` (+ the `JSONSchema` adapter to satisfy the MCP SDK
    tool-registration contract, which expects JSON Schema objects).

- **Migration is gradual, not big-bang.** The boundary between Effect and legacy code is a
  thin `runPromise` adapter at each external SDK edge (MCP SDK handlers, Playwright calls,
  Ink render root). New features are pure Effect programs; existing features convert when
  touched.

## Consequences

- **Classes → Context.Tag + Layer.** Service classes are replaced by tag-identified services
  composed via layers. The "thin facade ≤5 methods" rule maps naturally to a service
  interface; the layer provides the implementation.
- **Typed errors via `Data.TaggedError`.** No more `throw new Error(…)` in internals. Each
  failure mode is a tagged discriminated union, carried in the `E` channel. MCP handler
  boundaries catch the typed error and return the existing `{ ok, output }` shape for
  backward compat with the SDK.
- **Structured logging via `Effect.log`.** Console calls are replaced by Effect's built-in
  logger; the log level, format, and destination are configured per-layer (stderr in stdio
  mode, pretty in TUI mode).
- **Structured concurrency via fibers.** Fan-out uses `Effect.forEach` with `{ concurrency }`
  or `Effect.forkDaemon` — cancellation propagates, no orphaned promises.
- **CLI is a first-class Effect program.** `@effect/cli` defines commands, subcommands, and
  options as Effect values; the top-level `NodeRuntime.runMain` runs the whole tree.
- **Tests use `@effect/vitest`.** `it.effect` provides a test runtime with layer injection,
  deterministic scheduling, and typed assertions on the error channel.
- **One `runPromise` adapter at SDK edges.** Playwright page interactions, MCP SDK tool
  handlers, and the Ink `render()` call are the only places where Effect meets non-Effect
  code; each gets a single `Effect.runPromise` (or `runFork`) bridge.
- **New contributors must know Effect basics.** The learning curve is real; mitigated by
  linking the Effect docs in CONTRIBUTING and keeping a `src/test-support/` layer preset for
  easy test authoring.
