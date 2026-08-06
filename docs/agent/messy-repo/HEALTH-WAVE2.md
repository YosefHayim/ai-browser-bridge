# Product health — WAVE2 providers (audit-draft)

status: audit-draft  
updated: 2026-08-07

## Tips

| Ref | SHA | Role |
|-----|-----|------|
| product tip | main @ 97907b5 | PR base / dry-land base |
| backup/main-before-provider-lanes-2026-08-07 | tip at wave start | restore |

## WAVE2 features

| id | paths | verdict |
|----|-------|---------|
| providers-registry | door + guards | MERGE #55 |
| selector-webchat | selectorDrivenProvider | MERGE #53 |
| claude | claudeConnector.ts | MERGE #51 |
| grok | grokConnector.ts | **FIX #50** |
| gemini | gemini/** | MERGE #54 |
| arena | arena/** | MERGE #52 |
| flow | flow/** | MERGE #56 |
| chatgpt | chatgpt/** | **FIX #57** |

## Dry-land

| Item | Result |
|------|--------|
| unit | 310 pass |
| conflicts | none |
| tip advanced | no |

## Residual

- FIX #50, #57 same branch
- live provider e2e
- do not re-bag into one providers PR
