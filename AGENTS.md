# AGENTS.md — ai-browser-bridge

Durable repo instructions for Codex, Cursor, and other agents that read
`AGENTS.md`. Keep this file short: it is the routing map and working contract,
not a copied style guide.

## Project Contract

- This repo is a terminal CLI that drives ChatGPT, Gemini, Claude, DeepSeek,
  Grok, Perplexity, Duck.ai, Arena, or Flow in Chrome and exposes sandboxed
  local repo tools over MCP.
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
2. `src/config.ts` — provider data + defaults SSOT (Effect Schema)
3. `src/features/terminal/cli.ts` → `registerCli.ts` → `cliOperations.ts`
4. `src/features/bridge/bridgeEngine.ts` → `orchestrator.ts` → `fanout.ts`
5. `src/features/browser/index.ts` → `browserSession.ts` / `browserState.ts`
6. `src/features/providers/providers.ts` → Provider behavior modules
7. `src/features/conversationCatalog/index.ts` → `conversationSearch.ts`
8. `src/features/tools/index.ts` → `mcpServer.ts`

## Feature Ownership

| Feature | Owns | Main handle |
|---------|------|-------------|
| `bridge` | Engine start, orchestrator | `BridgeEngine`, `Orchestrator` |
| `browser` | CDP attach, shared bridge profile launch, browser status, generated-cache inventory/prune | `BrowserSession` |
| `providers/chatgpt` | ChatGPT DOM behavior, MCP connector UI, provider-specific history source | `chatGptProvider` |
| `providers/gemini` | Gemini DOM behavior | `geminiProvider` |
| `providers/arena` | Arena.ai modes + model picker + dual Option A/B capture | `arenaProvider` |
| `providers/claude` | Claude custom MCP connector setup | `setupMcpConnectorInClaude` |
| `providers/grok` | Grok custom MCP connector setup (`grok.com/connectors`) | `setupMcpConnectorInGrok` |
| `conversationCatalog` | Conversation search input/result schemas, shared ranking/fallback search | no service |
| `tools` | MCP server, sandbox, handlers | `McpHttpServer` HTTP wrapper |
| `tunnel` | cloudflared | `CloudflareTunnel` |
| `terminal` | CLI registration, shared operations, TUI | `runCli`, `cliOperations.ts`, `tui/` |
| `store` | Sessions, checkpoints, logs | `SessionStore` |
| `domain` | Pure types, permissions, model catalog | no services |
| `userConfig` | `~/.ai-browser-bridge/` readers | `loadHooksConfig`, `loadCustomCommands` |
| `agentGateway` | Outbound MCP `ask` + `search_conversations` over stdio | no services |

## Conventions

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

- Cross-feature imports go through `@/features/<name>` `index.ts` doors. Never
  deep-import another feature's implementation.
- `src/config.ts` is the shared data leaf for provider metadata and defaults
  (Schema-validated tables + `Effect.Config` for env).
- Code style details live in `CODE-STYLE.md`; mirror only a short digest here.
- New or touched code uses plain TypeScript and Promises, with Effect Schema and
  Config only at trust/configuration boundaries.
- Use precise domain names, early guards, explicit branches, named exports,
  named regex captures, and concrete function inputs. Do not add fallback
  operators, nested ternaries, import aliases, compatibility names, or generic
  factory/resolver/manager/helper paths.
- Comments and TSDoc are a last resort for external quirks, safety invariants,
  and contracts that names and types cannot express.
- Prefer cohesive modules and explicit Door exports. Do not add generic
  `internal/` buckets, forwarding microfiles, or stateless service classes.
- When a rule must be hard-blocked, add or update a repo check instead of
  relying on prose alone.

## Verification

```bash
pnpm verify
```

This runs Biome, the style-guide mirror check, typecheck, tests, build, the
feature-boundary check, and the no-compatibility check.

## Safety

- All file ops through sandbox validation.
- No raw shell in MCP tools.
- Do not commit unless explicitly asked.
- TypeScript strict plus `noUncheckedIndexedAccess`; no `any`.
- No cross-feature service-class imports; reach another feature only via its
  `index.ts` door and the `@/` alias.
