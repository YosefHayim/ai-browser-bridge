# chatgpt-local-bridge

Terminal bridge for using ChatGPT browser conversations with controlled local machine tools.

## Why This Exists

ChatGPT is strongest when it keeps the real browser conversation, model picker, message editing, regeneration, and account/session behavior intact. Local development work is strongest in the terminal, where files, tests, diffs, and patches can be inspected and changed directly.

This project exists to connect those two surfaces without giving ChatGPT raw shell access.

The goal is simple: keep the user in one terminal workflow while still using the real ChatGPT browser UI and a narrow, validated set of local MCP tools.

## What It Solves

- Lets a terminal prompt drive an existing ChatGPT browser session.
- Exposes local repo tools to ChatGPT through MCP: grep, read, patch, tests, and diff.
- Keeps file access inside the selected repo through sandbox validation.
- Uses allowlisted test commands instead of arbitrary shell execution.
- Bridges local MCP over HTTPS through Cloudflare Tunnel when ChatGPT cannot reach localhost.
- Tracks visible ChatGPT conversation context in the terminal with model-aware estimates.
- Brings browser actions into terminal commands: `/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact`.
- Persists local bridge sessions and transcripts outside the repo for `/sessions`, `/transcript`, `/copy`, and `/export`.
- Adds runtime safety controls with `/permissions` and file checkpoints around MCP patches.
- Supports project commands/instructions through `.bridge/commands`, `AGENTS.md`, and `CLAUDE.md`.
- Improves the terminal composer with prompt history, reverse search, queued prompts, visible `@file` suggestions, and command-aware argument suggestions.

## Architecture

```text
terminal
  |
  | Ink/React CLI
  v
orchestrator
  |------------------ browser automation ------------------|
  |                                                        v
  |                                                ChatGPT browser UI
  |
  |------------------ MCP server --------------------------|
                                                           v
                                            local repo tools through sandbox
```

The CLI is the control surface. The browser is the ChatGPT surface. MCP is the local-tool boundary. The tunnel makes the local MCP server reachable from ChatGPT when needed.

## Tech Stack Choices

### TypeScript

Used because the project is mostly integration code: CLI state, browser selectors, MCP schemas, config, and tool payloads. Strict TypeScript catches contract drift between those layers before runtime.

### Node.js

Used because the project is a local developer tool. Node gives direct access to subprocesses, filesystem APIs, HTTP servers, and the TypeScript ecosystem without extra runtime packaging overhead.

### Commander

Used for the outer `bridge` command. It keeps startup flags simple: repo path, MCP port, Chrome profile, and browser opt-out.

### Ink and React

Used for the terminal UI because the bridge needs more than prompt-in/prompt-out. It needs a live message pane, status bar, command suggestions, confirmation states, and context/model display. React state keeps those UI states explicit.

### Inquirer

Used only for startup profile selection. Chrome profile choice is an interactive setup problem, not a permanent TUI concern.

### Playwright

Used to automate the real ChatGPT browser UI. The project deliberately uses the browser surface because it preserves ChatGPT account state, model picker behavior, conversation history, message editing, and regeneration behavior.

### Chrome CDP

Used to attach to or launch Chrome through the remote debugging port. This avoids losing the user's ChatGPT login and lets the bridge reuse an actual Chrome profile.

### MCP SDK

Used because MCP is the right boundary for exposing tools to ChatGPT. The bridge does not expose a shell. It exposes named tools with schemas and handlers.

### Zod

Used for tool argument schemas. Every MCP tool has typed inputs before it touches files, tests, or patches.

### Cloudflare Tunnel

Used because ChatGPT needs an HTTPS endpoint for an MCP connector, while the tool server runs locally. The tunnel provides a temporary public route to the local MCP server without deploying the bridge.

### Vitest

Used for fast unit coverage around safety-sensitive local behavior such as sandbox validation, file resolution, and context counting.

### tsup

Used to ship a small Node ESM build from the TypeScript entrypoint.

## Important Design Boundaries

The bridge does not provide raw shell execution. Test execution is allowlisted.

All file operations are validated against the configured repo root.

The ChatGPT UI is treated as an external browser product. Selectors are isolated in `src/browser/chatgpt-page.ts` so UI drift is easier to fix.

The command system is intentionally data-driven. Built-in commands live in one registry array and are registered through one loop, so aliases, help, autocomplete, and execution use the same source of truth.

