# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT, Gemini, Claude, DeepSeek, Grok, or Perplexity in Chrome (one provider or fanned out) and exposes sandboxed local repo tools over MCP (ChatGPT only).

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/config/providersConfig.ts` — the provider data SSOT (ids, metadata, selectors)
3. `src/features/terminal/createCliFactory.ts` → `internal/cliRunner.ts`
4. `src/features/bridge/createEngineFactory.ts` → `internal/bridgeEngine.ts` → `internal/orchestrator.ts`
5. `src/features/providers/providerRegistry.ts` → `chatgpt/chatgptPage.ts` or `genericWebChatPage.ts`
6. `src/features/tools/server.ts` → `internal/mcpServer.ts`

## Feature ownership

| Feature | Owns | Main class |
|---------|------|------------|
| `bridge` | Engine start, orchestrator | `BridgeEngine`, `Orchestrator` |
| `providers/chatgpt` | ChatGPT DOM + MCP connector UI | `ChatGptPage` |
| `providers/gemini` | Gemini DOM | `GeminiPage` |
| `providers/chrome` | CDP attach, Chrome profiles | `BrowserManager` |
| `tools` | MCP server, sandbox, handlers | `McpServer` |
| `tunnel` | cloudflared | `CloudflareTunnel` |
| `terminal` | CLI, headless commands | `CliRunner` (+ `tui/` React components) |
| `store` | Sessions, checkpoints, logs | `SessionStore` |
| `domain` | Pure types, permissions, model catalog | (no classes) |
| `user-config` | `~/.ai-browser-bridge/` readers | `UserConfig` |

Cross-feature imports go through each feature's curated **`index.ts` door** via the **`@/` alias** (`@/features/<name>`) — never deep-import another feature's `internal/` or a service class directly. `src/config` is the shared data leaf (provider table + defaults) that features depend on. Enforced by `src/scripts/dev/checkBoundaries.mjs` (which resolves `@/`).

## Conventions

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

- **Filenames are `camelCase.ts`** — no kebab-case, no invented dot-suffixes. Fold the old role into the name (`browserProviderTypes.ts`, `createProviderFactory.ts`, `roleThemeConfig.ts`). **TUI React components stay `PascalCase.tsx`.** Only tool-mandated dots survive (`*.test.ts`, `tsup.config.ts`, `vitest.config.ts`). Directories stay kebab-case.
- **Tests are co-located** beside the module under test (`x.test.ts` next to `x.ts`; a test of an `internal/` module lives in that `internal/`); shared fakes in `src/test-support/`. Test imports follow the source boundary rule (same-feature relative, cross-feature `@/`). **Dev/gate scripts live in `src/scripts/dev/`.**
- **One service class per module**, `PascalCase`, in the feature's **`internal/`**. The feature's public surface is a curated **`index.ts` door** (named re-exports, never `export *`) at its root; cross-feature code imports it as **`@/features/<name>`**.
- **Thin facades:** ≤5 **public** methods (CI-enforced via `check:class-api`), each delegating to module-level `function` helpers. **Exempt:** `BrowserProvider` implementers (~17-method contract) and `Orchestrator`. Private logic lives at module scope, not as private methods.
- **TSDoc** — single line, no types in `@param`/`@returns` — on every **public** method (CI-enforced via `check:tsdoc`).
- **Named exports only**, no default exports. `function` declarations for module helpers; arrows only inline.
- **No `any`** — `unknown` + type guards. `strict` + `noUncheckedIndexedAccess`. One `PermissionMode` (from `PERMISSION_MODES`).
- **Errors:** MCP handlers return `{ ok, output }`; internals throw; one catch-net per boundary. Non-critical I/O is fire-and-forget (`await x.catch(() => {})`).
- **`src/config` is the data SSOT** — provider metadata + core selectors (`providersConfig.ts`) and tunable defaults (`defaultsConfig.ts`). `BridgeProviderId` derives from `PROVIDER_CONFIG` (`keyof`); features read config and bind behavior, never the reverse.
- **Big provider/CLI classes are legitimate hand-edited source** — no merge/concat build, no file/function-size rule.
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
