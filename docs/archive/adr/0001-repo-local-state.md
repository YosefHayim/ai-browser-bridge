# Repo-local bridge state under a self-ignoring `.bridge/`

Persistent bridge runtime state — sessions, logs, checkpoints, exports,
screenshots, and `config.json` — is written under `<target-repo>/.bridge/`.
Plain `bridge ask` and `bridge chrome start` are stateless by default and do not
create repo-local state. Browser login state is not repo-local: the signed-in
Chrome profile lives under `~/.ai-browser-bridge/chrome-profile` and is reused
across target repos.

To keep persistent state safe in a public repo, the bridge writes
`.bridge/.gitignore` containing a single `*` when a persistent run first needs
repo-local state, so the entire directory self-ignores. Verified: `git add -A`
and `git add .bridge/` both skip everything under it and `git status` stays
clean; only an explicit `git add -f` can override.

## Considered options

- **Home-global:** keep everything in `~/.ai-browser-bridge/`.
  Safest (state can never enter a repo) and lets the ChatGPT login persist across
  every project, but state is not co-located with the project it describes.
- **Repo-local, login stays global:** move only per-repo artifacts, keep
  `chrome-profile/` in home. Avoids re-login per repo.
- **Repo-local, everything:** fully self-contained per project.
- **Repo-local only for persistent artifacts (chosen):** stateless browser asks
  reuse the global Chrome profile without writing into the target repo; TUI,
  MCP tools, checkpoints, exports, screenshots, and default downloads remain
  repo-local.

## Consequences

- The user signs in once to the shared bridge Chrome profile and every repo can
  reuse that login.
- Plain browser asks do not create `.bridge/` in the caller repo.
- Safety depends entirely on the self-written `.bridge/.gitignore`. If it is
  removed or a user runs `git add -f`, persistent transcripts/checkpoints can
  leak into a public repo. The bridge must re-assert this file on every
  persistent run.
