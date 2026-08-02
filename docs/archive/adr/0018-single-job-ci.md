# Run CI once on the minimum supported Node LTS

Status: accepted
Date: 2026-08-02

## Context

CI split formatting, type checking, tests, builds, and repository checks across
five reusable workflows. Test and build each expanded across two operating
systems and three Node versions, producing fifteen jobs that repeatedly checked
out the same commit and installed the same dependencies. The test suite uses
browser fakes and has no platform-sensitive E2E suite, so the matrix did not
exercise distinct product behavior.

Node 20 is end-of-life. Node 22 is now the minimum supported LTS for the package.

## Decision

- Pull requests and pushes to `main` run one `CI Gate` job on Ubuntu and Node 22.
- That job installs dependencies once and runs the existing `pnpm verify` SSOT.
- `actions/setup-node` caches the pnpm store using `pnpm-lock.yaml`.
- Concurrency still cancels superseded runs on the same ref.
- Tag publishing keeps its own Node 24 verification because release tags and
  manual recovery runs must prove the exact artifact they publish.
- Add an OS, Node, or browser matrix only when a real compatibility suite has a
  platform-specific assertion that the primary CI job cannot cover.

## Consequences

Normal CI drops from fifteen verification jobs and fifteen dependency installs
to one job and one install. The protected check remains named `CI Gate`, so
branch protection does not need a new status name.
