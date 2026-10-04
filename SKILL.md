---
name: ai-browser-bridge
description: Drive ChatGPT, Gemini, Claude, DeepSeek, Grok, Perplexity, Duck.ai, Arena, Google Flow, or Claude Design (claude.ai/design) through a signed-in Chrome session, either from the bridge CLI or its outbound MCP tools. Use when Claude Code, Codex, or another agent should ask a browser-hosted model, upload local files or screenshots, search, resume, or batch-organize browser conversations, fan out across providers, create or edit Claude Design projects (slides, prototypes, documents), or use bridge-managed ChatGPT and Flow capabilities.
---

# ai-browser-bridge

Drive ChatGPT, Gemini, Claude, DeepSeek, Grok, Perplexity, Duck.ai, Arena, Google Flow, or Claude Design in a real browser from any agent — one provider or fanned out. Exposes sandboxed local repo tools to ChatGPT, Claude, and Grok over MCP, and serves outbound MCP `ask`, `search_conversations`, ChatGPT, Flow, and Claude Design tools so agents can call browser surfaces natively.

## Prerequisites

- macOS
- Node.js ≥ 22
- Google Chrome
- `cloudflared` (optional, for ChatGPT, Claude, and Grok MCP tools)
- Signed-in providers: run `bridge chrome start --provider <name>` and sign in if needed

## Install & setup

```bash
npm install -g ai-browser-bridge   # installs `bridge` and ships this SKILL.md
```

The package folder is also the skill folder. Link it once into each agent's
global skills directory; every later `npm install -g ai-browser-bridge` then
updates the skill too:

```bash
PKG="$(npm root -g)/ai-browser-bridge"
ln -s "$PKG" ~/.claude/skills/ai-browser-bridge   # Claude Code
ln -s "$PKG" ~/.agents/skills/ai-browser-bridge   # Codex
```

## How to use as a tool

### MCP stdio (Claude Code, Codex, Kiro, any MCP client)

```bash
bridge serve
```

Exposes tools over stdio:
- `ask({ prompt, providers?, timeoutSeconds? })`
- `search_conversations({ query, providers?, limit? })`
- `design_*` for Claude Design: `design_state`, `design_list_projects`, `design_catalog`,
  `design_choose_model`, `design_create_project`, `design_send`, `design_read_conversation`,
  `design_new_conversation`, `design_rename_conversation`, `design_list_files`,
  `design_put_files`, `design_remove_files`, `design_download`, `design_share`,
  `design_update_project`, `design_duplicate_project`, `design_delete_project`,
  `design_open_project` (destructive tools need `confirm: true`)
- `flow_*` for Google Flow: `flow_generate`, `flow_extend_clip`, `flow_reuse_clip`,
  `flow_list_clips`, `flow_list_projects`, `flow_list_ingredients`, `flow_download_clips`,
  `flow_rename_clip`, `flow_rename_project`, `flow_delete_clip`, `flow_delete_project`,
  `flow_remove_ingredient`, `flow_clear_ingredients`
- `chatgpt_render_state` for the live ChatGPT render (streaming, image progress, limits)

### CLI (Codex, scripts, any shell-based agent)

```bash
# One provider
bridge ask "summarize this repo" --provider chatgpt --json

# Fan out across multiple
bridge ask "compare approaches" --provider claude,deepseek,grok --json
```

`--json` emits machine-readable output. Never hangs in a pipe.

## Claude Design

Claude Design (claude.ai/design) is a project workspace for slides, prototypes,
and documents. The bridge drives it in the signed-in bridge Chrome, one tab per
project. It is not a fan-out provider, so `ask` does not reach it; use the
`design_*` tools or `bridge design` instead.

1. `bridge chrome start --provider design` and sign in at claude.ai if needed.
2. `design_state` first: where Claude Design is, whether a turn is running, and
   which actions are available.
3. `design_catalog` for templates, models with effort levels, and design systems.
4. New work: `design_create_project` with a prompt (and optional template, model,
   effort, attachments). It waits for Claude's first reply.
5. Follow-ups: `design_send` in the project's Conversation, then
   `design_read_conversation` to read replies. For long turns pass `wait: false`
   and poll `design_read_conversation`.
6. Files: `design_list_files`, `design_put_files` (repo files only),
   `design_download` into `.bridge/downloads/design`.

Same surface from a shell:

```bash
bridge design state --json
bridge design create --template Slides --prompt "our Q3 launch" --json
bridge design send --project <id> --message "make the title bolder" --json
bridge design read --project <id> --json
```

Left to the human in the UI: Publish as artifact, Send to Claude Code,
PNG/video/PDF/PowerPoint export, comments, and version restore.

## Per-agent setup

### Claude Code

```bash
claude mcp add --transport stdio --scope user ai-browser-bridge -- bridge serve
```

### Codex

```bash
codex mcp add ai-browser-bridge -- bridge serve
```

This writes `[mcp_servers.ai-browser-bridge]` to `~/.codex/config.toml`. Codex can
also call the CLI directly, for example `bridge ask "your question" --provider chatgpt --json`.

