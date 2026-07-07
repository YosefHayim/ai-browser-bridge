<p align="center">
  <img src="assets/hero.png" alt="ai-browser-bridge — drive ChatGPT, Gemini, Claude, DeepSeek, Grok, and Perplexity from your terminal through Chrome" width="640" />
</p>

# ai-browser-bridge

> Drive a real ChatGPT or Gemini browser conversation from your terminal, and give ChatGPT a narrow, sandboxed set of local repo tools over MCP — without ever handing it a shell.

**English** · [עברית](README.he.md) · [Español](README.es.md) · [中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

---

## Why this exists

ChatGPT is at its best in the browser — real account state, the model picker, message editing, regeneration, and conversation history all intact. Coding is at its best in the terminal, where files, tests, diffs, and patches are inspected and changed directly.

`ai-browser-bridge` connects those two surfaces. A terminal prompt drives your existing ChatGPT or Gemini browser session, and ChatGPT can reach into the current repo through a small set of **validated MCP tools** — `grep`, `read`, `apply_patch`, `run_tests`, `git_diff` — instead of raw shell access. You stay in one terminal workflow; the provider keeps its real UI.

## Features

- **Terminal-driven ChatGPT** — send prompts and stream replies without leaving the shell; the real browser conversation stays the source of truth.
- **Six providers, one command** — `chatgpt`, `gemini`, `claude`, `deepseek`, `grok`, `perplexity`. Pick one with `--provider`, or **fan out** across several (`--provider claude,deepseek,grok`) and get every reply keyed by provider in one call.
- **Built for agents** — a stable non-interactive `bridge ask … --json` contract (never hangs in a pipe) plus an outbound MCP `ask` tool, so any agent can drive a web chat.
- **Sandboxed local tools over MCP** — every file operation is validated against the selected repo root; no arbitrary shell, allowlisted test commands only.
- **Browser actions as commands** — `/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact`, and more.
- **Repo-local sessions & transcripts when needed** — TUI and tool-enabled runs persist under `<repo>/.bridge/`; plain `bridge ask` stays stateless and only reuses the shared Chrome profile.
- **Safety controls** — permission modes (`read-only` / `ask` / `auto`) and automatic file checkpoints around every patch.
- **Project conventions** — custom commands plus `AGENTS.md` / `CLAUDE.md` are fed to ChatGPT for `/task` runs.
- **A real composer** — prompt history, reverse search, queued prompts, and `@file` mention autocomplete.

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

| Layer | Tech | Responsibility |
|-------|------|----------------|
| **CLI** | Ink / React | Terminal UI: message pane, status line, `@file` mentions, `/commands`. |
| **Browser** | Playwright + Chrome DevTools Protocol | Attaches to Chrome on the debug port and reuses one shared bridge Chrome profile. Lifecycle/status/cache code lives in `src/features/browser/`; provider selectors live under `src/features/providers/<name>/`. |
| **MCP server** | MCP SDK + Zod | Exposes the local repo tools to ChatGPT as schema-validated, sandboxed handlers. |
| **Tunnel** | Cloudflare Tunnel (`cloudflared`) | Gives the local MCP server a temporary public HTTPS URL that ChatGPT's connector can reach — no deployment required. |

**Why a tunnel at all?** ChatGPT's MCP connector calls tools over HTTPS, but the tool server runs on your machine. Rather than deploy anything, the bridge spins up an ephemeral Cloudflare Tunnel (`*.trycloudflare.com`) in front of the local port and syncs that `…/mcp` URL into the ChatGPT app on startup. (ngrok would solve the same reachability problem; Cloudflare's `cloudflared` is used because its quick tunnels need no account or auth token.)

## Quick start

**Prerequisites**

- **macOS** — Chrome is launched with the macOS `open` command, and clipboard/process helpers use `pbcopy`/`lsof`.
- **Node.js ≥ 20** and **pnpm** (the repo pins `pnpm@10.14.0`).
- **Google Chrome or Chrome for Testing** — the bridge drives one shared bridge profile through a debug port. Sign in once in that bridge-launched window; every repo reuses it.
- **`cloudflared`** *(optional, ChatGPT only)* — only needed for ChatGPT to call local MCP tools. Without it the TUI still runs. Install with `brew install cloudflared`.

**Install & build**

```bash
git clone https://github.com/YosefHayim/ai-browser-bridge.git
cd ai-browser-bridge
pnpm install
pnpm build
```

**Start Chrome, then run (ChatGPT — default)**

```bash
node dist/bridge.js chrome start
node dist/bridge.js --repo /path/to/your/project
```

**Start Chrome, then run (Gemini web)**

```bash
node dist/bridge.js chrome start --provider gemini
node dist/bridge.js --provider gemini --repo /path/to/your/project
```

