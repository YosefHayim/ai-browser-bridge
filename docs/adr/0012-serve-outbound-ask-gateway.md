# Serve the outbound `ask` gateway over stdio (`bridge serve`)

ADR 0008 promised agents could "wire the outbound MCP `ask` tool," and
`agentGateway/askGatewayServer.ts` built and unit-tested `createAskGatewayServer` — but
nothing ever served it. The factory carried a `LIVE-VERIFY: the stdio entry … is wired at
the composition root (see Phase 4 distribution)` note that was never completed, so the tool
other agents were meant to call was unreachable: there was no `bridge` command to launch it.

## Decision

- **`bridge serve` launches the `ask` gateway as a stdio MCP server.** A new headless
  command starts an MCP server over stdio exposing the single `ask` tool; an MCP client
  (Claude Code, Cursor, …) spawns `bridge serve` as a subprocess and calls
  `ask({ prompt, providers?, timeoutSeconds? })` as a native tool, replies keyed by provider.
- **The composition root injects a browser-backed `runFanout`.** `runServe` (terminal)
  builds the dependency by reusing the single-ask machinery — each call fans out via
  `askOneProvider` + `fanoutAsk`, so the warm browser is shared across calls and the
  partial-failure tolerance of `bridge ask` is inherited. `agentGateway` stays
  transport-only: `serveAskGatewayStdio(deps)` connects `createAskGatewayServer(deps)` to a
  `StdioServerTransport` and blocks until the client closes stdin.
- **stdout is the JSON-RPC channel — nothing else may touch it.** Per the MCP stdio spec
  ("The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message";
  logging **MAY** go to `stderr`), `runServe` redirects `console.log`/`info`/`debug` to
  stderr before starting anything, so engine/browser logs cannot corrupt the stream. The
  gateway runs with `withTools: false` — no inbound tunnel/connector — so it is a pure
  prompt→reply surface. Message framing (newline-delimited, no embedded newlines), UTF-8,
  and the initialize handshake are handled by the official `@modelcontextprotocol/sdk`
  transport, not hand-rolled.
- **A door for the feature.** `agentGateway/index.ts` re-exports the server, its types, and
  the serve entry; `terminal` imports them via `@/features/agentGateway`.

## Consequences

- Completes the ADR 0008 outbound surface and extends the ADR 0003 command surface: `bridge
  serve` is the launch command, verified end-to-end by a live `initialize` + `tools/list`
  handshake (clean stdout, empty stderr, `ask` advertised with its schema).
- Live `ask` calls require a signed-in browser (`bridge login --provider <name>` once);
  tool discovery over MCP works without one.
- No new dependency and no new class — reuses the `StdioServerTransport` already shipped
  with the MCP SDK for the inbound HTTP server, and the existing fan-out core.
