# CLI command surface and the dual-mode "interactive front door"

`bridge` is both a human TUI and a scriptable tool. A deep audit confirmed the
routing is structural (which Commander action fires), the two modes share one core,
and there was one real gap: a bare `bridge` in a non-TTY still tried to mount Ink.

## Command surface

| Verb | Purpose | Key flags |
|------|---------|-----------|
| `bridge` (bare) | Interactive Ink TUI | `-r/--repo`, `-p/--port`, `--provider`, `--no-browser` |
| `bridge ask <prompt…>` | One-shot headless send-and-print | `--provider a,b,c --strict --json --tools --fresh --conversation --model --timeout --attach` |
| `bridge download` | Conversation attachments (ChatGPT) | `--conversation --out --id --scan --json` |
| `bridge sessions` | List stored sessions as JSON | — |
| `bridge login` | One-time browser sign-in | `--repo --provider` |
| `bridge stop` | Kill the warm Chrome on the debug port | — |

In-TUI: 42 built-in slash commands via one registry (metadata arrays composed +
`executeCommand`), plus custom markdown commands loaded at dispatch from
`.bridge/commands/` and `~/.ai-browser-bridge/commands/`.

## Decision — the dual-mode contract

1. **Bare + TTY → menu (Ink TUI); flags or non-TTY → defer and never hang.** Bare
   `bridge` in a non-TTY prints a one-line stderr hint and `exit(1)` — it never
   mounts Ink into a pipe. `runTui` awaits `app.waitUntilExit()` so Ink owns its
   lifecycle and restores the terminal on crash.
2. **Both routes call the same core** — `startEngine` + `engine.ask`. No send logic
   is duplicated between headless and TUI.
3. **Headless is stdout-clean** — `console.log`→stderr; machine-readable payload on
   stdout; every headless path ends in an explicit `process.exit`.
4. **Slash commands and headless subcommands share the underlying functions.**
5. Signal handlers use `process.once`.

## Decision — multi-provider fan-out & two front doors, one core

- **`--provider` accepts a comma list.** One id → the existing single-provider path,
  byte-for-byte unchanged. Two or more → `fanoutAsk` (`bridge/fanoutOrchestrator.ts`):
  each provider runs the single-ask machinery, outcomes are captured independently
  (`{ ok, reply|error, elapsedMs }`) and printed keyed by provider — `--json` emits the
  map. Partial-failure tolerant: exit non-zero only when **all** fail, or with
  `--strict` when **any** fails.
- **Two front doors over one core.** The same fan-out core backs (a) the `bridge ask`
  CLI and (b) an **outbound** MCP `ask` tool (`agentGateway/askGatewayServer.ts`) that a
  local agent calls to drive web chats. This is the OPPOSITE direction to the inbound
  MCP server in `tools/` (repo tools → web model). Three MCP directions total, kept in
  separate feature slices.
- **Provider parsing is fail-loud** via `parseProviderList` (SSOT in `providerRegistry`):
  an unknown id in the list exits/returns cleanly with the valid set, never silently.
- **LIVE-VERIFY:** the concurrent multi-tab browser execution and the stdio entry that
  serves the outbound gateway are wired at the composition root and need checking against
  real signed-in sessions; the orchestration core, parsing, and tool logic are unit-tested.

## Audit fix-list (tracked)

- **High:** TTY guard in `runTui`; `await app.waitUntilExit()`.
- **Medium:** surface orchestrator `error` events in the TUI message pane (currently
  dropped); fix the single-slot prompt queue (a 2nd queued prompt silently clobbers
  the 1st).
- **Low:** remove dead `downloadConversationIdFromPage`; reconcile `/statusline` vs
  identical `/status`; show aliases (`/work /retry /open`) in autocomplete; guard
  `/copy` (pbcopy) off-macOS.

## Consequences

Scripting `bridge` can no longer produce the cryptic Ink raw-mode crash; the
contract is documented and codified as CLI rules in `CODE-STYLE.md`.
