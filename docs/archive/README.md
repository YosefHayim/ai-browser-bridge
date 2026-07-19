# Archive

Historical material. Useful for *why* a decision was made; **not** the source of
truth for current paths, scripts, or APIs.

## Architecture Decision Records

[`adr/`](./adr/) is an append-only decision log (0001–…).

- Read root `CODE-STYLE.md` / `CONTEXT.md` / `PROJECT.md` for what is true now.
- Older ADRs may name paths that later ADRs moved (for example `scripts/dev/` →
  `src/scripts/dev/` → `src/scripts/gates/` + `src/scripts/maintain/`).
- Partial supersession is noted in the ADR body when known (for example 0005 →
  0011, script location updates in 0017).

| ADR | Title |
|-----|-------|
| [0001](./adr/0001-repo-local-state.md) | Repo-local bridge state under `.bridge/` |
| [0002](./adr/0002-adopt-biome-and-unified-ci.md) | Biome + unified CI gate |
| [0003](./adr/0003-cli-surface-and-dual-mode.md) | CLI surface and dual-mode front door |
| [0004](./adr/0004-dependency-baseline.md) | Dependency baseline |
| [0005](./adr/0005-camelcase-filenames-and-internal-impls.md) | camelCase filenames + `internal/` |
| [0006](./adr/0006-provider-registry-ssot.md) | Provider registry SSOT |
| [0007](./adr/0007-provider-adapters-generic-webchat.md) | Generic web-chat adapters |
| [0008](./adr/0008-global-distribution.md) | Global npm distribution |
| [0009](./adr/0009-config-ssot-doors-and-path-alias.md) | Config SSOT, doors, `@/` alias |
| [0010](./adr/0010-no-backward-compatibility.md) | No backward compatibility |
| [0011](./adr/0011-colocated-tests-and-src-scripts.md) | Co-located tests + scripts under `src/` |
| [0012](./adr/0012-serve-outbound-ask-gateway.md) | `bridge serve` outbound ask gateway |
| [0013](./adr/0013-adopt-effect-ts.md) | Adopt Effect |
| [0014](./adr/0014-dependency-changes-effect-migration.md) | Effect dependency changes |
| [0015](./adr/0015-code-style-structure-cleanup.md) | Code-style structure cleanup |
| [0016](./adr/0016-parallel-conversations-multi-tab-fanout.md) | Multi-tab parallel conversations |
| [0017](./adr/0017-safe-structure-cleanup.md) | Tunnel twin, script triage, empty trees |
