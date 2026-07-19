# No backward compatibility — replace in place, enforced

`createEngineFactory.ts` carried a dead `@deprecated Engine` interface (a full duplicate of
the `BridgeEngine` shape) plus a `BridgeEngine as EngineInstance` alias; `bridgeTypes.ts`
carried a `@deprecated browserProfilePath` field. All three were unreferenced — kept only
"just in case" some old import needed them. For a pre-1.0, unpublished agent CLI with no
external API to protect, a compat shim is pure cost: a second source of truth that drifts
(the same failure mode that shipped the 2-of-6 provider-list label bug, ADR 0006).

## Decision

- **No backward compatibility.** No `@deprecated` aliases, legacy shims, or old names kept
  for old callers. Renaming or replacing a symbol updates every call site and deletes the
  old name in the **same** change.
- **Enforced, not just documented.** `src/scripts/dev/checkNoDeprecated.mjs` fails if any
  `@deprecated` appears under `src/`; it is chained into `pnpm verify` and the `checks.yml`
  CI leg, beside `check:class-api` / `check:tsdoc` / `check:boundaries`.
- **Scope: API/type shims only.** Tolerating old on-disk *data* (e.g. the legacy
  attachment-manifest counters in `chatgptPage.ts`) and domain data named "legacy" (old
  model ids ChatGPT still renders, `openaiProfiles.ts`) are **not** back-compat — they are
  live behavior, out of this gate's scope.

## Consequences

- One name per concept; git history is the archive for what a symbol used to be called.
- The tell (`@deprecated`) is greppable and gated, so a shim cannot quietly reappear.
- When a real external consumer eventually exists (post-publish, ADR 0008), a deliberate
  deprecation policy can supersede this ADR — a conscious choice, not drift-by-default.
