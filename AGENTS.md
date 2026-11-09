# AGENTS.md — ai-browser-bridge

Durable repo instructions for Codex, Cursor, and other agents that read
`AGENTS.md`. Keep this file short: it is the routing map and working contract,
not a copied style guide.

## Project Contract

- This repo is a CLI and MCP bridge that drives ChatGPT, Gemini, Claude, DeepSeek,
  Grok, Perplexity, Duck.ai, Arena, Flow, or Claude Design in Chrome and exposes sandboxed
  local repo tools over MCP.
- ChatGPT can use the inbound MCP tool server. Other local agents can use
  outbound MCP `ask`, `search_conversations`, and the `flow_*`, `chatgpt_*`, and
  `design_*` tools through `bridge serve`.
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
3. `src/features/cli/cli.ts` → `registerCli.ts` → command modules
4. `src/features/bridge/engine/bridgeEngine.ts` → `conversation/BrowserConversation.ts` → `fanout/runBrowserConversations.ts`
5. `src/features/browser/browserSession.ts` → `browserState.ts`
6. `src/features/webProviders/providerRegistry.ts` → Provider behavior modules
7. `src/features/conversations/conversationSearch.ts`
8. `src/features/repoMcp/repoMcpServer.ts`

## Feature Ownership

| Feature | Owns | Main handle |
|---------|------|-------------|
| `cli` | Command registration, arguments, output, command groups | `runCli`, `registerCliCommands` |
| `bridge` | Engine lifecycle, repo runtime config, orchestration, Fan-out | `BridgeEngine`, `BrowserConversation` |
| `browser` | Chrome profiles, CDP, browser status and cache | `BrowserSession` |
| `webProviders` | Website adapters, DOM/app requests, connector setup UI | `BrowserProvider`, `webProviderFor` |
| `conversations` | Conversation/message/attachment data and search ranking | `searchConversations` |
| `models` | Model profiles and context-window lookup | `findModelProfile` |
| `browserMcp` | Stdio MCP tools for coding agents to drive browser services | `serveBrowserMcp` |
| `repoMcp` | HTTP MCP repo tools, sandbox, tool schemas and permissions | `RepoMcpServer` |
| `repoState` | Sessions, logs, checkpoints, repo paths | `createSession`, `createCheckpoint` |
| `hooks` | User/repo hook configuration and disabled-execution reporting | `loadHooksConfig`, `runHooks` |
| `tunnel` | cloudflared process and public MCP URL | `CloudflareTunnel` |

Root leaves: `config.ts` owns built-in defaults, provider metadata, and env config;
`mcpSchema.ts` adapts Effect schemas for both MCP surfaces; `nodeErrors.ts` narrows
Node filesystem/process errors. There is no generic shared-types feature.

## Conventions

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

- Import directly from the owning module using `@/features/<feature>/<module>.ts`;
  keep imports inside a feature relative. Do not create index files.
- `src/config.ts` is the shared data leaf for provider metadata and defaults
  (Schema-validated tables + `Effect.Config` for env).
- Declare module types and interfaces immediately after imports.
- Separate nested operations into named steps and use contextual local names.
- Group growing folders by responsibility; keep tests beside their modules.
- Code style details live in `CODE-STYLE.md`; mirror only a short digest here.
- New or touched code uses plain TypeScript and Promises, with Effect Schema and
  Config only at trust/configuration boundaries.
- Use precise domain names, early guards, explicit branches, named exports,
  named regex captures, and concrete function inputs. Do not add fallback
  operators, nested ternaries, import aliases, compatibility names, or generic
  factory/resolver/manager/helper paths.
- Comments and TSDoc are a last resort for external quirks, safety invariants,
  and contracts that names and types cannot express.
- Prefer cohesive modules and explicit named exports. Do not add generic
  `internal/` buckets, forwarding microfiles, or stateless service classes.
- When a rule must be hard-blocked, add or update a repo check instead of
  relying on prose alone.

## Verification

```bash
pnpm verify
```

This runs Biome, typecheck, tests, and build.

## Safety

- All file ops through sandbox validation.
- No raw shell in MCP tools.
- Do not commit unless explicitly asked.
- TypeScript strict plus `noUncheckedIndexedAccess`; no `any`.
- Cross-feature imports name the module that owns the operation; do not duplicate
  browser/profile, provider, or command-default state.
