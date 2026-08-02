# Docs layout

Living product truth lives at the **repo root**, not under `docs/`.

| Path | Role |
|------|------|
| `PROJECT.md` | Product intent |
| `CONTEXT.md` | Architecture map |
| `LANGUAGE.md` | Domain language |
| `CODE-STYLE.md` | Style and structure rules |
| `AGENTS.md` | Agent routing contract |

Under `docs/`, historical decisions live in [`archive/`](./archive/). They may
reference old paths and are not current guidance.

**Rule:** add secondary documentation only when it carries current information
that does not belong in a root source-of-truth file. Archive or delete it when
it becomes stale.