Prefer a global `bridge` command? Run `pnpm link --global` after building, then use `bridge`, `bridge chrome start`, `bridge ask "…"`, etc.

### Browser profile policy

Chrome 136+ no longer accepts remote debugging switches against the real default Chrome data directory. `ai-browser-bridge` therefore does **not** drive `~/Library/Application Support/Google/Chrome`. It always launches the browser on the debug port with one global bridge profile:

```text
~/.ai-browser-bridge/chrome-profile
```

That profile is the browser-login SSOT for the bridge. Sign in once in the bridge-launched Chrome window, then `bridge chrome start`, `bridge ask`, and the TUI reuse that login from any repo or shell root.

For release and automation work, Chrome's team recommends [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing). Install it separately, then point the bridge at that app while keeping the same shared profile:

```bash
AI_BROWSER_BRIDGE_CHROME_APP="Google Chrome for Testing" bridge chrome start
```

The app override changes only which Chrome build is launched. The profile remains `~/.ai-browser-bridge/chrome-profile`; do not add per-repo Chrome profiles. See Chrome's [remote-debugging profile change](https://developer.chrome.com/blog/remote-debugging-port) for the upstream reason.

**One-shot, non-interactive**

```bash
node dist/bridge.js ask "summarize @src/core/engine.ts" --repo /path/to/project
node dist/bridge.js ask "hello" --provider gemini --repo /path/to/project
```

## Usage

```text
/help             list commands              /sessions         list local sessions
/resume <query>   resume by number/title/id  /transcript       print the session transcript
/new              start a new conversation   /export           export transcript (md/json/jsonl)
/model [name]     show or switch the model    /permissions      show or switch MCP permission mode
/rewind [text]    edit last prompt + regen   /checkpoints      list file checkpoints
/stop             stop the active response   /restore <id>     restore files from a checkpoint
/context          model-aware context est.   /status           repo/model/context/session status
/diff             ask ChatGPT to read diff   /mcp              connector + exposed tools
/task <request>   project-agent task (MCP)   /connector        (re)run ChatGPT connector setup
/conversations    list/search/open browser conversations
```

**File mentions** — reference repo files inline; they are resolved inside the repo and expanded before ChatGPT sees them:

```text
refactor the CLI input flow in @src/features/terminal/tui/App.tsx
compare @src/features/store/fileResolver.ts with @src/features/store/fileResolver.test.ts
```

Paths that escape the repo root are skipped; files over 100 KB are summarized rather than inlined.

**Conversation search** — `bridge chat search "query" --json` searches ChatGPT history through the shared conversation catalog. Add `--open` to navigate the browser to the best match.

## Agents & fan-out

`bridge ask` is a stable, non-interactive surface for scripts and agents — it prints to stdout, never prompts in a pipe, and `--json` emits a machine-readable payload.

```bash
# one provider
bridge ask --provider claude --json "summarize the tradeoffs of optimistic locking"

# fan out across several free chats; one call, replies keyed by provider
bridge ask --provider claude,deepseek,grok --json "same question, three models"
# → { "claude": { "ok": true, "reply": "…", "elapsedMs": 8123 },
#     "deepseek": { "ok": true, "reply": "…", "elapsedMs": 6210 },
#     "grok": { "ok": false, "error": "…", "elapsedMs": 300000 } }
```

Fan-out is **partial-failure tolerant**: the run exits non-zero only when *every* provider fails, or — with `--strict` — when *any* fails. Run `bridge chrome start --provider <name>` and sign in if needed; the bridge reuses the shared bridge Chrome profile across repos.

The same fan-out core is exposed through outbound MCP tools — launch a stdio MCP server with `bridge serve` and any MCP-capable agent can call `ask({ prompt, providers })` or `search_conversations({ query, providers, limit })` as native tools instead of shelling out. Register it with Claude Code:

```bash
claude mcp add ai-browser-bridge -- bridge serve
```

…or add it to any MCP client config directly (the standard stdio-server shape):

```jsonc
{
  "mcpServers": {
    "ai-browser-bridge": { "command": "bridge", "args": ["serve"] }
  }
}
```

The `ask` tool takes `{ prompt, providers?, timeoutSeconds? }` and returns each provider's reply keyed by id (the same partial-failure-tolerant fan-out as `bridge ask`). The `search_conversations` tool takes `{ query, providers?, limit? }` and returns matching conversation URLs keyed by provider. Run `bridge chrome start --provider <name>` first, so the gateway has a signed-in Chrome session to drive. This is the opposite direction to the inbound MCP server, which exposes your repo tools *to* the web model.

> Provider adapters other than ChatGPT/Gemini ship with best-effort selectors marked `LIVE-VERIFY` — confirm them against the live signed-in site before relying on them in production.

