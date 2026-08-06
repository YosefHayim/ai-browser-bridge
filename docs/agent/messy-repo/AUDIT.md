# Messy-repo AUDIT — ai-browser-bridge

Updated: 2026-08-06
Product tip (residual PR base): `reorg/structure-cleanup` @ `d369dd15ea0ce271bb9e3cdf91c21e6e8697143c`
GitHub default: `origin/main` @ `4683b8e2f1fc12fc3c1d412b280ad738c120bfd5`
MATRIX: docs/agent/messy-repo/MATRIX.md
Mode: audit-wave
New feature PRs this run: **0**

## Scoreboard

| Order | PR | Feature | Head | Intent | Deslop | CODE-STYLE | Tests | Gates | Risk | Verdict | Notes |
|-------|-----|---------|------|--------|--------|------------|-------|-------|------|---------|-------|
| 1 | #17 | structure-capstone | `d369dd1` | match | better | nits | suite preserved | unit local verify; GG on head; CI only when →main | med | **MERGE** | Land first into main |
| 2 | #31 | domain | `60e2a1a` | match | better | nits | updated permissions | unit local; GG; no Actions (base≠main) | low | **MERGE** | barrels deleted; status SSOT |
| 3 | #34 | store | `644df36` | match | better | nits | 22/22 claimed | unit local; GG success | low | **MERGE** | free fns own impl |
| 4 | #30 | browser | `9df19c4` | match | better | nits | 14/14 claimed | unit local; GG; cubic done | low | **MERGE** | BrowserSession deslop |
| 5 | #32 | bridge | `1629ec5` | match | better | nits | 24/24 claimed | unit local; GG | low | **MERGE** | EngineAssembly; no ?? left |
| 6 | #36 | tools+tunnel | `c2cf3dc` | match | better | nits | 18/18 claimed | unit local; GG; doors | low | **MERGE** | providers door downloads |
| 7 | #33 | agentGateway | `4f5ed07` | match | better | nits | 18/18 claimed | unit local; GG | low | **MERGE** | shared gateway helpers |
| 8 | #29 | userConfig | `2c0e1f0` | match | better | nits | 15/15 claimed | unit local; GG | low | **MERGE** | dual-API dropped |
| 9 | #28 | conversationCatalog | `8eb8bb1` | match | better | ok/nits | **business+** (7 expanded) | unit local; GG | low | **MERGE** | best test expansion |
| 10 | #35 | providers | `525e745` | partial | better | **violates residual** | suite claimed | unit local; GG | low | **FIX** | chatgptPage/flow* cold |
| 11 | #37 | terminal | `70b9e55` | partial | better | **violates residual** | suite claimed | unit local; GG | med | **FIX** | handle* army; cliTypes; ?? |

## Verdict counts

| MERGE | FIX | HOLD |
|-------|-----|------|
| 9 | 2 | 0 |

## HOLD (do not land)

| PR | Reason |
|----|--------|
| — | none this wave (GitGuardian green on sampled residual heads) |

## FIX (same branch only — no new PR)

| PR | Branch | Fix hint |
|----|--------|----------|
| #35 | `refactor/18-providers` | Second pass: `chatgptPage.ts` (strip `@param`/`@example`, replace `??`/nested ternaries), `flow/flowAssets.ts`, `flow/flowGenerate.ts`, `chatgptConversationUrl.ts`. Keep behavioral `BrowserProvider` interfaces. |
| #37 | `refactor/22-terminal` | Rename `handleX` command handlers to domain verbs; convert `cliTypes.ts` data `interface`→readonly `type`; replace status-line `??` presentation chains with explicit branches; rename test `createCommandContext`→`commandContextFor`; prefer full `pnpm verify`. |

Optional nits (not blocking MERGE): #17 strip stray literal `EOF` at end of MATRIX.md (fixed locally during audit); #31/#34 mark remaining type fields `readonly`.

