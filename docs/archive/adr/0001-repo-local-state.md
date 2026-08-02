# Repo-local bridge state under the canonical root `.bridge/`

Persistent bridge runtime state — sessions, logs, checkpoints, exports,
downloads, screenshots, and `config.json` — is written under the target Git
working-tree root's `.bridge/`. Both `--repo` and the launch directory resolve
through `git rev-parse --show-toplevel`, so launching from a nested directory
cannot create a second state tree. An explicit non-Git directory remains its own
root.

Plain `bridge ask` and `bridge chrome start` are stateless by default and do not
create repo-local state. Browser login state is not repo-local: the signed-in
Chrome profile lives under `~/.ai-browser-bridge/chrome-profile` and is reused
across target repos. Stateless attachment manifests use the machine-global bridge
home; persistent manifests and downloaded assets share `<repo>/.bridge/downloads/`.

The bridge does not create or manage `.bridge/.gitignore`. Ignore policy belongs
to the target repository rather than to generated runtime state.

## Considered options

- **Launch-directory local:** easy to derive, but creates duplicate `.bridge/` and
  `downloads/` trees when different agents start in different subdirectories.
- **Home-global:** state can never enter a repo, but it is not co-located with the
  repository it describes.
- **Canonical repo root, login stays global (chosen):** one repo-local state tree
  regardless of launch directory, while browser identity remains shared.

## Consequences

- Every nested launch resolves to one stable state and download directory.
- An explicit non-Git target still works without requiring repository metadata.
- Plain browser asks do not create `.bridge/` in the target repo.
- Repositories decide whether and how `.bridge/` is ignored.
