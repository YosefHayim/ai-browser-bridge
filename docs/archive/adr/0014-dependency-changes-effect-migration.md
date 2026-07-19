# Dependency changes for Effect migration

Status: accepted
Date: 2025-07-05

## Context

The Effect adoption (ADR 0013) changes the dependency picture. The previous baseline
(ADR 0004) listed 7 runtime + 8 dev deps.

## Decision

### Remove

| Package | Reason |
|---------|--------|
| `commander` (^14.0.3) | Replaced by `@effect/cli` |
| `zod` (^4.0.0) | Replaced by `effect/Schema` + `JSONSchema.make` adapter for MCP SDK |

### Add (runtime)

| Package | Purpose |
|---------|---------|
| `effect` | Core runtime: Effect, Layer, Context, Data, Schema, Config, Logger, Fiber, Stream |
| `@effect/platform` | FileSystem, HTTP client (platform-agnostic interfaces) |
| `@effect/platform-node` | Node.js implementations (NodeRuntime.runMain, NodeFileSystem) |
| `@effect/cli` | CLI framework — typed options, Schema-validated args, auto help |

### Add (dev)

| Package | Purpose |
|---------|---------|
| `@effect/vitest` | `it.effect` test integration, Layer provision |

### Keep (unchanged)

| Package | Reason |
|---------|--------|
| `@modelcontextprotocol/sdk` | Core product — MCP protocol |
| `ink` (+ `ink-text-input`) | TUI renderer (React for terminal) |
| `react` | Ink's renderer |
| `playwright` | Browser automation (runtime, not just testing) |
| `@biomejs/biome` (dev) | Formatter + linter |
| `typescript` (dev) | Type checking |
| `tsup` (dev) | Bundler |
| `vitest` (dev) | Test runner (used via `@effect/vitest`) |
| `husky` + `lint-staged` (dev) | Pre-commit hooks |

## Consequences

- Net: 7→9 runtime deps (+`effect`, +`@effect/platform`, +`@effect/platform-node`,
  +`@effect/cli`, −`commander`, −`zod`).
- Dev: 8→9 (+`@effect/vitest`).
- MCP SDK needs a `Schema→JSONSchema` adapter since Zod is removed.
- `effect` is a large package but tree-shakes well with tsup/esbuild.