MCP tools stay split by tool because each tool has different sandbox rules. Their shared subprocess runner is centralized, but the handlers remain separate for reviewability.

## Problems Faced

### Browser Login and Session State

Launching a fresh automated browser loses the user's ChatGPT session. The bridge works around that by detecting Chrome profiles, using the selected profile, and connecting over Chrome DevTools Protocol when possible.

### Browser Automation Detection

ChatGPT and Cloudflare can behave differently under obvious automation. The browser manager launches Chrome directly and then connects over CDP, rather than relying only on Playwright's default automation launch path.

### ChatGPT UI Drift

The browser UI changes. Buttons, menus, and Radix dropdown structure can move. Selectors are grouped in the browser layer so fixes stay localized.

### Safe Local Access

The useful version of this tool needs real repo access, but raw shell access would be too broad. The MCP layer exposes only specific capabilities and validates paths before reading or patching.

### Context Counting

The ChatGPT browser does not expose exact server-side token usage. The bridge syncs visible conversation messages and applies model-aware estimates from documented context windows. This is useful for planning, but it is still an estimate because hidden system text, attachments, reasoning tokens, and server-side truncation are not visible in the browser DOM.

### Public Connectivity

Localhost is not enough for ChatGPT MCP connector flows. Cloudflare Tunnel solves reachability without requiring the user to deploy infrastructure.

When the bridge starts it prints a `Connector:` URL ending in `/mcp`. With browser automation enabled, startup automatically syncs that URL into the ChatGPT app connector and selects it in the composer. `/connector` is a retry command for UI drift or account permission issues, not a step the user should repeat after every restart. The server also keeps `/sse` available as a fallback for older clients, but the printed `Connector:` URL is the canonical one.

The bridge uses one canonical ChatGPT dev app name: `chatgpt-local-bridge`. Startup removes stale bridge variants before creating a connector, so old names such as `chatgpt-local-bridge-live` do not accumulate. ChatGPT can still show the same dev app under both Enabled apps and Drafts; that is one app id, not two connectors.

## Commands

```text
/help             list commands
/conversations    list ChatGPT sidebar conversations
/resume <query>   resume by number, title, or id
/new              start a new ChatGPT conversation
/model [name]     show or switch the browser model
/rewind [text]    edit the last prompt and regenerate
/retry [text]     alias for /rewind
/stop             stop the active response
/context          show model-aware context estimate
/logs             show today's local bridge log file
/sessions         list local bridge sessions
/transcript       print the local session transcript
/copy             copy the local transcript to clipboard
/export           export the local transcript
/permissions      show or switch MCP permission mode
/checkpoints      list file checkpoints
/restore          restore files from a checkpoint
/review           ask ChatGPT to review local changes
/status           show repo/model/context/session/tool status
/mcp              show connector setup and exposed tools
/connector        open ChatGPT app/connector setup
/clear            clear the local terminal chat view
/commands         list custom project/user commands
/attach-image     attach a repo image file to ChatGPT
/screenshot       capture desktop/mobile screenshots for a URL
/ui-qa            capture UI screenshots and request a review
/diff             ask ChatGPT to inspect the current diff
/compact          ask ChatGPT for a concise progress summary
/task <request>   send a project-agent task with MCP tool instructions
/exit             shut down the bridge
```

`/open` remains as a compatibility alias for `/resume`. `/work` is an alias for `/task`.

Use `/task` for code changes and refactors where ChatGPT should inspect the repo before answering. Natural prompts that look like project work, such as "check my local project structure", are also wrapped with the same MCP-first instructions.

```text
/task optimize the MCP tool registry and run focused verification
```

The command wraps your request with the repo path, available MCP tools, and the required inspect-read-patch-test-diff workflow.
For ChatGPT to actually call those tools, the current `Connector:` URL printed at startup or shown by `/status` must be active in ChatGPT. Normal startup handles that automatically when the browser is connected.

## Terminal Shortcuts

- Press `Esc` twice quickly to stop the active ChatGPT response. This uses the same browser action as `/stop`.
- Use `Up` and `Down` to browse prompt history.
- Use `Ctrl+R` to pull the newest history entry matching the current draft.
- Use `Tab` to accept the first visible suggestion for `@file` mentions, slash commands, command arguments, image paths, sessions, checkpoints, permissions, models, and review scopes.
- If a prompt is submitted while another send is active, it is queued and sent next.

