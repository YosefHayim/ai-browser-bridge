# Product health — WAVE2 providers

status: post-land (partial — FIX open)
updated: 2026-08-07

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip / origin/main | `b72ad8f` | landed WAVE2 MERGE lanes |
| backup/main-before-provider-lanes-2026-08-07 | retained | restore |

## Landed (MERGE)

| PR | Feature |
|----|---------|
| #55 | providers-registry |
| #53 | selector-webchat |
| #51 | claude |
| #54 | gemini |
| #52 | arena |
| #56 | flow |

## Still open (AUDIT FIX — not auto-landed)

| PR / branch | Feature | Fix hint |
|-------------|---------|----------|
| grok branch `refactor/w2-47-grok` | grok connector | try/catch + domain verbs (mirror #51) |
| chatgpt branch `refactor/w2-42-chatgpt` | chatgpt | remove bagging markers |

## Post-land prove

| Gate | Result |
|------|--------|
| `pnpm run verify` | **pass** |
| unit | **310/310** |
| e2e | skip |

## Residual

- Same-branch FIX then land remaining two provider PRs
- Do not re-bag into one providers PR
- Live provider e2e when env available
