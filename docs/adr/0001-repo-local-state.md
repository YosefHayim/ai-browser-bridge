# Repo-local bridge state under a self-ignoring `.bridge/`

All bridge runtime state — sessions, logs, checkpoints, exports, screenshots, the
`config.json`, and the signed-in `chrome-profile/` — is written under
`<target-repo>/.bridge/` instead of the machine-global `~/.chatgpt-local-bridge/`
documented in `src/core/paths.ts`. State is now scoped to the repository the user
drives ChatGPT against (`repoPath`, default `process.cwd()`).

To keep this safe in a public repo, the bridge writes `.bridge/.gitignore`
containing a single `*` on first use, so the entire directory self-ignores.
Verified: `git add -A` and `git add .bridge/` both skip everything under it
(cookies, transcripts included) and `git status` stays clean; only an explicit
`git add -f` can override.

## Considered options

- **Home-global (status quo):** keep everything in `~/.chatgpt-local-bridge/`.
  Safest (state can never enter a repo) and lets the ChatGPT login persist across
  every project, but state is not co-located with the project it describes.
- **Repo-local, login stays global:** move only per-repo artifacts, keep
  `chrome-profile/` + `config.json` in home. Avoids re-login per repo.
- **Repo-local, everything (chosen):** fully self-contained per project.

## Consequences

- The user re-authenticates to ChatGPT in every repo, and each repo carries a
  multi-hundred-MB (here ~4.9 GB) Chrome profile on disk. Accepted in exchange
  for a fully self-contained, per-project install.
- Safety depends entirely on the self-written `.bridge/.gitignore`. If it is
  removed or a user runs `git add -f`, session transcripts and login cookies can
  leak into a public repo. The bridge must re-assert this file on every run.
