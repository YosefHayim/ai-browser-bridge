# chatgpt-local-bridge

The shared language for a terminal tool that drives a real ChatGPT browser
conversation while exposing a narrow, validated set of local repo tools to it.

## Language

**Bridge**:
The running tool that connects one terminal session to one ChatGPT browser
conversation and brokers local tool calls between them.

**Conversation**:
The actual ChatGPT browser thread — its model, messages, edits, and
regenerations. Owned by ChatGPT, driven (not replaced) by the Bridge.
_Avoid_: chat, thread, session.

**Session**:
The Bridge's own local record of one terminal-driven run (its metadata and
event log). A Session _describes_ a Conversation; it is not the Conversation.
_Avoid_: conversation, chat, history.

**Login**:
The signed-in ChatGPT browser identity (the persisted Chrome profile). The thing
that must never leak. Distinct from a Session.
_Avoid_: session, account.

**Tunnel**:
The HTTPS channel that lets ChatGPT reach the local MCP server when it cannot
reach localhost. Implemented with Cloudflare Tunnel (`cloudflared`,
`*.trycloudflare.com`).
_Avoid_: ngrok, proxy.

**Tool**:
A single local capability exposed to ChatGPT over MCP — grep, read, patch,
tests, diff.
_Avoid_: command, function.

**Sandbox**:
The validation boundary that confines every Tool's file access to the Target
repo. A request outside it fails loudly.
_Avoid_: jail, scope.

**Checkpoint**:
A file snapshot captured around an MCP patch so the change can be rolled back.

**Target repo**:
The repository the Tools operate inside (`repoPath`, default `process.cwd()`).
Also where repo-local Bridge state lives, under `.bridge/`.
_Avoid_: workspace, project root.

## Relationships

- A **Bridge** drives one **Conversation** and records one **Session**.
- A **Session** belongs to exactly one **Target repo**.
- **Tools** run inside the **Sandbox**, scoped to the **Target repo**.
- A **Tunnel** exposes the MCP server hosting the **Tools** to the **Conversation**.
- The **Login** is shared across all Conversations; a **Session** is per-run.

## Example dialogue

> **Dev:** "When I `/resume` a **Session**, does it reopen the same ChatGPT **Conversation**?"
> **Domain expert:** "It reopens the **Conversation** in the browser and replays the **Session**'s event log in the terminal. The **Session** is our record; the **Conversation** is ChatGPT's."

## Flagged ambiguities

- "ngrok" was used to mean the **Tunnel** — resolved: the Tunnel is Cloudflare
  Tunnel (`cloudflared`); ngrok is not used anywhere.
- "session" was overloaded between the Bridge **Session** (a local run record)
  and the **Login** (the persisted ChatGPT browser identity) — resolved: these
  are distinct concepts.
