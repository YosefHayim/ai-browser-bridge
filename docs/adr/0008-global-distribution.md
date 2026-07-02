# Global distribution: npm package, `bridge` bin, trusted publishing

The tool is now a provider-agnostic, agent-facing CLI. To let any agent or shell reach
it, it ships as a globally-installable npm package (`npm i -g ai-browser-bridge` →
`bridge` on PATH), not just a repo-local dev tool.

## Decision

- **Package `ai-browser-bridge`, bin `bridge`.** Global install exposes the `bridge`
  command. `bin` is a single unscoped `bridge`. **Trade-off acknowledged:** `bridge` is
  a generic name and can collide with another globally-installed `bridge` on a shared
  PATH. Kept for now for memorability; if a collision surfaces, add a scoped alias
  (`@yosefhayim/ai-browser-bridge`) or a distinct second bin without a breaking rename.
- **Ship only `dist/`.** `files: ["dist"]` — the bundled `dist/bridge.js` (+ map, types),
  README(s), LICENSE, and `package.json`. Source, tests, `scripts/dev/`, and config never
  ship. `npm pack --dry-run` confirms the contents (~275 kB packed).
- **Trusted publishing via `publish.yml`** (from the dufflebag template, Phase 0): npm
  OIDC binds provenance to this repo + the `publish.yml` filename — no long-lived npm
  token. `publishConfig.provenance: true` records provenance on every release. A release
  is a pushed `v*.*.*` tag; the workflow runs the full `verify` gate before publishing.
- **`repository`/`homepage`/`bugs`** point at the GitHub repo so npm renders provenance
  and links.

## One-time setup (then releases are automatic)

1. `npm publish --access public` once for `v0.1.0` to create the package.
2. On npmjs.com → package → Settings → Trusted Publisher: add `YosefHayim/ai-browser-bridge`
   and workflow file `publish.yml`. (Renaming that file invalidates the OIDC match.)
3. Thereafter: `git tag vX.Y.Z && git push --tags` → CI verifies and publishes with
   provenance.

## Consequences

- Any agent can `npm i -g ai-browser-bridge` and shell out to `bridge ask --json`, or
  wire the outbound MCP `ask` tool — the "global CLI for agents" goal.
- No secrets in CI; supply-chain provenance is attached automatically.
- The generic-name risk is deferred, not ignored — documented here so a future rename is
  a conscious choice, not a surprise.
