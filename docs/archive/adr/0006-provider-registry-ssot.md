# Provider registry as SSOT, fail-loud on unknown providers

The supported provider set was hardcoded in **five** places: the `BridgeProviderId`
union (`browser-provider.types.ts`), the `PROVIDERS` record and the `normalizeProvider`
if-ladder (`create-provider.factory.ts`), and four `--provider` help strings in
`register-cli.ts`. Worse, `normalizeProvider` **silently coerced any unknown value to
`chatgpt`** — an agent running `--provider claude` got ChatGPT with no error. This
blocks scaling to more providers and is hostile to the agents the CLI targets.

## Decision

- **One registry is the SSOT** (`providers/providerRegistry.ts`): a `PROVIDERS` object
  keyed by id. Everything derives from it —
  `type BridgeProviderId = keyof typeof PROVIDERS`, `PROVIDER_IDS`, and the CLI
  `--provider` help text. Adding a provider is **one line** in `PROVIDERS`.
- **Fail loud.** `normalizeProvider` resolves aliases then checks membership; an
  explicit unknown value throws `UnknownProviderError` listing the valid ids. Empty or
  absent still returns `DEFAULT_PROVIDER` (`chatgpt`) — the no-flag default is preserved.
- **`BrowserProvider.id` is `string`,** not `BridgeProviderId`, to break the type cycle
  (`BrowserProvider → id → keyof PROVIDERS → BrowserProvider`). The registry keys are the
  authoritative id set; the field is just a registry key carried on the adapter.
- **`UnknownProviderError` lives in its own module** so `providerRegistry.ts` declares no
  class and stays importable across features (it is the public door the whole app uses).
  The boundary checker exempts `Error` subclasses, so the error module is shareable too.
- The old `create-provider.factory.ts` is renamed `providerRegistry.ts` — the honest name
  for what it now is.

## Consequences

- Adding Claude/DeepSeek/Grok/Perplexity (Phase 3) is a config module + one registry
  line; the id type, CLI help, and `bridge login` follow automatically.
- Agents get a clear, listed error instead of a wrong provider — the fix that makes a
  multi-provider agent CLI trustworthy.
- Slightly looser typing on `provider.id` (string) is the deliberate price of a
  single-edit registry; call sites compare it to registry keys, which remain exhaustive.

## Update (2026-07-02): the data SSOT moved to `src/config`

The provider *data* (ids, metadata, and core selectors) now lives in
`config/providersConfig.ts`; `BridgeProviderId` derives from it
(`keyof typeof PROVIDER_CONFIG`). `providers/providerRegistry.ts` **imports** that table
and binds behavior — a bespoke `*Page` class for ChatGPT/Gemini, the generic adapter
otherwise — under a `Record<BridgeProviderId, BrowserProvider>` that makes a missing
adapter a compile error. The dependency inverts (registry → config, config a pure leaf),
so there is still exactly one list and still fail-loud `UnknownProviderError`; what
changed is that *data* now lives in config and *behavior* in the feature. See ADR 0009.
