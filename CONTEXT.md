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

| Actor      | Tech                    | Folder                     | Job                                                      |
| ---------- | ----------------------- | -------------------------- | -------------------------------------------------------- |
| CLI        | Ink / React             | `terminal/`                | Terminal UI and scriptable commands.                     |
| Browser    | Playwright + CDP        | `browser/`, `providers/`   | Drives the real provider tab and captures replies.       |
| MCP server | MCP SDK + Effect Schema | `tools/`                   | Serves the sandboxed repo tools to the provider.         |
| Tunnel     | cloudflared             | `src/cloudflare-tunnel.ts` | Gives the local MCP server a temporary public HTTPS URL. |

Supporting folders: `bridge/` (engine and orchestrator that wire it together),
`store/` (sessions, checkpoints, logs), `domain/` (pure types, permissions, model
catalog), `user-config/` (`~/.ai-browser-bridge/` readers), `conversation-catalog/`
(conversation search), `agent-gateway/` (outbound MCP tools for other agents).
`src/config.ts` is the shared data leaf: the provider table and tunable defaults.

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

`src/main.ts` → `src/config.ts` → `terminal/cli.ts` → `terminal/register-cli.ts` →
`bridge/bridge-engine.ts` → `providers/providers.ts` → `tools/mcp-server.ts`.
