# AGENTS.md — ai-browser-bridge

Terminal CLI that drives ChatGPT or Gemini in Chrome and exposes sandboxed local repo tools over MCP (ChatGPT only).

## Read order (humans, no AI required)

1. `src/main.ts`
2. `src/features/terminal/create-cli.factory.ts`
3. `src/features/bridge/create-engine.factory.ts`
4. `src/features/bridge/orchestrator.ts`
5. `src/features/providers/create-provider.factory.ts`
6. Provider folder for browser work (`chatgpt/` or `gemini/`)
7. `src/features/tools/` for MCP

## Feature ownership

| Feature | Owns |
|---------|------|
| `bridge` | Engine start, orchestrator, context counter |
| `providers/chatgpt` | ChatGPT DOM + MCP connector UI |
| `providers/gemini` | Gemini DOM |
| `providers/chrome` | CDP attach, Chrome profiles |
| `tools` | MCP server, sandbox, handlers |
| `tunnel` | cloudflared |
| `terminal` | CLI, TUI, slash commands |
| `store` | Sessions, checkpoints, logs, paths |
| `domain` | Pure types, permissions, model catalog |
| `user-config` | `~/.ai-browser-bridge/` readers |

Cross-feature imports use **factories only** (`create-*.factory.ts`). Never deep-import another feature's internals.

## Style limits (CI enforced)

| Rule | Limit |
|------|-------|
| File | ≤100 lines (imports + blanks included) |
| Function body | ≤5 non-blank statements |
| Parent/exported orchestrator params | ≤5 |
| Child/helper params | **1** (use a context object) |
| Types | JSDoc on every `interface`, `type`, and property |

## Config files

Static data only in `src/config/*.config.ts` or `features/**/**/*.config.ts` — `const` objects/arrays, no functions, no I/O.

## Pipelines

Parent functions compose single-arg child steps:

```ts
export async function setupConnector(page, url, opts) {
  const ctx = createConnectorContext(page, url, opts);
  await openSettings(ctx);
  await openAppsPanel(ctx);
  return finalizeConnector(ctx);
}
```

## Verification

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm check:lines && pnpm check:functions
```

## Safety

- All file ops through sandbox validation
- No raw shell in MCP tools
- Do not commit unless explicitly asked
- TypeScript strict, no `any`
