# Docs layout

Living product truth lives at the **repo root**, not under `docs/`.

| Path | Role |
|------|------|
| `PROJECT.md` | Product intent |
| `CONTEXT.md` | Architecture map |
| `LANGUAGE.md` | Domain language |
| `CODE-STYLE.md` | Style and structure rules |
| `AGENTS.md` | Agent routing contract |

Current ADRs explain accepted architectural choices that would otherwise overload the
root guides. They are decision records, not an additional instruction layer.

Under `docs/`, accepted decisions that still govern the current system live in
[`adr/current/`](./adr/current/). Historical decisions live in
[`archive/`](./archive/) and may reference old paths.

**Rule:** add secondary documentation only when it carries current information
that does not belong in a root source-of-truth file. Archive or delete it when
it becomes stale.
