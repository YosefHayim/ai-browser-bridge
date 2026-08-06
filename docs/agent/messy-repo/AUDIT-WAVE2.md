# Messy-repo AUDIT — wave 2 (per-provider only)

Updated: 2026-08-07  
Product tip (PR base): `main` @ `97907b5` (docs tip; PR heads based on `f2acc56`)  
MATRIX: `docs/agent/messy-repo/MATRIX-WAVE2-PROVIDERS.md`  
Mode: **audit-wave**  
New feature PRs this run: **0**  
Scope: **WAVE2 provider PRs #50–#57 only** — not wave-1 re-bag

## Scoreboard

| Order | PR | Feature | Head | Intent | Deslop | CODE-STYLE | Tests | Gates | Risk | Verdict | Notes |
|------:|----|---------|------|--------|--------|------------|-------|-------|------|---------|-------|
| 1 | #55 | providers-registry | `ba6f36c` | match | better | nits | owned claimed | GG success; cubic ok; CI incomplete | low | **MERGE** | door + guards only |
| 2 | #53 | selector-webchat | `8e3b24b` | match | better | nits | **business+** 8 | GG; cubic | low | **MERGE** | deepseek/perplexity/duck adapter |
| 3 | #51 | claude | `3050c2a` | match | better | ok/nits | suite claimed | GG | low | **MERGE** | connector only |
| 4 | #50 | grok | `7717015` | match | partial | **violates residual** | related only | GG | low | **FIX** | silent `.catch` vs #51 bar |
| 5 | #54 | gemini | `22e7f31` | match | better | nits | claimed | GG | low | **MERGE** | gemini/** only |
| 6 | #52 | arena | `91cac51` | match | better | nits | claimed+ | GG | low | **MERGE** | arena/** only |
| 7 | #56 | flow | `bcbe5e1` | match | better | nits | claimed 16 | GG | low | **MERGE** | flow/** only |
| 8 | #57 | chatgpt | `ece2258` | match | partial | **violates residual** | claimed 58 | GG; cubic skipped megafile | low–med | **FIX** | bagging `// --- … ---` markers remain |

## Verdict counts

| MERGE | FIX | HOLD |
|------:|----:|-----:|
| 6 | 2 | 0 |

## HOLD

none (GitGuardian green on all WAVE2 heads)

## FIX (same branch only — no new PR / no re-bag)

| PR | Branch | Fix hint |
|----|--------|----------|
| #50 | `refactor/w2-47-grok` | Mirror #51: try/catch on submit/confirm/count probes; rename `fillForm`/`submitForm`/`openCustomForm` → connector-domain verbs; keep SSE/host quirks |
| #57 | `refactor/w2-42-chatgpt` | Delete remaining `// --- path.ts ---` bagging markers in `chatgptPage.ts`; demote residual restating `/** */` on SELECTORS/constants; prefer internal `undefined` vs `null` where not Playwright wire; re-run chatgpt vitest + biome |

## Scope isolation (critical)

| PR | Path leak? |
|----|------------|
| #50–#57 | **none** — each PR stays inside claimed provider globs |

## Overlaps / land order

1. **#55** providers-registry  
2. **#53** selector-webchat  
3. **#51** claude  
4. **#50** grok **after FIX** (or land-as-progress only if human overrides)  
5. **#54** gemini → **#52** arena → **#56** flow  
6. **#57** chatgpt **after FIX** (last among providers)

Do **not** squash these back into one `providers` PR.

## Dry-land integration

| Item | Value |
|------|--------|
| Base | `origin/main` @ `97907b5` |
| Branch | `audit/dry-land-w2-20260807-004849` (local only) |
| Worktree | `.worktrees/audit-dry-land-w2-20260807-004849` |
| Combined SHA | `9fbdd4139d3f6e872b3444f31a05d31026a5542a` |
| Merged in order | #55 #53 #51 #50 #54 #52 #56 #57 |
| Conflicts | **none** |
| Unit | `pnpm test` → **pass** (54 files / **310** tests) |
| Typecheck | `tsc --noEmit` → pass |
| Boundaries | OK (181 files) |
| Style guide | OK (32 rules) |
| Biome CI | pass (200 files) |
| E2E | **skip** — live Chrome/provider env not available |
| Tip advanced? | **no** |

## Code slices (planpage)

| Feature | Path | Why |
|---------|------|-----|
| registry | `providers/streamingGuard.ts` | try/catch deslop (#55) |
| selector | `selectorDrivenProvider.ts` | multi-provider adapter (#53) |
| chatgpt | `chatgpt/chatgptPage.ts` | FIX residual bagging markers (#57) |
| gemini | `gemini/geminiPage.ts` | clean small lane (#54) |

## Residual (not this wave)

- Live provider e2e  
- FIX #50 / #57 same-branch  
- Optional deeper split of deepseek/perplexity/duck into separate modules (today one adapter file)

## Per-PR blocks (condensed)

### PR #55 — providers-registry → MERGE
### PR #53 — selector-webchat → MERGE  
### PR #51 — claude → MERGE
### PR #50 — grok → FIX (silent catch residual)
### PR #54 — gemini → MERGE
### PR #52 — arena → MERGE
### PR #56 — flow → MERGE
### PR #57 — chatgpt → FIX (bagging markers)
EOF
## Land-wave result (2026-08-07)

- **Merged:** #55 #53 #51 #54 #52 #56
- **Left open (FIX):** grok + chatgpt (branches restored after recovery; see open PRs)
- **Post-land verify:** pass 310 tests @ `b72ad8f`

## FIX re-audit + land (2026-08-07)

- #50 re-scored **MERGE** after try/catch + domain verbs
- #57 re-scored **MERGE** after 155 bagging markers removed
- Both merged; tip verify green
