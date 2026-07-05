# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT, Gemini, Claude, DeepSeek, Grok, or Perplexity in Chrome (one provider or fanned out) and exposes sandboxed local repo tools over MCP (ChatGPT only). It also serves an outbound MCP `ask` tool to other agents over stdio via `bridge serve`.

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/config/providersConfig.ts` — the provider data SSOT (ids, metadata, selectors)
3. `src/features/terminal/createCliFactory.ts` → `internal/cliRunner.ts`
4. `src/features/bridge/createEngineFactory.ts` → `internal/bridgeEngine.ts` → `internal/orchestrator.ts`
5. `src/features/providers/providerRegistry.ts` → `chatgpt/chatgptPage.ts` or `genericWebChatPage.ts`
6. `src/features/tools/server.ts` → `internal/mcpServer.ts`

## Feature ownership

| Feature | Owns | Main Tag |
|---------|------|----------|
| `bridge` | Engine start, orchestrator | `BridgeEngine` Tag, `Orchestrator` Tag |
| `providers/chatgpt` | ChatGPT DOM + MCP connector UI | `ChatGptPage` Tag |
| `providers/gemini` | Gemini DOM | `GeminiPage` Tag |
| `providers/chrome` | CDP attach, Chrome profiles | `BrowserManager` Tag |
| `tools` | MCP server, sandbox, handlers | `McpServer` Tag |
| `tunnel` | cloudflared | `CloudflareTunnel` Tag |
| `terminal` | CLI, headless commands | `CliRunner` Tag (+ `tui/` React components) |
| `store` | Sessions, checkpoints, logs | `SessionStore` Tag |
| `domain` | Pure types, permissions, model catalog | (no services) |
| `user-config` | `~/.ai-browser-bridge/` readers | `UserConfig` Tag |
| `agentGateway` | Outbound MCP `ask` tool served over stdio (`bridge serve`) | (no services) |

Cross-feature imports go through each feature's curated **`index.ts` door** via the **`@/` alias** (`@/features/<name>`) — never deep-import another feature's `internal/` or a service class directly. `src/config` is the shared data leaf (provider table + defaults) that features depend on. Enforced by `src/scripts/dev/checkBoundaries.mjs` (which resolves `@/`).

## Conventions

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

- **Full Effect adoption** — services are `Context.Tag` + `Layer` (no classes). Errors are `Data.TaggedError`. Logic uses `Effect.gen`. Pure helpers stay plain `function` declarations.
- **Filenames are `camelCase.ts`** — no kebab-case, no invented dot-suffixes. TUI React components stay `PascalCase.tsx`. Directories stay kebab-case.
- **Schema everywhere** — `effect/Schema` for all inputs (internal + boundary). Dedicated `<feature>Schemas.ts` per feature, re-exported through the door.
- **Tests are co-located** beside the module (`x.test.ts` next to `x.ts`); `@effect/vitest` with `it.effect` for all tests. Shared fakes in `src/test-support/`.
- **One service per module** in `internal/`. Feature's public surface is a curated **`index.ts` door** (named re-exports of Tag + Live Layer + schemas). Cross-feature imports via **`@/features/<name>`**.
- **TSDoc** with `@param`/`@returns` (no types) on every **public** function (CI-enforced via `check:tsdoc`).
- **Named exports only**, no default exports. `function` declarations for module helpers; arrows only inline.
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
