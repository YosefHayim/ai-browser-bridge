# Canonical CLI operations

Status: implemented — 2026-08-03

## Context

The old TUI and headless CLI exposed the same product capabilities through different
dispatch paths. Commander actions recovered values from generic arrays, injected a runner,
floated Promises, and used a second name beside the canonical term **Fan-out**.

## Decision

- A bare `bridge` in a TTY opens the TUI.
- A bare `bridge` without a TTY writes usage to stderr and exits non-zero.
- TUI and headless commands call the same domain operation for the same behavior.
- Each Commander action is an async closure over its concrete operation, decodes its own
  command input, and returns its Promise.
- Command registration does not accept injected runners, generic argument arrays, or
  positional booleans.
- Provider input accepts canonical Provider IDs only.
- Rename **batch** surfaces to **Fan-out** in one breaking migration. Do not retain flags,
  exports, variables, imports, or aliases under the old name.
- Domain operations return values; only terminal adapters format output and choose exit
  codes.

## Consequences

The CLI and TUI are two presentations over shared operations rather than parallel
implementations. The rename is intentionally incompatible and landed with the broader
structure capstone, so callers and current documentation changed together.
