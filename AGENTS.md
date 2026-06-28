# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT or Gemini in Chrome and exposes sandboxed local repo tools over MCP (ChatGPT only).

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/features/terminal/create-cli.factory.ts` → `cli-runner.class.ts`
3. `src/features/bridge/create-engine.factory.ts` → `bridge-engine.class.ts`
4. `src/features/bridge/orchestrator.class.ts`
5. `src/features/providers/create-provider.factory.ts` → `chatgpt-page.class.ts` or `gemini-page.class.ts`
6. `src/features/tools/create-mcp-server.factory.ts` → `mcp-server.class.ts`

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

Cross-feature imports use **factories only** (`create-*.factory.ts`). Never deep-import another feature's internals.

## Class conventions

- One exported class per `*.class.ts` file
- Service classes: ≤5 **public** methods (CI enforced)
- **Exempt:** classes implementing `BrowserProvider` (fixed ~17-method contract)
- Selectors, DOM snippets, and static config live **inside** the class file (no companion config files in provider folders)
- Private methods: no statement/param limits; compose freely inside the class
- JSDoc on **every** class method (public + private)

## Config files

Static defaults only in `src/config/*.config.ts` — `const` objects/arrays, no functions, no I/O.

## Verification

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm check:class-api && pnpm check:jsdoc
```

## Safety

- All file ops through sandbox validation
- No raw shell in MCP tools
- Do not commit unless explicitly asked
- TypeScript strict, no `any`
