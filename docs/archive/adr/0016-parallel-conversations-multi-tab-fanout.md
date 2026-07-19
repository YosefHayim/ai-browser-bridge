# Parallel Conversations via multi-tab fan-out, not multi-process

A Bridge can drive several Conversations at once. Because Chromium's ProcessSingleton locks
a `user-data-dir` to one process — a second launch on the same profile fails with
`SingletonLock: File exists` or hijacks the first, and bypassing the lock corrupts the
profile databases — parallelism is implemented as **N tabs in the single shared-profile
Chrome on debug port 9222**, driven concurrently over the existing CDP connection, not as
multiple Chrome processes. This generalises the existing across-providers fan-out
(`fanoutOrchestrator.ts`, ADR 0012), which already runs one tab per provider, to run one
tab per Conversation; a task carries its own provider, so the provider fan-out becomes the
special case "same prompt, one task per provider."

A bounded pool schedules the Conversations: default `--max-concurrency=1` (serial), higher
on request; two tasks targeting the same live Conversation are serialised. Before any
fan-out the bridge ensures the shared Chrome is up exactly once, closing the pre-existing
cold-start race where concurrent launches raced to spawn Chrome on the same profile. Each
task opens its own tab and that tab is closed as soon as its reply is captured, so peak
memory ≈ max-concurrency tabs regardless of batch size; each result row returns the
Conversation's id + URL so it can be reopened cheaply.

For a genuinely separate account, a task may opt into an **isolated profile**: a real,
separately signed-in Chrome under `~/.ai-browser-bridge/chrome-profiles/<name>` on its own
debug port (9223+), signed in once and reused — detected and reused silently when already
signed in, failing fast with sign-in instructions when not — and **never cloned** from
another profile. A real OS Chrome profile may be targeted by path, but only when that
profile's everyday Chrome is closed (ProcessSingleton again); this path is guarded and
warned.

Verified (2026-07-13, `src/scripts/dev/verifyParallelChatgpt.mjs`): three concurrent
ChatGPT tabs in the one shared profile returned independent answers (BLUE/GREEN/RED) with
no cross-talk, each reported a resumable conversation id, a pool of two never held more than
two tabs at once (each closed on capture), and Chrome RSS returned to baseline. The first
pass also confirmed the reply wait must key off generation-complete (stop-button gone), not
the reasoning-model "Thinking" placeholder — which the real `ChatGptPage.waitForResponse`
adapter already does.

Implemented (2026-07-13) as `runFanoutTasks` (the pure bounded pool, with truncation and
`limit`/`offset` pagination) plus `runFanoutBatch` (the browser-backed driver — one tab per
task, closed on capture, isolate lanes), replacing the provider-keyed `FanoutResult`. It is
exposed as `bridge ask --batch` and the outbound MCP `ask` tool's `tasks` argument; the
old across-providers fan-out now routes through the same core as one task per provider. A
live batch through the real CLI reproduced the feasibility result — three parallel new
Conversations with distinct resumable ids at concurrency 2 (wall 95s < serial-sum 137s),
plus a resume of an existing Conversation by id that returned `mode:"existing"` and the
remembered answer.

## Considered options

- **Multiple Chrome processes, same profile:** the literal "many browsers, one profile"
  ask. Forbidden by ProcessSingleton; forcing it corrupts the profile. Rejected.
- **Multiple processes, cloned profiles:** copy the signed-in profile to N temp dirs.
  Playwright reports profile-DB corruption and cookie drift on clones, and it duplicates a
  live login. Rejected — it is the bug factory the feature exists to avoid.
- **Multiple processes, N separate real profiles:** true isolation, but N logins and N
  heavy Chromes. Kept only as the opt-in `isolate` path for a deliberate second account.
- **One Chrome, N tabs (chosen):** shares the existing login, no lock conflict, extends the
  proven across-providers fan-out, and bounds memory via close-on-capture.

## Consequences

- Parallel Conversations share one Chrome process and one ChatGPT account: one browser
  crash drops every lane, and concurrency is bounded by that account's rate limits — hence a
  conservative default of one Conversation at a time.
- The domain model changes: a Bridge now drives one *or more* Conversations, each with
  isolated page, model, context, and transcript (see `LANGUAGE.md`, `CONTEXT.md`). The
  fan-out result becomes an ordered array — one row per Conversation, echoing an optional
  caller `label` and the resolved `{mode,id,url}` — replacing the provider-keyed
  `FanoutResult` (`bridge` door; no back-compat shim, per ADR 0010).
- Fan-out output is bounded for context safety, on by default: each reply row is truncated
  to a default `maxReplyChars` (flagged `truncated` with the full length), and the result
  array is paginated with `limit`/`offset` returning `total` + `nextOffset`. The full reply
  is fetched on demand by reopening the Conversation by its returned id — the array never
  ships every full reply at once, so a large batch cannot flood the caller's context.
- A batch is stateless by default (the returned JSON array is the record); when persistence
  is on it writes one Session per Conversation, grouped by a run id.
- `isolate` profiles each cost a full Chrome and a one-time sign-in.
- Full Windows/Linux support stays out of scope: the new pool/lifecycle code is OS-neutral,
  but the launch layer (`open -na`, `pgrep`, `pkill`) remains macOS-only (see `PROJECT.md`).
