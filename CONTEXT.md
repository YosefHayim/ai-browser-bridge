# CONTEXT.md — ai-browser-bridge

Orientation: what this is, its moving parts, and how they fit. For the words, see
`LANGUAGE.md`; for purpose and direction, `PROJECT.md`; for how code is written,
`CODE-STYLE.md`; for how to work in the repo, `AGENTS.md`.

## What it is

A terminal tool that drives a real ChatGPT, Gemini, Claude, DeepSeek, Grok,
Perplexity, or Flow browser Conversation — one provider or fanned out across several —
and, for ChatGPT, Claude, and Grok, exposes a narrow set of sandboxed local repo Tools
over MCP — no raw shell. You stay in one terminal workflow; the provider keeps its real
UI. (Flow is Google's Veo video studio — a generation surface, not a chat: its
Conversation reply is a Clip reference and its attachments are Ingredients.)

## The four actors

```text
 terminal (you)
      │  Ink / React CLI
      ▼
 orchestrator ───────────────┬─────────────────────────────┐
      │  Playwright + CDP     │                 MCP server   │
      ▼                       │                (MCP SDK)     ▼
 ChatGPT / Gemini browser UI  │                    local repo Tools
      ▲                       │                 (grep/read/patch/test/diff)
      │                       ▼                              │
      └────── Cloudflare Tunnel (cloudflared) ◄──────────────┘
```

| Actor | Tech | Job |
|-------|------|-----|
| **CLI** | Ink / React (`terminal/`) | Terminal UI + scriptable headless commands; one dual-mode front door. |
| **Browser** | Playwright + CDP (`providers/`) | Drives the real ChatGPT/Gemini tab behind the fixed `BrowserProvider` contract; captures responses. |
| **MCP server** | MCP SDK + Zod (`tools/`) | Exposes the local repo Tools to ChatGPT, Claude, and Grok as schema-validated, Sandbox-confined handlers. |
| **Tunnel** | `cloudflared` (`tunnel/`) | Gives the local MCP server a temporary public HTTPS URL those connectors can reach. |

Supporting features: `bridge/` (engine + orchestrator that wire it together),
`store/` (Sessions, checkpoints, logs), `domain/` (pure types, permissions, model
catalog), `user-config/` (`~/.ai-browser-bridge/` readers). `src/config/` is the shared
**data leaf** — the provider table (metadata + selectors) and tunable defaults — that
every feature depends on and which imports nothing from `features/*`.

## How the pieces relate

- A **Bridge** drives one **Conversation** — or several at once (a **fan-out**), each in its
  own tab in the one shared Chrome, with isolated model, context, and transcript. A
  persistent run records one **Session** per Conversation, grouped by a run id.
- A **Session** belongs to exactly one **Target repo**.
- **Tools** run inside the **Sandbox**, scoped to the **Target repo**.
- A **Tunnel** exposes the MCP server hosting the **Tools** to the **Conversation**.
- The **Login** is shared across all Conversations; a **Session** is per-run.

## Where state lives

Persistent Bridge state for a project is written **inside that project**, under
`<repo>/.bridge/` — `config.json`, `sessions/`, `logs/`, `checkpoints/`,
`exports/`, `screenshots/`. Plain `bridge ask` and `bridge chrome start` are
stateless by default and do not create `<repo>/.bridge/`; they only reuse the
shared Chrome profile. Browser login state does not live in repo-local state:
Chrome cookies and provider sign-in for bridge-driven sessions stay in the
shared bridge profile under `~/.ai-browser-bridge/chrome-profile` and are shared
across repos through the local debug-port Chrome process. Opt-in **isolated profiles**
(for a second account) live under `~/.ai-browser-bridge/chrome-profiles/<name>`, each
launched on its own debug port; they are signed in once and reused, never cloned. When a persistent run
needs repo-local state, the Bridge writes `.bridge/.gitignore` containing a
single `*`, so the whole directory self-ignores and never enters git (see
`docs/adr/0001-repo-local-state.md`). User-global config (custom commands,
hooks) lives in `~/.ai-browser-bridge/`.

## Where to start reading

`src/main.ts` → `config/providersConfig.ts` → `terminal/createCliFactory.ts` →
`bridge/createEngineFactory.ts` → `bridge/internal/orchestrator.ts` →
`providers/providerRegistry.ts` → `tools/index.ts`. (Full read-order in `AGENTS.md`.)
