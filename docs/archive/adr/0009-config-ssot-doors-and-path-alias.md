# `src/config` data SSOT, curated `index.ts` doors, and the `@/` path alias

A structure grill surfaced three real problems in an otherwise sound feature-sliced
tree: (1) `src/config/providersConfig.ts` held a **stale, partial duplicate** of the
provider registry — a 2-of-6 list that made `getProviderDisplayName` return the raw id
for claude/deepseek/grok/perplexity (a live bug); (2) `config/defaultsConfig.ts` was
**dead code** while the same values were hardcoded elsewhere; (3) cross-feature imports
climbed `../../../` and the `internal/` convention was **collision-driven**, applied to
only 4 of the impl classes that had a name clash.

## Decision

- **`src/config` is the data SSOT.** `providersConfig.ts` is a keyed `PROVIDER_CONFIG`
  table for all six providers — metadata **and** core DOM selectors (composer, assistant,
  optional user/stop/signedOut). `BridgeProviderId = keyof typeof PROVIDER_CONFIG`. The
  dependency inverts: `config` imports nothing from `features/*` (a leaf), and
  `providers/providerRegistry.ts` imports the table and binds behavior under a
  `Record<BridgeProviderId, BrowserProvider>` (missing adapter → compile error).
  ChatGPT's and Gemini's bespoke `*Page` classes read their **core** selectors from
  config; their ~100 internal selectors stay in-class. `defaultsConfig.ts` is wired into
  its real sites (`loadConfig`, `bridgeEngine`, `mcpServer`, `registerCli`).
- **Curated `index.ts` door per feature.** Each feature exposes one `index.ts` of
  **named** re-exports — never `export *`, which would leak `internal/` and invite
  cycles. This reverses the earlier "pure re-export barrels are deleted" rule: a curated
  door is not a wildcard barrel.
- **`@/` alias for cross-feature imports.** The dormant `@/* → ./src/*` alias goes live;
  cross-feature imports read `@/features/<name>`, within-feature stays relative. tsc and
  esbuild resolve it natively; `vitest.config.ts` gains a `resolve.alias` (no new dep).
- **`internal/` is uniform.** Every impl class that has a door now lives in `internal/`
  (`BridgeEngine`, `McpServer`, `CliRunner`, `UserConfig` joined the earlier four).
  Provider `*Page` classes stay in their `chatgpt/`·`gemini/` subfolders (already
  encapsulated + registry-bound).
- **The boundary gate learns `@/`.** `src/scripts/dev/checkBoundaries.mjs` resolves the `@/`
  alias, so a cross-feature `@/features/<x>/internal/<class>` import is still flagged
  (verified with a deliberate red-test). Without this the gate would silently go blind.

## Consequences

- One provider list, id-typed from config; the display-label bug is fixed for all six.
- Call sites read `@/features/store` instead of `../../store/paths.ts`; every feature has
  the same shape — `index.ts` door + `internal/` impls + `*Types.ts`.
- Selector relocation is behavior-preserving (verbatim strings) but stays `LIVE-VERIFY`:
  the signed-in DOM can't be driven here, so the bespoke selectors are moved, not
  re-validated.
- Tests keep relative imports to specific modules (they legitimately reach `internal/`
  for unit testing) — the `@/` door rule is for `src/` cross-feature imports.