## File Mentions

Type repo-relative file mentions directly in the terminal prompt:

```text
explain this file @README.md
refactor the CLI input flow in @src/cli/app.tsx
compare @src/core/file-resolver.ts with @tests/core/file-resolver.test.ts
```

While typing an active `@` mention, the terminal shows matching repo files and folders and `Tab` inserts the first match. The cyan `Files:` preview line still shows mentions already present in the draft. On send, the bridge resolves each mention inside the configured repo and expands it into the prompt as a file-content block before ChatGPT receives it.

Current rules:

- Mentions are repo-relative paths such as `@README.md` or `@src/cli/app.tsx`.
- Paths that escape the repo root are skipped.
- Missing files are inserted as `[file not found: ...]`.
- Files above 100 KB are not inlined; the prompt receives a size warning instead.
- Paths with spaces are not supported yet.

## Logs

The bridge writes local JSONL logs outside the project repo:

```text
~/.chatgpt-bridge/logs/YYYY-MM-DD.jsonl
```

Startup prints the active log path, and `/logs` prints it again from inside the CLI. Logs include terminal-sent ChatGPT messages, captured assistant messages, and MCP tool call/result summaries when ChatGPT actually calls the registered connector. They are intentionally not stored under this repository, so normal bridge usage does not dirty the working tree.

## Local Sessions and Transcript Export

Every bridge launch creates a local session under:

```text
~/.chatgpt-bridge/sessions/<session-id>/
```

Each session stores metadata in `metadata.json` and append-only events in `events.jsonl`. Use `/sessions` to list them, `/resume --last` or `/resume <session-id>` to make a local session current, `/transcript` to print it, `/copy` to copy it with `pbcopy`, and `/export` to write Markdown, JSON, or JSONL based on the output extension.

## Permissions and Checkpoints

MCP tools are filtered by `/permissions`:

```text
/permissions read-only
/permissions ask
/permissions auto
```

`read-only` allows `grep_code`, `read_file`, and `git_diff`. `auto` allows the narrow write/test tools. `ask` currently blocks write/test/process tools with a clear MCP result until interactive confirmation is implemented.

`apply_patch` creates before/after checkpoints for patch paths under:

```text
~/.chatgpt-bridge/checkpoints/
```

Use `/checkpoints`, `/restore <checkpoint-id>`, or `/rewind --files <checkpoint-id>` to recover file state.

## Custom Commands and Project Instructions

Custom commands are Markdown files in:

```text
.bridge/commands/*.md
~/.chatgpt-bridge/commands/*.md
```

The filename becomes the slash command name. Optional frontmatter supports `description`, `model`, and `allowedTools`. Command bodies support `$ARGUMENTS`, `$1`, `$2`, and later positional placeholders.

`/task` automatically includes repo-root `AGENTS.md` and `CLAUDE.md` when present so ChatGPT receives the project operating rules with the MCP workflow.

## Hooks and Frontend QA

Hook config is read from `.bridge/hooks.json` and `~/.chatgpt-bridge/hooks.json` for lifecycle events such as `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, and `SessionEnd`. Hook command execution is intentionally disabled until an allowlisted confirmation flow exists; invalid hook config is reported at startup.

Frontend helpers:

- `/screenshot <url>` captures desktop and mobile PNGs under `~/.chatgpt-bridge/screenshots/`.
- `/attach-image <repo-path>` attaches a repo image file to the ChatGPT composer when the browser exposes file upload.
- `/ui-qa <url>` captures screenshots, attaches them when possible, and sends a focused UI review prompt.

## Local Development

```bash
npm install
npm test
npm run build
npm start -- --repo /path/to/repo
```

Optional flags:

```bash
bridge --repo /path/to/repo
bridge --port 8765
bridge --browser-profile "/Users/me/Library/Application Support/Google/Chrome/Default"
bridge --no-browser
```

## Current Limitations

- ChatGPT browser selectors can break when the web UI changes.
- Context usage is estimated, not exact.
- Cloudflare Tunnel requires `cloudflared` to be installed.
- The bridge is local-first; it is not designed as a hosted multi-user service.
- MCP tools are intentionally narrow. Add new tools only when they can be schema-validated and sandboxed.
- Hook command execution is parsed and reported but not executed yet.
- Image upload depends on the current ChatGPT browser attachment controls.
