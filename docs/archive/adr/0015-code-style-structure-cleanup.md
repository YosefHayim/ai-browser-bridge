# Code style and purpose-owned structure cleanup

Status: accepted
Date: 2026-07-06

## Context

The repo already had the right direction in `CODE-STYLE.md`, but several rules were
only partially reflected in code and docs:

- `LANGUAGE.md` described doors as named re-exports while `CODE-STYLE.md` and the code
  use wildcard `index.ts` doors.
- Provider root files mixed provider-wide contracts with ChatGPT-specific URL parsing.
- Native `Error` subclasses existed beside the Effect-first `Data.TaggedError` rule.
- TSDoc checks verified tag presence but allowed placeholder text.
- Regex captures such as `match?.[1]` were readable only to the original author.
- Large purpose areas such as `store/internal/sessionStore.ts` and `terminal/tui/` need
  a separate structure capstone before broad file moves.

## Decision

- Keep `CODE-STYLE.md` as the style SSOT and make `AGENTS.md` a short `## Conventions`
  digest with the digest marker.
- Doors are wildcard-only `index.ts` / `index.tsx` files. Implementation modules own
  their public names.
- Static SCREAMING_CASE constants live immediately after imports/re-export declarations,
  before interfaces, type aliases, functions, classes, or runtime exports.
- Project-owned errors use `Data.TaggedError`; native `Error` subclasses are not used for
  feature/domain errors.
- Non-obvious regexes, replacement strings, and positional captures must document the
  raw shape being parsed. Prefer named captures; if using `match?.[1]`, a nearby comment
  must explain capture group 1.
- Placeholder TSDoc is treated as missing documentation.
- No compatibility wrappers or old-path exports are kept after a rename.
- Execute the cleanup in phases:
  - Phase 1: docs, checks, and the provider canonical slice.
  - Phase 2: a separate planpage approval before splitting `sessionStore.ts`, grouping
    `terminal/tui/`, or migrating broad CLI surface area.

## Consequences

- The provider cleanup becomes the first complete target-style slice:
  `providerErrors.ts` for provider-wide typed errors and
  `chatgpt/chatgptConversationUrl.ts` for ChatGPT-only URL semantics.
- Check scripts carry more of the style burden, reducing prose-only rules.
- Larger structural moves stay reviewable and reversible because they require their own
  approval gate.
