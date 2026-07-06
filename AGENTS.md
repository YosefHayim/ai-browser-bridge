# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT, Gemini, Claude, DeepSeek, Grok, or Perplexity in Chrome (one provider or fanned out) and exposes sandboxed local repo tools over MCP (ChatGPT only). It also serves outbound MCP `ask` and `search_conversations` tools to other agents over stdio via `bridge serve`.

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/config/providersConfig.ts` — the provider data SSOT (ids, metadata, selectors)
3. `src/features/terminal/createCliFactory.ts` → `internal/cliRunner.ts`
4. `src/features/bridge/createEngineFactory.ts` → `internal/bridgeEngine.ts` → `internal/orchestrator.ts`
5. `src/features/browser/index.ts` → `internal/browserManager.ts` / `internal/browserState.ts`
6. `src/features/providers/providerRegistry.ts` → `chatgpt/chatgptPage.ts` or `genericWebChatPage.ts`
7. `src/features/conversationCatalog/index.ts` → `internal/search.ts`
8. `src/features/tools/server.ts` → `internal/mcpServer.ts`

## Feature ownership

| Feature | Owns | Main Tag |
|---------|------|----------|
| `bridge` | Engine start, orchestrator | `BridgeEngine` Tag, `Orchestrator` Tag |
| `browser` | CDP attach, existing Chrome profile launch, browser status, generated-cache inventory/prune | `BrowserManager` Tag |
| `providers/chatgpt` | ChatGPT DOM adapter, MCP connector UI, provider-specific history source | `ChatGptPage` Tag |
| `providers/gemini` | Gemini DOM adapter | `GeminiPage` Tag |
| `conversationCatalog` | Conversation search input/result schemas, shared ranking/fallback search | (no services) |
| `tools` | MCP server, sandbox, handlers | `McpServer` Tag |
| `tunnel` | cloudflared | `CloudflareTunnel` Tag |
| `terminal` | CLI, headless commands | `CliRunner` Tag (+ `tui/` React components) |
| `store` | Sessions, checkpoints, logs | `SessionStore` Tag |
| `domain` | Pure types, permissions, model catalog | (no services) |
| `userConfig` | `~/.ai-browser-bridge/` readers | `UserConfig` Tag |
| `agentGateway` | Outbound MCP `ask` + `search_conversations` tools served over stdio (`bridge serve`) | (no services) |

Cross-feature imports go through each feature's curated **`index.ts` door** via the **`@/` alias** (`@/features/<name>`) — never deep-import another feature's `internal/` or a service class directly. `src/config` is the shared data leaf (provider table + defaults) that features depend on. Enforced by `src/scripts/dev/checkBoundaries.mjs` (which resolves `@/`).

## Conventions

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

- **Full Effect adoption** — services are `Context.Tag` + `Layer` (no classes). Errors are `Data.TaggedError`. Logic uses `Effect.gen`. Pure helpers stay plain `const` arrow functions.
- **Filenames and directories are camelCase** — no kebab-case, no invented dot-suffixes. TUI React components stay `PascalCase.tsx`.
- **Schema everywhere** — `effect/Schema` for all inputs (internal + boundary). Dedicated `<feature>Schemas.ts` per feature, re-exported through the door.
- **Tests are co-located** beside the module (`x.test.ts` next to `x.ts`); `@effect/vitest` with `it.effect` for all tests. Shared fakes in `src/testSupport/`.
- **One service per module** in `internal/`. Feature's public surface is an **`index.ts` door** with wildcard `export *` entries; wildcard exports are forbidden outside index doors. Re-export declarations live before imports. Cross-feature imports via **`@/features/<name>`**.
- **Static constants live in the prologue** — SCREAMING_CASE literal tables, regexes, selector arrays, and `String.raw` snippets go after imports/types and before functions/classes.
- **TSDoc** with `@param`/`@returns`/`@example` (no types) on every **public** function (CI-enforced via `check:tsdoc`).
- **Named exports only**, no default exports. Module helpers and exported functions are `const` arrows; named `function` declarations are disallowed except anonymous `function*` required by `Effect.gen`.
- **No `any`** — `unknown` + type guards. `strict` + `noUncheckedIndexedAccess`.
- **Errors:** `Data.TaggedError` at domain level; one `Effect.catchAll` at each SDK edge converts to the external format.
- **Never:** `async/await` in Effect code, `try/catch` in Effect code, `console.*`, class-based services, `Effect.run*` inside the app, raw Promise returns from services.
- **`src/config` is the data SSOT** — provider metadata + defaults. Plain `const` objects. `Effect.Config` for runtime values only.
- **`@effect/cli`** replaces Commander. CLI is a first-class Effect program.
- **`@effect/platform-node`** — FileSystem service, `NodeRuntime.runMain` as entrypoint.
- **Formatting** is Biome (`pnpm format`) — never hand-argue style.

## Verification

```bash
pnpm verify   # biome ci + typecheck + test + build + check:class-api + check:tsdoc + check:boundaries + check:no-deprecated
```

## Safety

- All file ops through sandbox validation
- No raw shell in MCP tools
- Do not commit unless explicitly asked
- TypeScript strict (+ `noUncheckedIndexedAccess`), no `any`
- No cross-feature service-class imports; reach another feature only via its `index.ts` door / `@/` alias (`check:boundaries`)
