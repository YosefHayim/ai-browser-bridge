# CONTEXT.md — ai-browser-bridge

What the parts are and how they fit. Words: `LANGUAGE.md`. Purpose: `PROJECT.md`. Working rules: `AGENTS.md`.

## What it is

A terminal tool that drives a real ChatGPT, Gemini, Claude, DeepSeek, Grok,
Perplexity, Duck.ai, Arena, Flow, or Claude Design browser conversation, one
provider or several at once. For ChatGPT, Claude, and Grok it also exposes a
narrow set of sandboxed local repo tools over MCP, with no raw shell. The
provider keeps its real UI.

Flow is Google's Veo video studio: its reply is a clip reference and its
attachments are ingredients. Claude Design is a project workspace; `bridge design`
and the `design_*` MCP tools drive its projects, files, and conversations.

## The actors

| Actor      | Tech             | Folder                   | Job                                                      |
| ---------- | ---------------- | ------------------------ | -------------------------------------------------------- |
| CLI        | Ink / React      | `terminal/`              | Terminal UI and scriptable commands.                     |
| Browser    | Playwright + CDP | `browser/`, `providers/` | Drives the real provider tab and captures replies.       |
| MCP server | MCP SDK + zod    | `repo-tools-mcp/`        | Serves the sandboxed repo tools to the provider.         |
| Tunnel     | cloudflared      | `tunnel/`                | Gives the local MCP server a temporary public HTTPS URL. |

See the folder map below for every folder. `src/config.ts` is the shared data leaf: the provider table and tunable defaults.

## Architecture

```text
 terminal (you)
      │
      │  Ink / React CLI
      ▼
 orchestrator ──────────────┬───────────────────────────────┐
      │  browser automation │                   MCP server   │
      ▼  (Playwright + CDP) │                  (MCP SDK)      ▼
 ChatGPT browser UI         │                        local repo tools
      ▲                     │                     (grep/read/patch/test/diff)
      │                     ▼                                 │
      └───── Cloudflare Tunnel (cloudflared) ◄────────────────┘
              public https://…trycloudflare.com/mcp
```

Four layers, each with one job:

| Layer          | Tech                                  | Responsibility                                                                                                                                                                                |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI**        | Ink / React                           | Terminal UI: message pane, status line, `@file` mentions, `/commands`.                                                                                                                        |
| **Browser**    | Playwright + Chrome DevTools Protocol | Attaches to Chrome on the debug port and reuses one shared bridge Chrome profile. Lifecycle/status/cache code lives in `src/browser/`; provider selectors live under `src/providers/<name>/`. |
| **MCP server** | MCP SDK + zod                         | Exposes the local repo tools to ChatGPT, Claude, and Grok as schema-validated, sandboxed handlers.                                                                                            |
| **Tunnel**     | Cloudflare Tunnel (`cloudflared`)     | Gives the local MCP server a temporary public HTTPS URL that provider connectors can reach — no deployment required.                                                                          |

**Why a tunnel at all?** Provider MCP connectors call tools over HTTPS, but the tool server runs on your machine. Rather than deploy anything, the bridge spins up an ephemeral Cloudflare Tunnel (`*.trycloudflare.com`) in front of the local port and syncs that Streamable HTTP `…/mcp` URL into the provider app on startup. (ngrok would solve the same reachability problem; Cloudflare's `cloudflared` is used because its quick tunnels need no account or auth token. Grok's UI may show an `/sse` example — the bridge registers `/mcp` because cloudflared quick tunnels do not support SSE.)

## Folder map

Top-level folders under `src/`:

- `agent-gateway/`: outbound MCP tools that let other agents ask the bridge.
- `bridge/`: the engine and orchestrator that wire a run together; fan-out and context counting.
- `browser/`: Chrome profile, session, state, and cache handling.
- `conversation-catalog/`: conversation search across providers.
- `domain/`: pure types, errors, and permissions. No I/O.
- `providers/`: one folder per web service the bridge drives, plus the shared engine.
- `repo-tools-mcp/`: the sandboxed repo tools served over MCP.
- `store/`: sessions, checkpoints, logs, paths, and `@file` mentions.
- `terminal/`: the CLI, its commands, and the Ink TUI.
- `test-fixtures/`: fake pages and composers shared by tests.
- `tunnel/`: the Cloudflare Tunnel wrapper.
- `user-config/`: readers for `~/.ai-browser-bridge/` (custom commands, hooks, project instructions).

`terminal/`:

- `commands/`: one file or folder per `bridge` subcommand (ask, chats, design, flow, cache, download, and more).
- `cli/`: CLI entry, option readers, failure output, and session startup.
- `tui/`: the interactive Ink app: composer, shell, status line, slash commands, suggestions, assist.

`providers/`:

- `engine/`: shared provider base, selector-driven provider, stall watchdog, streaming guard, and errors.
- `claude/`: Claude connector.
- `grok/`: Grok connector.
- `chatgpt/page/`: ChatGPT page driving: composer, page, render state.
- `chatgpt/backend-api/`: ChatGPT backend API calls: projects, workspace, conversation lookup and images.
- `arena/`: Arena.ai page and modes.
- `design/`: Claude Design projects, files, tabs, conversations, and RPC.
- `flow/`: Google Flow page, generation, and assets.
- `gemini/`: Gemini page.

`domain/models/`: model profiles per vendor (Anthropic, Google, OpenAI, Z.ai), profile types, model lookup, and model URLs.

## How the pieces relate

- A bridge drives one conversation, or several at once (a fan-out), each in its
  own tab of one shared Chrome, with its own model, context, and transcript.
- A session belongs to one target repo and records one conversation of a run.
- Tools run inside the sandbox, scoped to the target repo.
- A tunnel exposes the MCP server to the conversation.
- The login is shared by all conversations; a session is per run.

## Where state lives

Repo state goes to the Git working-tree root under `<repo>/.bridge/`: config,
sessions, logs, checkpoints, exports, downloads, screenshots. A plain
`bridge ask` or `bridge chrome start` creates no repo state; it only reuses the
shared Chrome profile at `~/.ai-browser-bridge/chrome-profile`.

Provider sign-in stays in that shared profile, so every repo uses it through the
local debug-port Chrome. With `AI_BROWSER_BRIDGE_BROWSER=my-chrome`, sessions use
your own Chrome and its logins instead, in tabs the bridge opens and closes.
Isolated profiles (for a second account) live under
`~/.ai-browser-bridge/chrome-profiles/<name>`, each on its own debug port.
User-global config (custom commands, hooks) lives in `~/.ai-browser-bridge/`.

## Where to start reading

`src/main.ts` → `src/config.ts` → `terminal/cli/cli.ts` → `terminal/cli/register-cli.ts` →
`bridge/bridge-engine.ts` → `providers/providers.ts` → `repo-tools-mcp/mcp-server.ts`.
