# AGENTS.md — ai-browser-bridge

Durable repo instructions for Codex, Cursor, and other agents that read
`AGENTS.md`. Keep this file short: it is the routing map and working contract,
not a copied style guide.

## Project Contract

- This repo is a terminal CLI that drives ChatGPT, Gemini, Claude, DeepSeek,
  Grok, or Perplexity in Chrome and exposes sandboxed local repo tools over MCP.
- ChatGPT can use the inbound MCP tool server. Other local agents can use
  outbound MCP `ask` and `search_conversations` through `bridge serve`.
- Browser/profile ownership, provider metadata, and command defaults each have
  one source of truth. Do not duplicate those tables.

## Source Of Truth

- For code style, read `CODE-STYLE.md` before editing source, tests, scripts, or
  public docs.
- For product intent, read `PROJECT.md` before changing user-facing behavior.
- For domain language, read `LANGUAGE.md` before renaming concepts, tools,
  commands, or public APIs.
- For architecture context, read `CONTEXT.md` before moving feature ownership or
  changing cross-feature imports.

## Read Order

1. `src/main.ts`
2. `src/config/index.ts` — provider data + defaults SSOT (Effect Schema)
3. `src/features/terminal/createCliFactory.ts` → `internal/cliRunner.ts`
4. `src/features/bridge/createEngineFactory.ts` → `internal/bridgeEngine.ts` → `internal/orchestrator.ts`
5. `src/features/browser/index.ts` → `internal/browserManager.ts` / `internal/browserState.ts`
6. `src/features/providers/providerRegistry.ts` → provider adapters
7. `src/features/conversationCatalog/index.ts` → `internal/search.ts`
8. `src/features/tools/index.ts` → `createMcpServerFactory.ts` → `internal/mcpServer.ts`

## Feature Ownership

| Feature | Owns | Main handle |
|---------|------|-------------|
| `bridge` | Engine start, orchestrator | `BridgeEngine`, `Orchestrator` |
| `browser` | CDP attach, shared bridge profile launch, browser status, generated-cache inventory/prune | `BrowserManager` |
| `providers/chatgpt` | ChatGPT DOM adapter, MCP connector UI, provider-specific history source | `ChatGptPage` |
| `providers/gemini` | Gemini DOM adapter | `GeminiPage` |
| `providers/arena` | Arena.ai modes + model picker + dual Option A/B capture | `ArenaPage` |
| `providers/claude` | Claude custom MCP connector setup | `setupMcpConnectorInClaude` |
| `providers/grok` | Grok custom MCP connector setup (`grok.com/connectors`) | `setupMcpConnectorInGrok` |
| `conversationCatalog` | Conversation search input/result schemas, shared ranking/fallback search | no service |
| `tools` | MCP server, sandbox, handlers | `McpHttpServer` HTTP wrapper |
| `tunnel` | cloudflared | `CloudflareTunnelClass` |
| `terminal` | CLI, headless commands | `CliRunner` and `tui/` |
| `store` | Sessions, checkpoints, logs | `SessionStore` |
| `domain` | Pure types, permissions, model catalog | no services |
| `userConfig` | `~/.ai-browser-bridge/` readers | `UserConfig` |
| `agentGateway` | Outbound MCP `ask` + `search_conversations` over stdio | no services |

## Conventions

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

- Cross-feature imports go through `@/features/<name>` `index.ts` doors. Never
  deep-import another feature's `internal/`.
- `src/config` is the shared data leaf for provider metadata and defaults (one
  `index.ts`, Schema-validated tables + `Effect.Config` for env).
- Code style details live in `CODE-STYLE.md`; mirror only a short digest here.
- New or touched code follows Effect-first services, `effect/Schema`, camelCase
  paths, wildcard index doors, direct imports only, SCREAMING_CASE constants
  immediately after imports, public TSDoc, named exports, strict `unknown`
  narrowing, and no backward compatibility shims.
- Regexes, replacement strings, and positional captures such as `match?.[1]`
  include a nearby raw-shape comment or use named captures.
- Folders with more than five files for one job must be grouped by purpose
  before adding new behavior.
- When a rule must be hard-blocked, add or update a repo check instead of
  relying on prose alone.

## Verification

```bash
pnpm verify
```

This runs Biome, typecheck, tests, build, class API checks, TSDoc checks,
boundary/style checks, and deprecated/backward-compat checks.

## Safety

- All file ops through sandbox validation.
- No raw shell in MCP tools.
- Do not commit unless explicitly asked.
- TypeScript strict plus `noUncheckedIndexedAccess`; no `any`.
- No cross-feature service-class imports; reach another feature only via its
  `index.ts` door and the `@/` alias.