## Overlaps / land order

1. **#17** structure-capstone → `main` (product tip advances)
2. Residual into tip (MATRIX order; dry-land proved conflict-free):
   - #31 domain → #34 store → #30 browser → #32 bridge → #36 tools → #33 agentGateway → #29 userConfig → #28 conversationCatalog
3. **#35** providers after FIX (or land-as-progress with residual documented)
4. **#37** terminal last after FIX (or land-as-progress)

Do **not** open replacement PRs for FIX — push commits on the same branches.

## Dry-land integration

| Item | Value |
|------|--------|
| Base | `reorg/structure-cleanup` @ `d369dd1` |
| Branch | `audit/dry-land-20260806-231037` (local only) |
| Worktree | `.worktrees/audit-dry-land-20260806-231037` |
| Combined SHA | `45a6ff2f37bff0e91193e45327876e4cf89cd57d` |
| Merged in order | #31, #34, #30, #35, #32, #36, #33, #29, #28, #37 |
| Conflicts | **none** |
| Unit | `pnpm test` → **pass** (54 files / **306** tests) |
| Typecheck | `tsc --noEmit` → pass (empty output, exit 0) |
| Boundaries | `check:boundaries` → OK (181 files) |
| Style guide | `check:style-guide` → OK (32 rules) |
| E2E | **skip** — live Chrome/provider e2e env not available (headless default; honest skip) |
| Tip advanced? | **no** (dry-land not pushed; product tip unchanged) |

## Code slices (for planpage)

| Feature | Path | Why shown |
|---------|------|-----------|
| domain | `src/features/domain/permissions.ts` | status SSOT + explicit normalize (#31) |
| store | `src/features/store/sessionStore.ts` | free functions own work (#34) |
| providers | `src/features/providers/selectorDrivenProvider.ts` | residual deslop; FIX incomplete elsewhere (#35) |
| conversationCatalog | `src/features/conversationCatalog/conversationSearch.ts` | named ranking phases + tests (#28) |

## Residual mess (not this wave)

- Live provider e2e (ChatGPT/Gemini/Arena smoke)
- Residual CODE-STYLE inside FIX PRs (#35, #37) until same-branch fix
- Promote product tip → GitHub default after land-wave
- Optional `lean-prove` if tip still fat post-land
- CI Gate only fires for PRs targeting `main` — residual stacked PRs lack Actions unit until retarget/#17 lands

## Per-PR blocks (condensed)

### PR #17 — structure-capstone
- branch: `reorg/structure-cleanup` → main
- head: `d369dd1`
- intent: match — flatten internal/, drop factories, ADRs 0019/0020
- deslop: better — structure/ceremony axis
- code_style: nits — residual line ceremony deferred to feature PRs
- tests: suite preserved (302→306 with residuals)
- gates: local verify green; GG; Actions for main-target
- risk: med
- verdict: MERGE
- fix_hint: strip MATRIX trailing `EOF` (done locally)
- slice: browser flat `BrowserSession` vs old manager/internal

### PR #31 — domain
- verdict: MERGE — barrels gone; status-only permission decision

### PR #34 — store
- verdict: MERGE — SessionStore thin handle; posixPath rename

### PR #30 — browser
- verdict: MERGE — named captures; explicit port options

### PR #35 — providers
- verdict: FIX — partial lane; chatgptPage/flow still cold

### PR #32 — bridge
- verdict: MERGE — full residual; zero ?? under bridge

### PR #36 — tools+tunnel
- verdict: MERGE — door imports; TunnelSettle union

### PR #33 — agentGateway
- verdict: MERGE — shared reply helpers

### PR #29 — userConfig
- verdict: MERGE — dual-API removed; module functions

### PR #28 — conversationCatalog
- verdict: MERGE — best business test expansion

### PR #37 — terminal
- verdict: FIX — doors fixed; handle*/cliTypes/?? remain
EOF