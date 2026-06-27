# chatgpt-local-bridge

> Drive a real ChatGPT browser conversation from your terminal, and give it a narrow, sandboxed set of local repo tools over MCP — without ever handing it a shell.

**English** · [עברית](README.he.md) · [Español](README.es.md) · [中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

---

## Why this exists

ChatGPT is at its best in the browser — real account state, the model picker, message editing, regeneration, and conversation history all intact. Coding is at its best in the terminal, where files, tests, diffs, and patches are inspected and changed directly.

`chatgpt-local-bridge` connects those two surfaces. A terminal prompt drives your existing ChatGPT browser session, and ChatGPT can reach into the current repo through a small set of **validated MCP tools** — `grep`, `read`, `apply_patch`, `run_tests`, `git_diff` — instead of raw shell access. You stay in one terminal workflow; ChatGPT keeps its real UI.

## Features

- **Terminal-driven ChatGPT** — send prompts and stream replies without leaving the shell; the real browser conversation stays the source of truth.
- **Sandboxed local tools over MCP** — every file operation is validated against the selected repo root; no arbitrary shell, allowlisted test commands only.
- **Browser actions as commands** — `/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact`, and more.
- **Repo-local sessions & transcripts** — every run is recorded under `<repo>/.bridge/` and exportable as Markdown, JSON, or JSONL.
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
| **Browser** | Playwright + Chrome DevTools Protocol | Drives the real ChatGPT tab; captures responses. Selectors isolated in `src/browser/chatgpt-page.ts` so UI drift is easy to fix. |
| **MCP server** | MCP SDK + Zod | Exposes the local repo tools to ChatGPT as schema-validated, sandboxed handlers. |
| **Tunnel** | Cloudflare Tunnel (`cloudflared`) | Gives the local MCP server a temporary public HTTPS URL that ChatGPT's connector can reach — no deployment required. |

**Why a tunnel at all?** ChatGPT's MCP connector calls tools over HTTPS, but the tool server runs on your machine. Rather than deploy anything, the bridge spins up an ephemeral Cloudflare Tunnel (`*.trycloudflare.com`) in front of the local port and syncs that `…/mcp` URL into the ChatGPT app on startup. (ngrok would solve the same reachability problem; Cloudflare's `cloudflared` is used because its quick tunnels need no account or auth token.)

## Quick start

**Prerequisites**

- **macOS** — Chrome is launched from `/Applications/Google Chrome.app`, and clipboard/process helpers use `pbcopy`/`lsof`.
- **Node.js ≥ 20** and **pnpm** (the repo pins `pnpm@10.14.0`).
- **Google Chrome** — the bridge drives a real Chrome profile.
- **`cloudflared`** *(optional)* — only needed for ChatGPT to call local tools. Without it the TUI still runs. Install with `brew install cloudflared`.

**Install & build**

```bash
git clone https://github.com/YosefHayim/chatgpt-local-bridge.git
cd chatgpt-local-bridge
pnpm install
pnpm build
```

**Sign in once, then run**

```bash
# Open the isolated bridge Chrome profile and log into ChatGPT (persists across runs)
node dist/bridge.js login

# Launch the terminal UI against the repo you want ChatGPT to work in
node dist/bridge.js --repo /path/to/your/project
```

Prefer a global `bridge` command? Run `pnpm link --global` after building, then use `bridge`, `bridge login`, `bridge ask "…"`, etc.

**One-shot, non-interactive**

```bash
node dist/bridge.js ask "summarize @src/core/engine.ts" --repo /path/to/project
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
```

**File mentions** — reference repo files inline; they are resolved inside the repo and expanded before ChatGPT sees them:

```text
refactor the CLI input flow in @src/cli/app.tsx
compare @src/core/file-resolver.ts with @tests/core/file-resolver.test.ts
```

Paths that escape the repo root are skipped; files over 100 KB are summarized rather than inlined.

## Where state lives

All bridge state for a project is written **inside that project**, under `<repo>/.bridge/`:

```text
<repo>/.bridge/
├── .gitignore        # a single "*", written automatically — see below
├── config.json       # per-repo settings
├── chrome-profile/   # the signed-in ChatGPT session for this repo
├── sessions/<id>/    # metadata.json + append-only events.jsonl transcript
├── logs/<date>.jsonl # prompts, replies, and MCP tool-call summaries
├── checkpoints/      # before/after snapshots around each apply_patch
├── exports/          # /export output
└── screenshots/      # /screenshot and /ui-qa captures
```

On first use the bridge writes `.bridge/.gitignore` containing a single `*`. That makes git ignore **everything** in the directory — the session transcripts and the login cookies included — so none of it can be committed, even though it lives inside the repo. `git add -A` and `git add .bridge/` both skip it; only an explicit `git add -f` could override. The file is re-asserted on every run, so deleting or tampering with it heals automatically.

> User-authored config meant to apply across **all** repos still lives in your home directory: custom commands in `~/.chatgpt-local-bridge/commands/*.md` and user-level hooks in `~/.chatgpt-local-bridge/hooks.json`.

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
pnpm verify:push   # typecheck + test + build (run before pushing)
```

Coverage focuses on the safety-sensitive paths — sandbox validation, repo-local path resolution, the `.bridge/` self-ignore guard, session/checkpoint stores, permissions, and context counting.

## Limitations

- **macOS-only** today (hardcoded Chrome path and `pbcopy`/`lsof` helpers).
- ChatGPT browser selectors can break when the web UI changes; fixes are localized to the browser layer.
- Context usage is an **estimate** — the browser does not expose exact server-side token counts.
- The Cloudflare Tunnel requires `cloudflared` installed.
- Local-first by design; not a hosted multi-user service.
- Hook command execution is parsed and reported but not yet executed (an allowlisted confirmation flow is pending).

## License

[MIT](LICENSE) © YosefHayim
