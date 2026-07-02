# Provider adapters via a generic selector-driven web-chat page

Phase 3 adds four providers — Claude, DeepSeek, Grok, Perplexity. The two existing
adapters (`ChatGptPage`, `GeminiPage`) are large bespoke classes (~600–4700 lines) of
selectors and streaming logic hardened against the live DOM. Replicating that ×4 up
front — against sites we cannot drive headless in this environment — would be guessed
code masquerading as working code.

## Decision

- **One generic adapter, `GenericWebChatPage`,** implements the full `BrowserProvider`
  interface from a `WebChatProfile` selector set (composer, assistant container,
  optional stop/signed-out/user selectors). The three near-clones (Claude, DeepSeek,
  Grok) are a ~15-line config each: `new GenericWebChatPage({...})`. This is the honest,
  DRY scaffold — real behaviour driven by selectors, not four hand-forged monoliths.
- **Perplexity is the shape outlier.** It uses the generic adapter too, but its
  answer-engine DOM interleaves citations/sources, so its `captureLastResponse` will
  carry citation noise until a Perplexity-specific override strips it — flagged in the
  config.
- **Everything is marked `LIVE-VERIFY`.** The selectors are a starting point; each must
  be confirmed against the real, signed-in DOM. Sidebar history, model switching, and
  prompt rewind are stubbed generically (empty / not-supported) where no stable
  cross-provider affordance exists. The generic methods degrade gracefully (catch →
  empty) when a selector misses, so a wrong selector never crashes a fan-out.
- **A complex provider may still graduate to a bespoke `*Page.ts` class** (like ChatGPT)
  when the generic adapter is insufficient — the registry doesn't care which it gets.

## Consequences

- Adding each provider was one registry line + one config, exactly as ADR 0006 promised;
  the CLI `--provider` help, id type, and `bridge login` picked them up automatically.
- Unit tests cover the generic adapter's pure/observable behaviour (field mapping,
  model-label heuristic, sign-in check, last-response capture) and registry membership;
  the live DOM interactions are the explicit follow-up.
- What needs hands-on iteration, per provider: verify `composerSelector`,
  `assistantSelector`, `stopSelector`, `signedOutSelector` against the signed-in site;
  add a bespoke reply extractor for Perplexity.
