# Messy-repo MATRIX wave 2 — per-provider lanes

Updated: 2026-08-07  
Mode: **setup-wave complete** (provider-granular) → next **audit-wave**  
Reason: Wave 1 under-split — bagged all of `src/features/providers/**` into one PR (#35/#39). User expects **one branch/feature per provider surface**.

Product tip: `main` @ `f2acc56`  
Backup: `backup/main-before-provider-lanes-2026-08-07`  
Host: **A** (background subagents)

## Why this wave

| Wave 1 (wrong for providers) | Wave 2 (expected) |
|------------------------------|-------------------|
| One lane: `providers` | One lane per provider surface |
| Single PR for chatgpt+gemini+arena+flow+… | Independent reviewable PRs |
| Hard to review / land / revert one provider | Isolate risk per adapter |

## Lanes

| Provider surface | Issue | Branch | Worktree | Path globs | PR | Notes |
|------------------|-------|--------|----------|------------|-----|-------|
| chatgpt | #42 | `refactor/w2-42-chatgpt` | `.worktrees/refactor-w2-42-chatgpt` | `src/features/providers/chatgpt/**` | **#57** `ece2258` | bespoke page |
| gemini | #43 | `refactor/w2-43-gemini` | `.worktrees/refactor-w2-43-gemini` | `src/features/providers/gemini/**` | **#54** `22e7f31` | bespoke page |
| arena | #44 | `refactor/w2-44-arena` | `.worktrees/refactor-w2-44-arena` | `src/features/providers/arena/**` | **#52** `91cac51` | dual A/B |
| flow | #45 | `refactor/w2-45-flow` | `.worktrees/refactor-w2-45-flow` | `src/features/providers/flow/**` | **#56** `bcbe5e1` | video studio |
| claude | #46 | `refactor/w2-46-claude` | `.worktrees/refactor-w2-46-claude` | `claudeConnector.ts` | **#51** `3050c2a` | MCP connector UI |
| grok | #47 | `refactor/w2-47-grok` | `.worktrees/refactor-w2-47-grok` | `grokConnector.ts` | **#50** `7717015` | MCP connector UI |
| selector-webchat | #48 | `refactor/w2-48-selector-webchat` | `.worktrees/refactor-w2-48-selector-webchat` | `selectorDrivenProvider.ts(+test)` | **#53** `8e3b24b` | deepseek, perplexity, duck (+ claude/grok chat via selector) |
| providers-registry | #49 | `refactor/w2-49-providers-registry` | `.worktrees/refactor-w2-49-providers-registry` | door + streamingGuard + stallWatchdog + browserProvider | **#55** `ba6f36c` | shared registry only |

## Product provider IDs (from config)

| ID | Lane ownership |
|----|----------------|
| chatgpt | #42 chatgpt |
| gemini | #43 gemini |
| arena | #44 arena |
| flow | #45 flow |
| claude | #46 connector + #48 selector adapter for chat |
| grok | #47 connector + #48 selector adapter for chat |
| deepseek | #48 selector-webchat |
| perplexity | #48 selector-webchat |
| duck | #48 selector-webchat |

## Merge order (after audit)

1. #49 providers-registry (contracts/door)
2. #48 selector-webchat
3. #46 claude, #47 grok (connectors)
4. #43 gemini, #44 arena, #45 flow
5. #42 chatgpt (largest) last among providers

## Next

```text
/messy-repo audit
```

Score only WAVE2 open PRs; do not re-open wave-1 structure work.
EOF