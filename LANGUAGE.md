# LANGUAGE.md — ai-browser-bridge

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Terms

**Bridge**
The running tool that connects one terminal session to one — or several at once —
ChatGPT/Gemini browser Conversations, and brokers local tool calls between them. When it
drives several at once, the Bridge keeps each Conversation's state isolated — its own tab
(or isolated profile), model, context estimate, and transcript — never merged.
_Avoid_: treating several parallel Conversations as one; "browser instance" for a parallel
Conversation (a parallel Conversation is a tab in the one shared-profile Chrome, not a
second Chrome process).

**Conversation**
The actual browser thread — its model, messages, edits, and regenerations. Owned by
the provider, driven (not replaced) by the Bridge.
_Avoid_: chat, thread, session.

**Fan-out**
Driving several Conversations at once under one Bridge. A bounded pool runs them (default
one at a time; `--max-concurrency` opens more), each in its own tab with isolated state;
the reply comes back as an ordered array, one row per Conversation. The older
across-providers mode (one prompt to ChatGPT + Gemini + …) is the same operation with one
Conversation per Provider.
_Avoid_: batch, broadcast, swarm.

**Session**
The Bridge's own local record of one terminal-driven run (its metadata and event
log). A Session _describes_ a Conversation; it is not the Conversation.
_Avoid_: conversation, chat, history.

**Login**
The signed-in browser identity (the persisted Chrome profile). The thing that must
never leak. Distinct from a Session.
_Avoid_: session, account.

**Isolated profile**
A separate signed-in Chrome profile backing one Conversation for a second account, launched
on its own debug port (the shared bridge profile owns 9222). Chosen per task with
`isolate`, signed in once and reused, and — when already signed in — detected and reused
without prompting. Never cloned from another profile. A real OS Chrome profile can be
targeted by path, but only while its everyday Chrome is closed. Distinct from the shared
Login.
_Avoid_: clone, copy, incognito.

**Tunnel**
The HTTPS channel that lets ChatGPT reach the local MCP server when it cannot reach
localhost. Implemented with Cloudflare Tunnel (`cloudflared`,
`*.trycloudflare.com`).
_Avoid_: ngrok, proxy.

**Tool**
A single local capability exposed to ChatGPT over MCP — grep, read, patch, tests,
diff.
_Avoid_: command, function.

**Sandbox**
The validation boundary that confines every Tool's file access to the Target repo.
A request outside it fails loudly.
_Avoid_: jail, scope.

**Checkpoint**
A file snapshot captured around an MCP patch so the change can be rolled back.

**Provider**
One supported web service the Bridge drives (ChatGPT, Gemini, Claude, DeepSeek, Grok,
Perplexity, Flow, Duck.ai, Arena). Most are web-chat services; Flow is a generation
surface. Its id,
metadata, and core selectors are one entry in `config/index.ts`;
`BridgeProviderId` is the set of their ids.
_Avoid_: model, vendor, bot.

**Clip**
Flow's unit of output — a rendered Veo video. On the Flow Provider, a Conversation
reply is a Clip reference (its video `src` / download href), not prose.
_Avoid_: video, generation, render.

**Ingredient**
A reference image attached to a Flow prompt to steer a Clip (up to three). Flow's own
name for what `attachFilesToPrompt` uploads on the Flow Provider.
_Avoid_: attachment, reference, asset.

**Door**
A feature's curated `index.ts` — the only file other features import (as
`@/features/<name>`). Doors are wildcard barrels (`export *`) that expose only the
feature's approved public modules. Wildcard exports are allowed only in `index.ts`
or `index.tsx`; implementation modules own their public names.
_Avoid_: barrel, bare index, entrypoint.

**Target repo**
The repository the Tools operate inside (`repoPath`, default `process.cwd()`). Also
where persistent repo-local Bridge state lives, under `.bridge/`, when the run
needs sessions, tools, checkpoints, exports, screenshots, or default downloads.
_Avoid_: workspace, project root.

## Example dialogue

> **Dev:** "When I `/resume` a **Session**, does it reopen the same ChatGPT
> **Conversation**?"
> **Domain expert:** "It reopens the **Conversation** in the browser and replays the
> **Session**'s event log in the terminal. The **Session** is our record; the
> **Conversation** is ChatGPT's."

## Flagged ambiguities

- "ngrok" was used to mean the **Tunnel** — resolved: the Tunnel is Cloudflare
  Tunnel (`cloudflared`); ngrok is not used anywhere.
- "session" was overloaded between the Bridge **Session** (a local run record) and
  the **Login** (the persisted browser identity) — resolved: these are distinct
  concepts.
- **PermissionMode** is the one canonical name for the `read-only | ask | auto`
  mode (derived from `PERMISSION_MODES`). `BridgePermissionMode` was a duplicate
  literal — retired.
