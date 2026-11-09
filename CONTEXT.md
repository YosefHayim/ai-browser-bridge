# CONTEXT.md — ai-browser-bridge

Architecture and ownership. `PROJECT.md` owns intent, `LANGUAGE.md` owns terms,
`CODE-STYLE.md` owns style, and `AGENTS.md` owns agent navigation.

## Entry points

`src/main.ts` calls `cli/runCli`. Commander registers scriptable commands.
Bare `bridge` prints help. There is no terminal chat UI.

```text
CLI commands ─────────────────────┐
Coding agent ── MCP stdio ── browserMcp
                                  │
                                  ▼
                       bridge + browser + webProviders
                                  │ Playwright / CDP
                                  ▼
                       Signed-in browser services
                                  │ optional MCP connector
                                  ▼
                         tunnel ── repoMcp ── Target repo
```

Both MCP surfaces are servers. `browserMcp` exposes browser operations to coding
agents through `bridge serve`. `repoMcp` exposes sandboxed repository operations
to browser connectors over HTTP. Their names identify the capability they expose,
so direction does not depend on the reader's viewpoint.

## Feature ownership

| Path under `src/features` | Responsibility |
| --- | --- |
| `cli` | Arguments, help, human/JSON output, command groups and browser-command sessions |
| `browserMcp` | Stdio MCP registration and browser tool request/reply handling |
| `repoMcp` | HTTP MCP lifecycle, repo tool handlers, sandbox, permissions and schemas |
| `bridge` | Engine lifecycle, orchestration, Fan-out, context estimates, persisted repo config |
| `browser` | Chrome process/profile ownership, CDP attachment, status and generated cache |
| `webProviders` | Browser website adapters, DOM/app requests, provider connector UI |
| `conversations` | Conversation, Message and Attachment types; shared search and ranking |
| `models` | Model profiles and context-window lookup |
| `repoState` | Session records, logs, checkpoints and persistent paths |
| `hooks` | User/repo hook configuration and reporting; command execution stays disabled |
| `tunnel` | cloudflared lifecycle and public MCP URL |

The CLI has cohesive modules for ask, browser/cache, downloads, ChatGPT, conversation
organization, Flow, Design, and MCP startup. Tests stay beside the behavior they cover.
The ChatGPT adapter composes conversation controls, prompt submission, response
waiting, model selection, attachment capture, and connector setup. Capability
modules import their dependencies directly and never import the provider object.

Providers retain their existing capability boundaries: Flow produces Clips; Claude
Design owns projects/files and uses in-tab app requests.

## Configuration and shared boundaries

- `src/config.ts`: built-in provider metadata, selectors, defaults, and env-backed
  settings. This is a data leaf and imports no feature.
- `bridge/engine/repoConfig.ts`: reads/writes `.bridge/config.json` for the Target repo.
- `hooks/hooks.ts`: reads user-authored hook files for that repo and the user's home.
- `src/mcpSchema.ts`: adapts Effect schemas for the MCP SDK at both protocol edges.
- `src/nodeErrors.ts`: narrows Node filesystem/process errors.

Types live with the feature that owns their meaning. There is no `domain` bucket:
Bridge config belongs to `bridge`, permissions/tool results to `repoMcp`, connector
results to `webProviders`, and conversation data to `conversations`. Cross-feature
imports point directly to the owning module; internal imports remain relative.
There are no index files. Bridge code is grouped into engine, conversation, and
fanout; CLI code groups conversation commands, browser commands, organization,
provider-specific commands, and output/session handling.

## Where state lives

Persistent state is scoped to the canonical Git working-tree root's `.bridge/`:
config, sessions, logs, checkpoints, exports and downloads. A nested launch uses
that same root; an explicit non-Git directory remains its own root. Plain
`bridge ask` and `bridge chrome start` stay stateless by default. Tool-enabled
runs and commands that save results create only the directories they need.
The bridge does not create or manage `.bridge/.gitignore`.

Browser Login lives separately at `~/.ai-browser-bridge/chrome-profile`, shared
across repos by one debug-port Chrome process. Fan-out uses tabs in that process.
An isolated profile under `~/.ai-browser-bridge/chrome-profiles/<name>` is a distinct
account, signed in separately and never cloned. User hooks live at
`~/.ai-browser-bridge/hooks.json`. Removing the TUI does not delete user data.

## Read order

`main.ts` → `config.ts` → `cli/cli.ts` → `cli/registerCli.ts` → the command module →
`bridge/engine/bridgeEngine.ts` → `webProviders/providerRegistry.ts` → the provider adapter.
For MCP, continue through `browserMcp/browserMcpServer.ts` or
`repoMcp/repoMcpServer.ts`, according to the exposed capability.
