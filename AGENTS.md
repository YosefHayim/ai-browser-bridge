# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT or Gemini in Chrome and exposes sandboxed local repo tools over MCP (ChatGPT only).

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/features/terminal/createCliFactory.ts` → `cliRunner.ts`
3. `src/features/bridge/createEngineFactory.ts` → `bridgeEngine.ts`
4. `src/features/bridge/internal/orchestrator.ts`
5. `src/features/providers/createProviderFactory.ts` → `chatgpt/chatgptPage.ts` or `gemini/geminiPage.ts`
6. `src/features/tools/createMcpServerFactory.ts` → `mcpServer.ts`

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

Cross-feature imports go through **factories or public doors only** — never deep-import another feature's `internal/` or a service class directly. Enforced by `scripts/dev/checkBoundaries.mjs`.

## Conventions

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

- **Filenames are `camelCase.ts`** — no kebab-case, no invented dot-suffixes. Fold the old role into the name (`browserProviderTypes.ts`, `createProviderFactory.ts`, `roleThemeConfig.ts`). **TUI React components stay `PascalCase.tsx`.** Only tool-mandated dots survive (`*.test.ts`, `tsup.config.ts`, `vitest.config.ts`). Directories stay kebab-case.
- **One service class per module**, `PascalCase`, module named after it. A feature's implementation classes live in **`internal/`**; the feature's public surface (factory, door, types, config) sits at its root and re-exports them.
- **Thin facades:** ≤5 **public** methods (CI-enforced via `check:class-api`), each delegating to module-level `function` helpers. **Exempt:** `BrowserProvider` implementers (~17-method contract) and `Orchestrator`. Private logic lives at module scope, not as private methods.
- **TSDoc** — single line, no types in `@param`/`@returns` — on every **public** method (CI-enforced via `check:tsdoc`).
- **Named exports only**, no default exports. `function` declarations for module helpers; arrows only inline.
- **No `any`** — `unknown` + type guards. `strict` + `noUncheckedIndexedAccess`. One `PermissionMode` (from `PERMISSION_MODES`).
- **Errors:** MCP handlers return `{ ok, output }`; internals throw; one catch-net per boundary. Non-critical I/O is fire-and-forget (`await x.catch(() => {})`).
- **Static config** only in `*Config.ts` — `const` objects/arrays, no functions, no I/O. Provider selectors/DOM live inside the provider class file.
- **Big provider/CLI classes are legitimate hand-edited source** — no merge/concat build, no file/function-size rule.
- **Formatting** is Biome (`pnpm format`) — never hand-argue style.

## Verification

```bash
pnpm verify   # biome ci + typecheck + test + build + check:class-api + check:tsdoc + check:boundaries
```

## Safety

- All file ops through sandbox validation
- No raw shell in MCP tools
- Do not commit unless explicitly asked
- TypeScript strict (+ `noUncheckedIndexedAccess`), no `any`
- No cross-feature service-class imports; reach another feature only via its factory/door (`check:boundaries`)
