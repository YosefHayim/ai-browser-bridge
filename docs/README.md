# Docs layout

Living product truth lives at the **repo root**, not under `docs/`.

| Path | Role |
|------|------|
| `PROJECT.md` | Product intent |
| `CONTEXT.md` | Architecture map |
| `LANGUAGE.md` | Domain language |
| `CODE-STYLE.md` | Style and structure rules |
| `AGENTS.md` | Agent routing contract |

Under `docs/`:

| Path | Role |
|------|------|
| [`current/`](./current/) | Living secondary docs (keep fresh; delete or archive when stale) |
| [`archive/`](./archive/) | Historical material — may reference old paths |

**Rule:** if a doc is not the current source of truth, it belongs in `archive/`.
Do not leave superseded notes next to living ones.
