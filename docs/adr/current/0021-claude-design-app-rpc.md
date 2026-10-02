# Claude Design through its in-tab app RPC

Status: implemented — 2026-10-02

## Context

Claude Design (`claude.ai/design`) is a project workspace, not a chat page. Its projects,
files, sharing, and saved Conversations live behind the app's own Connect JSON service
(`/design/anthropic.omelette.api.v1alpha.OmeletteService/<Method>`), which the page calls
with the tab's cookies and an `x-organization-uuid` header. A turn is different: the app
runs Claude's agent loop inside the tab (a streamed `Chat` call plus `RenewTurn` and
`ReleaseTurn`), and leaving the page releases the turn.

Clicking through the project list, file switcher, and share menus for reads and file
writes is slow and fragile, while the same calls are one request each.

## Decision

- Add `design` as a Provider. It shares `claude.ai` with `claude`, so tab ownership picks
  the most specific Provider for a URL (`pathPrefix: "/design"`).
- Reads and project/file/sharing changes call the app's RPC from inside a Design tab
  (`page.evaluate` fetch with the tab's cookies) — the same requests the UI sends. The
  Bridge never extracts tokens or calls the service from outside the browser.
- Turns, templates, model and effort, attachments, and new Conversations drive the DOM,
  one tab per project, and never navigate or reload a tab while its turn runs.
- Engine shutdown stops only a turn that the same process started through the engine.
- Conversation titles and the active Conversation have no UI control of their own; they
  are written the way the app writes them — a read-modify-write of the project document
  with `expectedVersion`, only while the project is idle, then a reload of its open tab.
- Fan-out rejects `design`: it closes each tab when a task ends, which would cancel the
  turn.
- Share-panel destinations that leave the app (publish as artifact, Claude Code,
  PNG/video/PDF/PowerPoint export, partner apps), comments, and version restore stay
  manual and are listed by `bridge design state`.

## Consequences

`bridge design …` and the `design_*` tools on `bridge serve` cover projects, templates,
design systems, files, model and effort, Conversations, export, and sharing with one
request where the app allows it. The RPC is internal to Claude Design and can change
without notice; replies are decoded once with all-optional Schemas, a decode failure
names the method, and `scripts/dev/verifyClaudeDesign.mjs` re-checks the live surface.
