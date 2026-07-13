# ai-browser-bridge

Drive ChatGPT, Gemini, Claude, DeepSeek, Grok, or Perplexity in a real browser from any agent — one provider or fanned out. Exposes sandboxed local repo tools to ChatGPT over MCP, and serves outbound MCP `ask` and `search_conversations` tools so agents can call web chats natively.

## Prerequisites

- macOS
- Node.js ≥ 20, pnpm
- Google Chrome
- `cloudflared` (optional, for ChatGPT MCP tools)
- Signed-in providers: run `bridge chrome start --provider <name>` and sign in if needed

## Install & setup

```bash
git clone https://github.com/YosefHayim/ai-browser-bridge.git
cd ai-browser-bridge
pnpm install && pnpm build
pnpm link --global   # makes `bridge` available globally
```

## How to use as a tool

### MCP stdio (Claude Code, Kiro, any MCP client)

```bash
bridge serve
```

Exposes tools over stdio:
- `ask({ prompt, providers?, timeoutSeconds? })`
- `search_conversations({ query, providers?, limit? })`

### CLI (Codex, scripts, any shell-based agent)

```bash
# One provider
bridge ask "summarize this repo" --provider chatgpt --json

# Fan out across multiple
bridge ask "compare approaches" --provider claude,deepseek,grok --json
```

`--json` emits machine-readable output. Never hangs in a pipe.

## Per-agent setup

### Claude Code

```bash
claude mcp add ai-browser-bridge -- bridge serve
```

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

### Codex

Use the CLI directly in tool invocations:
```bash
bridge ask "your question" --provider chatgpt --json
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
| `bridge providers` | Show provider status + live instances |
| `bridge download` | Download conversation attachments |
| `bridge sessions` | List stored sessions |
| `bridge stop` | Kill warm Chrome |
| `bridge project list\|create` | Manage ChatGPT Projects |
| `bridge chat list\|search\|move\|archive` | List, search, organize & archive conversations |
| `bridge task list\|create` | Schedule ChatGPT Tasks |

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
- `bridge chat list` shows only loose (project-less) chats; a growing list
  there is the signal to file them into Projects.
- Archive dead or scratch chats with `bridge chat archive "<idOrTitle>"`
  (reversible — hides from the sidebar) to keep it lean. Batch with `--id`.
- Don't spawn throwaway or test conversations in the signed-in account. Use an
  isolate profile (`bridge ask --batch` with `isolate`) for scratch runs, and
  clean up anything you create.

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
