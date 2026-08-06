# Plain TypeScript runtime with Effect at boundaries

Status: implemented — 2026-08-03

## Context

The runtime is already ordinary async TypeScript. Effect's Schema and Config modules
provide concrete value at untrusted-input and environment boundaries, but the platform
packages added a second runtime wrapper around a Commander CLI without owning its
lifecycle. The codebase does not use Effect services, Layers, or generator workflows.

## Decision

- Use TypeScript Promises and normal async functions for application flow.
- Use `effect/Schema` to decode untrusted data and derive boundary types.
- Use `Effect.Config` only for environment configuration.
- Keep Zod where an external SDK contract requires its schemas.
- Do not introduce Effect services, Layers, platform adapters, or generator workflows
  without a new decision tied to a concrete capability.
- Start the CLI directly with top-level `await`; Commander owns process lifecycle.

## Consequences

`@effect/platform` and `@effect/platform-node` are removed. The `effect` dependency
remains because Schema and Config have an explicit job. Runtime code has one async model,
and boundary validation remains schema-first.