### Kiro

Add to your MCP config:
```jsonc
{
  "mcpServers": {
    "ai-browser-bridge": { "command": "bridge", "args": ["serve"] }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "ai-browser-bridge": { "command": "bridge", "args": ["serve"] }
  }
}
```

## Available commands

| Command | Purpose |
|---------|---------|
| `bridge` (bare) | Interactive TUI |
| `bridge ask <prompt>` | One-shot send + reply |
| `bridge chrome start --provider <name>` | Start existing Chrome profile with debug port |
| `bridge status` / `bridge chrome status` | Show Chrome debug-port status |
| `bridge cache list\|prune` | Inspect/prune safe generated Chrome cache |
| `bridge serve` | Outbound MCP ask/search tools (stdio) |
| `bridge download` | Download conversation attachments |
| `bridge sessions` | List stored sessions |
| `bridge stop` | Kill warm Chrome |
| `bridge project list\|create\|rename\|delete` | Manage ChatGPT Projects |
| `bridge chat list\|search\|move\|organize\|archive` | List, search, batch-organize & archive conversations |
| `bridge chat organize status\|pause\|resume` | Inspect or control the latest persisted organization queue |
| `bridge task list\|create` | Schedule ChatGPT Tasks |
| `bridge chatgpt` | Inspect the live ChatGPT render |
| `bridge flow` | Generate and manage Google Flow clips and ingredients |
| `bridge design` | Claude Design projects, templates, model/effort, files, Conversations, share |

## Keep conversations organized (ChatGPT)

Before starting a **new** ChatGPT conversation, check whether it belongs in an
existing Project instead of adding one more loose chat:

1. `bridge project list` — the Projects that already exist.
2. `bridge chat search "<topic>"` — a related past chat (and where it lives).
3. If a Project fits, ask/resume there, then file the chat:
   `bridge chat move "<idOrTitle>" --project "<Project>"`.
4. Only leave a chat loose when nothing fits. The first time a **second**
   related chat appears, `bridge project create "<Project>"` and move both in.

For agents driving the bridge:

- One Project per topic / repo / deliverable — reuse before you create.
- `bridge chat list --orphans` shows only loose (project-less) chats; a growing list
  there is the signal to file them into Projects.
- Archive dead or scratch chats with `bridge chat archive "<idOrTitle>"`
  (reversible — hides from the sidebar) to keep it lean. Batch with `--id`.
- Don't spawn throwaway or test conversations in the signed-in account. Use an
  isolate profile (`bridge ask --fan-out` with `isolate`) for scratch runs, and
  clean up anything you create.

For a full-history cleanup, scan only loose chats with
`bridge chat list --orphans --json`, group clear recurring topics, and leave
ambiguous or uncommon chats loose. Reuse existing Projects first; create a new
Project only for a stable topic with at least two chats. Put every accepted move
into one JSON plan of `{ "conversation": "<idOrTitle>", "project": "<name>" }`
items, dry-run it, then start the persisted queue:

```bash
bridge chat organize --plan @organization-plan.json --dry-run
bridge chat organize --plan @organization-plan.json \
  --interval 60 --cooldown 600 --max-attempts 4 --json

# Later lifecycle operations do not need the plan again
bridge chat organize status --json
bridge chat organize pause
bridge chat organize resume --json
```

The queue persists under `.bridge/chat-organization-queues/`. Running the exact
same plan again resumes pending work without replaying completed moves. Rate
limits and closed Chrome sessions are deferred without consuming a move attempt;
the queue relaunches its browser session automatically. Adaptive pacing starts at
60 seconds, speeds up 20% after every three successful moves to a 15-second floor,
and slows 50% after each rate limit to a 180-second ceiling, in addition to the
600-second cooldown. Pace is persisted across pause/resume; use `--no-adaptive`
only when a fixed/random interval is specifically required.

At completion, the queue automatically runs `--orphans` discovery to the proven
stable bottom of ChatGPT history and reports both intentional remaining orphans
and any planned Conversation still loose. The scanner throws rather than silently
accepting a partial inventory. Planned Conversations that remain loose are retried
automatically up to `--max-attempts`. Start the queue, confirm it acquires the lock and
processes or defers one item, then let it continue unattended—continuous agent
watching is unnecessary. Use `bridge chat organize pause` instead of killing the
process, `resume` to continue the latest queue without reconstructing its plan,
and `--restart` only when the whole plan should intentionally be replayed.

## Constraints

- macOS only (hardcoded Chrome path, pbcopy/lsof)
- Each provider needs Chrome started with `bridge chrome start --provider <name>` and a signed-in browser session
- File operations are sandboxed to the target repo (no escape)
- No raw shell — only validated MCP tools
- Browser selectors may break when provider UIs update

## Fan-out behavior

- `--provider a,b,c` runs all in parallel
- Partial-failure tolerant: exits non-zero only when ALL fail
- `--strict`: exit non-zero if ANY fails
- Replies keyed by provider in JSON output