## Where state lives

Persistent bridge state for a project is written **inside that project**, under `<repo>/.bridge/`:

```text
<repo>/.bridge/
├── .gitignore        # a single "*", written automatically — see below
├── config.json       # per-repo settings (includes `provider`: chatgpt | gemini)
├── sessions/<id>/    # metadata.json + append-only events.jsonl transcript
├── logs/<date>.jsonl # prompts, replies, and MCP tool-call summaries
├── checkpoints/      # before/after snapshots around each apply_patch
├── exports/          # /export output
├── downloads/<conv>/ # attachment downloads (default when no --out given)
└── screenshots/      # /screenshot and /ui-qa captures
```

Plain `bridge ask` and `bridge chrome start` do not create repo-local state; they only reuse the shared Chrome profile. The bridge creates `<repo>/.bridge/` for persistent TUI sessions, tool-enabled asks (`bridge ask --tools`), checkpoints, exports, screenshots, or default attachment downloads.

When repo-local state is needed, the bridge writes `.bridge/.gitignore` containing a single `*`. That makes git ignore **everything** in the directory — session transcripts, logs, downloads, screenshots, and checkpoints — so none of it can be committed, even though it lives inside the repo. Chrome cookies for bridge-driven sessions stay in the shared bridge profile under `~/.ai-browser-bridge/chrome-profile`, not under `.bridge/`. `git add -A` and `git add .bridge/` both skip bridge state; only an explicit `git add -f` could override. The file is re-asserted on persistent runs, so deleting or tampering with it heals automatically.

> User-authored config meant to apply across **all** repos lives in your home directory: custom commands in `~/.ai-browser-bridge/commands/*.md` and user-level hooks in `~/.ai-browser-bridge/hooks.json`.

### Migrating from `chatgpt-local-bridge`

The package was renamed to **`ai-browser-bridge`**. Global user config moved from `~/.chatgpt-local-bridge/` to `~/.ai-browser-bridge/` — copy your `commands/` folder and `hooks.json` if you had them. Persistent repo-local state stays at `<repo>/.bridge/` (unchanged). Re-run `/connector` or `bridge ask --tools` once so ChatGPT picks up the renamed MCP connector app.

## Permissions & checkpoints

```bash
/permissions read-only   # grep_code, read_file, git_diff
/permissions auto        # also the narrow write/test tools
/permissions ask         # blocks write/test/process tools (interactive confirm pending)
```

`apply_patch` snapshots every touched path before and after the change. Recover with `/checkpoints`, `/restore <id>`, or `/rewind --files <id>`.

## Testing

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm verify:push   # biome ci + typecheck + test + build + check:class-api + check:tsdoc + check:boundaries
```

Coverage focuses on the safety-sensitive paths — sandbox validation, repo-local path resolution, the `.bridge/` self-ignore guard, session/checkpoint stores, permissions, and context counting.

## Gemini web support

The bridge can drive **gemini.google.com** from the terminal with the same Playwright/CDP pattern as ChatGPT:

```bash
bridge chrome start --provider gemini
bridge --provider gemini --repo /path/to/project
bridge ask "explain this repo" --provider gemini --repo /path/to/project
```

**What works on Gemini web**

- Terminal-driven prompts and captured replies
- `@file` mention expansion (read-only repo context inlined into prompts)
- Model detection/switching when the Gemini UI exposes a picker
- Reuses the same shared bridge profile/debug port model as every provider

**What does not work on Gemini web (today)**

- **MCP connector** — gemini.google.com has no custom connector UI like ChatGPT Settings → Connectors. The bridge skips the MCP server and Cloudflare tunnel when `--provider gemini`.
- **`/task`, `/connector`, `/mcp`** — these require live MCP tools; use ChatGPT for those workflows.
- **Attachment download** — `bridge download` is ChatGPT-only for now.

For full MCP on Gemini, use the official [Gemini API Remote MCP](https://ai.google.dev/gemini-api/docs/function-calling) or [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) instead of the browser UI.

**Selector maintenance:** when Google changes the Gemini web UI, fix selectors only in [`src/features/providers/gemini/geminiPage.ts`](src/features/providers/gemini/geminiPage.ts).

## Limitations

- **macOS-only** today (`open`, `pbcopy`, and `lsof` helpers).
- ChatGPT and Gemini browser selectors can break when the web UI changes; fixes are localized to the browser layer.
- Context usage is an **estimate** — the browser does not expose exact server-side token counts.
- The Cloudflare Tunnel requires `cloudflared` installed.
- Local-first by design; not a hosted multi-user service.
- Hook command execution is parsed and reported but not yet executed (an allowlisted confirmation flow is pending).

## License

[MIT](LICENSE) © YosefHayim
