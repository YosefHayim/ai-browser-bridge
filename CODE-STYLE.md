# CODE-STYLE.md — ai-browser-bridge

This guide owns how project code is written. `PROJECT.md` owns intent,
`LANGUAGE.md` owns names, `CONTEXT.md` owns system shape, and `AGENTS.md` owns
navigation. The approved rules are the target for coherent migrations; new and
touched code does not add another exception. `code-style.rules.json` mirrors them.

## How to read a rule

| Slot | Meaning |
|------|---------|
| Assertion | The complete rule under review |
| ✓ | The shape new code follows |
| ✗ | The shape new code must not copy |
| verify | A real command, or `judgment` when no honest detector exists |

## Rules

### Biome owns mechanics
[rule:mechanics.biome] · verify: `pnpm check:ci`

Biome is the only formatter and linter, using double quotes, semicolons, trailing commas, two-space indentation, organized imports, and a 100-character line width.

```ts
// ✓ src/features/conversationCatalog/index.ts
import { Schema } from "effect";
export const ConversationIdSchema = Schema.String;

// ✗ competing mechanics
const conversation = { id: "abc" }
```

Why: One mechanical tool keeps reviews about behavior and structure.

### Domain names
[rule:naming.domain] · verify: judgment

Every project-owned identifier names its concrete domain value or action without generic names or avoidable abbreviations.

```ts
// ✓ target: src/features/conversationCatalog/conversationSearch.ts
const rankedConversations = rankConversations(conversations);

// ✗ generic and abbreviated
const result = handleData(ctx);
```

Why: Precise names let the code read as domain prose without explanatory comments.

### Purposeful paths
[rule:naming.paths] · verify: judgment

Authored source paths use camelCase and name the domain concept or exact action without generic buckets or factory, resolver, manager, helper, utility, build, resolve, or to prefixes.

```ts
// ✓ target paths
src/features/bridge/fanout.ts;
src/features/store/fileMentions.ts;

// ✗ vague paths
src/features/bridge/utils/buildResult.ts;
src/features/store/fileResolver.ts;
```

Why: A path should explain ownership before the file is opened.

### Arrow functions
[rule:functions.arrow] · verify: judgment

Project-owned module functions are const arrow functions declared before first use.

```ts
// ✓ target: src/features/conversationCatalog/conversationSearch.ts
const rankConversations = (conversations: ReadonlyArray<Conversation>) => conversations;

// ✗ alternate declaration form
function rankConversations(conversations: ReadonlyArray<Conversation>) {
  return conversations;
}
```

Why: One declaration form makes functions and their ownership predictable.

### Exact inputs
[rule:functions.inputs] · verify: judgment

A function receives only the data it needs, with a cohesive object reserved for a real reusable concept and no positional boolean.

```ts
// ✓ target: src/features/browser/browserState.ts
const browserStatusFor = (debugPort: number) => readBrowserStatus(debugPort);

// ✗ injectable grab bag and positional switch
const getStatus = (options: StatusOptions, verbose: boolean) => options.run(verbose);
```

Why: Narrow inputs expose dependencies and prevent speculative injection seams.

### Explicit branches
[rule:control.explicit] · verify: judgment

Control flow uses early guards for prerequisites, if for two alternatives, and exhaustive switch for closed unions with at least three variants without nested ternaries or fallback operators.

```ts
// ✓ target: src/features/browser/browserState.ts
if (browserState === undefined) return { state: "stopped" };
if (browserState.kind === "attached") return { state: "attached", port: browserState.port };
return { state: "running", port: browserState.port };

// ✗ hidden branches and fallbacks
const state = browserState?.kind ?? (ready || "stopped");
const color = active ? "green" : waiting ? "yellow" : "red";
```

Why: Visible branches make prerequisites and alternatives easy to audit.

### Optional observation
[rule:control.optional-observation] · verify: judgment

Optional chaining observes acceptable absence while a value required by later work is narrowed by an early guard.

```ts
// ✓ target: src/features/providers/chatgpt/chatgptPage.ts
const label = button.getAttribute("aria-label")?.trim();
if (label === undefined) return;
await clickControl(label);

// ✗ required value hidden inside a chain
await panel?.button?.click();
```

Why: Optional reads stay concise without concealing a missing prerequisite.

### Intentional concurrency
[rule:async.intent] · verify: judgment

Independent asynchronous work uses Promise.all, dependent work uses ordered await, and best-effort cleanup uses Promise.allSettled without swallowed failures.

```ts
// ✓ target: src/features/bridge/fanout.ts
const replies = await Promise.all(conversations.map(askConversation));
await Promise.allSettled(openPages.map((page) => page.close()));

// ✗ serialized independent work and silent recovery
for (const conversation of conversations) await askConversation(conversation);
await page.close().catch(() => undefined);
```

Why: The syntax states whether work is parallel, dependent, or best effort.

### Decode once
[rule:types.boundary] · verify: judgment

Unknown boundary data is decoded once by its owning Effect Schema and core code accepts the derived concrete type.

```ts
// ✓ target: src/features/tools/toolsSchemas.ts
export const ReadFileRequestSchema = Schema.Struct({ path: Schema.String });
export type ReadFileRequest = typeof ReadFileRequestSchema.Type;
const readFile = (request: ReadFileRequest) => repositoryFile(request.path);

// ✗ repeated manual narrowing
const readFile = (request: unknown) => {
  if (!isRecord(request) || typeof request.path !== "string") throw new Error("bad input");
};
```

Why: Trust is established at the edge and not re-litigated in core logic.

### Types by role
[rule:types.role] · verify: judgment

Data and union shapes use type aliases while interface is reserved for behavioral contracts with multiple implementations.

```ts
// ✓ target: src/features/providers/browserProvider.ts
type AssistantTurn = { readonly text: string };
interface BrowserProvider {
  readonly ask: (prompt: string) => Promise<AssistantTurn>;
}

// ✗ interface used as a data bag
interface AssistantTurn {
  text: string;
}
```

Why: The declaration form communicates whether a shape is data or behavior.

### Literal finite values
[rule:types.literal-values] · verify: judgment

Finite runtime values are literal data from which Schema and union types derive, never TypeScript enums.

```ts
// ✓ target: src/config.ts
const PROVIDER_IDS = ["chatgpt", "gemini", "arena"] as const;
const ProviderIdSchema = Schema.Literal(...PROVIDER_IDS);
type ProviderId = typeof ProviderIdSchema.Type;

// ✗ second runtime representation
enum ProviderId {
  ChatGpt = "chatgpt",
}
```

Why: Runtime validation and compile-time names stay on one source of truth.

### Readonly public contracts
[rule:types.readonly-contracts] · verify: judgment

Public inputs and domain collections are readonly, exported boundaries declare return types, and local helpers rely on inference.

```ts
// ✓ target: src/features/providers/providers.ts
export const providerFor = (providerId: ProviderId): BrowserProvider => PROVIDERS[providerId];
const providerIds = Object.keys(PROVIDERS);

// ✗ mutable public input with redundant local annotation
export const firstProvider = (providerIds: string[]) => {
  const providerId: string = providerIds[0];
  return providerId;
};
```

Why: Contracts prevent accidental mutation without making local code ceremonial.

### Valid states
[rule:types.valid-states] · verify: judgment

Domain types represent one valid state directly instead of duplicated flags, cached messages, or impossible combinations.

```ts
// ✓ target: src/features/browser/browserState.ts
type BrowserStatus =
  | { readonly state: "stopped" }
  | { readonly state: "running"; readonly port: number }
  | { readonly state: "attached"; readonly port: number };

// ✗ contradictory flags and presentation cache
type BrowserStatus = { running: boolean; attached: boolean; message: string };
```

Why: Consumers derive presentation facts from one authoritative state.

### Absence
[rule:types.absence] · verify: judgment

Internal absence is undefined and null appears only when an external contract requires it.

```ts
// ✓ target: src/features/conversationCatalog/conversationSearch.ts
const conversationFor = (id: string): Conversation | undefined => conversations.get(id);

// ✗ mixed internal sentinels
const conversationFor = (id: string): Conversation | null => conversations.get(id) ?? null;
```

Why: One absence value removes repeated normalization.

### Verified assertions
[rule:types.assertions] · verify: judgment

Assertions are limited to as const, satisfies, or a narrow correction immediately after a runtime proof.

```ts
// ✓ target: src/features/providers/arena/arenaPage.ts
export const arenaProvider = { id: "arena", ask: askArena } satisfies BrowserProvider;

// ✗ unchecked trust
const provider = unknownValue as unknown as BrowserProvider;
```

Why: Assertions document a proven fact instead of bypassing validation.

### Map only differences
[rule:types.wire-mapping] · verify: judgment

A separate wire shape exists only when external field names or structure differ and mapping happens once at that boundary.

```ts
// ✓ target: src/features/agentGateway/askGatewayServer.ts
const gatewayReply = { content: assistantTurn.text };

// ✗ duplicate internal transport layers
const dto = assistantTurnDtoFor(domainAssistantTurnFor(providerReply));
```

Why: Mapping should pay for a real contract difference.

### Translate failures once
[rule:failures.translate-once] · verify: judgment

Expected branches use domain unions, unavoidable failures propagate naturally, and the CLI or MCP boundary translates them once.

```ts
// ✓ target: src/features/terminal/cliOperations.ts
const assistantTurn = await askConversation(request);
writeAssistantTurn(assistantTurn);

// ✗ wrapper errors at every layer
try {
  return await askConversation(request);
} catch (error) {
  throw new AskOperationError("Ask failed", { cause: error });
}
```

Why: Eliminable invalid states need better types, not an error hierarchy.

### Feature doors
[rule:structure.feature-doors] · verify: `pnpm check:boundaries`

Cross-feature imports use the exact @/features/<name> door while imports inside a feature stay relative.

```ts
// ✓ src/features/bridge/bridgeEngine.ts
import { BrowserSession } from "@/features/browser";
import { Orchestrator } from "./orchestrator.ts";

// ✗ another feature's implementation
import { BrowserSession } from "@/features/browser/browserSession.ts";
```

Why: The door is the dependency contract and the feature owns everything behind it.

### Cohesive modules
[rule:structure.cohesive-modules] · verify: judgment

A file owns one cohesive job, splits only at a different reason to change, and never exists only as one-call forwarding ceremony.

```ts
// ✓ target: src/features/tools/mcpServer.ts
export const repositoryTools = [readFileTool, grepRepositoryTool, applyPatchTool];

// ✗ one wrapper per file
export const runReadFile = (request: ReadFileRequest) => readFile(request);
```

Why: Deep modules concentrate policy while shallow files only add navigation.

### Explicit module surfaces
[rule:modules.exports] · verify: judgment

Modules use named exports, doors list explicit public names, and imports use direct names without aliases or namespaces.

```ts
// ✓ target: src/features/providers/index.ts
export { providerFor, providerIds } from "./providers";
import { providerFor, type ProviderId } from "@/features/providers";

// ✗ wildcard, alias, and namespace surfaces
export * from "./providers";
import * as Providers from "@/features/providers";
import { providerFor as getProvider } from "@/features/providers";
```

Why: Every public name is searchable and has one spelling.

### Provider adapters
[rule:providers.adapters] · verify: judgment

Provider adapters are plain objects satisfying BrowserProvider and classes are reserved for mutable lifecycle state.

```ts
// ✓ target: src/features/providers/arena/arenaPage.ts
export const arenaProvider = {
  ask: askArena,
  listModels: listArenaModels,
} satisfies BrowserProvider;

// ✗ stateless method forwarding
export class ArenaPage {
  ask(prompt: string) {
    return askArena(prompt);
  }
}
```

Why: An adapter needs capabilities, not object ceremony.

### One state owner
[rule:state.single-owner] · verify: judgment

Mutable state has one owner and consumers derive presentation facts instead of storing duplicate flags or messages.

```ts
// ✓ target: src/features/browser/browserState.ts
const canAttach = browserStatus.state === "running";

// ✗ duplicated derived state
const status = { state: "running", canAttach: true, message: "Chrome is running" };
```

Why: Derived copies drift when a transition updates only one field.

### Named collection phases
[rule:collections.named-phases] · verify: judgment

Multi-stage collection logic uses explicit named phases and simple one-step projections may use map or filter.

```ts
// ✓ target: src/features/conversationCatalog/conversationSearch.ts
const candidates = [];
for (const conversation of conversations) {
  if (!matchesQuery(conversation, query)) continue;
  candidates.push(scoreConversation(conversation, query));
}
candidates.sort(compareConversationScores);

// ✗ hidden ranking pipeline
const result = conversations.filter(matches).map(score).sort(compare);
```

Why: Branching, scoring, ordering, and ties are separate decisions.

### Presentation stays at the edge
[rule:presentation.edge] · verify: judgment

Feature operations return domain values while CLI and TUI edges own output, exit codes, and presentation without console monkeypatching.

```ts
// ✓ target: src/features/terminal/cliOperations.ts
const browserStatus = await readBrowserStatus();
writeBrowserStatus(browserStatus);

// ✗ core output side effect
const readBrowserStatus = async () => console.log("Chrome is running");
```

Why: One operation can serve human, JSON, TUI, and MCP presentations.

### Fail closed
[rule:security.fail-closed] · verify: judgment

MCP and process boundaries decode schemas, confine paths, spawn fixed argument arrays without a shell, and reject invalid requests before core work.

```ts
// ✓ target: src/features/tools/mcpServer.ts
const testRequest = decodeTestRequest(unknownRequest);
const repositoryPath = ensurePathInsideRepo(testRequest.path);
await spawnTestRunner("pnpm", ["test", repositoryPath]);

// ✗ string-built shell command
await exec("pnpm test " + unknownRequest.path);
```

Why: Validation must happen before any local capability receives control.

### Documentation is last
[rule:documentation.last-resort] · verify: judgment

Comments and TSDoc appear only for an external quirk, safety invariant, non-obvious contract, or irreducible reason that names and types cannot express.

```ts
// ✓ src/features/providers/flow/flowPage.ts
// Flow exposes clips only inside a project editor.
const enterFlowProject = async () => openFirstProject();

// ✗ narration and placeholder API docs
/** Gets the result. */
const getResult = async () => {
  // Call the API.
  return callApi();
};
```

Why: Renaming and restructuring are preferred because comments can lie.

### Named regex captures
[rule:regex.named-captures] · verify: judgment

Regex captures are named and replacement code refers to those names instead of positional capture indexes.

```ts
// ✓ target: src/features/store/fileMentions.ts
const FILE_MENTION = /@(?<path>[^\s]+)/u;
const mentionedPath = FILE_MENTION.exec(prompt)?.groups?.path;

// ✗ positional capture contract
const mentionedPath = /@([^\s]+)/u.exec(prompt)?.[1];
```

Why: The capture name carries the raw shape without a compensating comment.

### Behavior tests
[rule:tests.behavior] · verify: judgment

Tests are colocated, name behavior as scenarios, assert all relevant outcomes, and mock only browser, filesystem, process, network, or other external boundaries.

```ts
// ✓ target: src/features/providers/providers.test.ts
it("returns every configured provider exactly once", () => {
  expect(providerIds).toEqual(configuredProviderIds);
  expect(new Set(providerIds).size).toBe(providerIds.length);
});

// ✗ implementation snapshot
it("works", () => {
  expect(providerFor("arena")).toMatchSnapshot();
});
```

Why: Tests protect observable contracts without freezing implementation noise.

### Shared CLI operations
[rule:cli.shared-operations] · verify: judgment

TTY and headless commands call the same operation, Commander actions return their Promise, and operation closures decode their own concrete options.

```ts
// ✓ target: src/features/terminal/cliOperations.ts
askCommand.action(async (prompt, commandOptions) => {
  const askRequest = decodeAskRequest({ prompt, commandOptions });
  return runAskCommand(askRequest);
});

// ✗ floating generic dispatcher
askCommand.action((...args: unknown[]) => void handleCommand(args, runAsk));
```

Why: Lifecycle and validation stay explicit without injectable dispatch machinery.

### Tool-first scripts
[rule:tooling.direct-scripts] · verify: judgment

Maintained scripts exist only for repository-specific checks or browser reconnaissance that installed tools cannot perform directly.

```ts
// ✓ package.json
"typecheck": "tsc --noEmit";

// ✗ wrapper with no repository policy
"typecheck": "node scripts/runTypecheck.mjs";
```

Why: Installed tools already own their command lifecycle and diagnostics.

### No compatibility layer
[rule:compatibility.none] · verify: `pnpm check:no-compatibility`

Backward-compatibility exports, variables, aliases, import paths, and deprecated names are deleted in the same change that updates their callers.

```ts
// ✓ target rename
export { fanOutConversations } from "./fanout";

// ✗ old name retained beside the canonical one
export const fanOut = fanOutConversations;
```

Why: This CLI has no protected internal API that justifies two names for one concept.

### Earned dependencies
[rule:dependencies.earned] · verify: `pnpm install --frozen-lockfile`

Stable dependencies use caret major ranges with one committed pnpm lockfile and each dependency owns one concrete job.

```ts
// ✓ package.json
"effect": "^3.21.4";

// ✗ duplicate runtime frameworks for the same job
"@effect/platform-node": "^0.107.0";
```

Why: The lockfile provides reproducibility while the manifest permits compatible fixes.

## Canonical example

The target Arena slice composes the rules on a Provider with bespoke behavior.
It is illustrative until the structural capstone lands the files.

```ts
// src/config.ts
import { Schema } from "effect";

const PROVIDER_IDS = ["chatgpt", "gemini", "arena"] as const;
export const ProviderIdSchema = Schema.Literal(...PROVIDER_IDS);
export type ProviderId = typeof ProviderIdSchema.Type;

export const PROVIDER_CONFIG = {
  arena: {
    displayName: "Arena",
    origin: "arena.ai",
    defaultUrl: "https://arena.ai/code/direct",
    selectors: {
      composer: 'textarea[name="message"], [contenteditable="true"]',
      assistant: "div.rounded-xl .prose",
    },
  },
} as const;

// src/features/providers/arena/arenaPage.ts
import { PROVIDER_CONFIG } from "@/config";
import { askArena } from "./askArena";
import { listArenaModels } from "./arenaModels";
import type { BrowserProvider } from "../browserProvider";

export const arenaProvider = {
  id: "arena",
  config: PROVIDER_CONFIG.arena,
  ask: askArena,
  listModels: listArenaModels,
} satisfies BrowserProvider;

// src/features/providers/providers.ts
import { arenaProvider } from "./arena/provider";
import type { BrowserProvider, ProviderId } from "./browserProvider";

const PROVIDERS = {
  arena: arenaProvider,
} satisfies Record<ProviderId, BrowserProvider>;

export const providerIds = Object.keys(PROVIDERS) as ReadonlyArray<ProviderId>;
export const providerFor = (providerId: ProviderId): BrowserProvider => PROVIDERS[providerId];
```

## Golden path — adding a Provider

See the [canonical Arena example](#canonical-example) while following this path.

1. Add the Provider's metadata, selectors, and defaults once in `src/config.ts`; derive its ID and Schema from that table.
2. Use `selectorDrivenProvider(providerId)` when selectors are sufficient; create a Provider folder only for real bespoke behavior.
3. Export explicit public names from `src/features/providers/index.ts` and register the adapter exhaustively in `src/features/providers/providers.ts`.
4. Add focused colocated tests that mock only the browser boundary and prove the registry contains every configured Provider exactly once.
5. Add CLI or MCP surface only for unique Provider behavior, decode its concrete request at the edge, and route every presentation to the same operation.
6. Update only the owning documentation: README for public use, PROJECT for direction, CONTEXT for system shape, LANGUAGE for canonical names, or an ADR for a durable decision.
7. Run focused tests, `pnpm verify`, any live selector check under `scripts/dev/`, and a final diff audit for slop or unrelated churn.

### Definition of done

- [ ] The Provider appears once in config, once in behavior, and once in the exhaustive registry.
- [ ] The adapter is the smallest shape its behavior earns, with no stateless class, bind call, forwarding file, or one-file folder.
- [ ] Unknown input is decoded at the boundary and internal functions receive concrete domain types.
- [ ] Tests cover behavior and registry exhaustiveness, and live UI behavior is verified when selectors changed.
- [ ] Names are domain-specific and the diff adds no fallback operators, nested ternaries, silent catches, duplicated state, narration comments, or compatibility names.
- [ ] Only documentation whose truth changed is edited, `pnpm verify` passes, and the final diff has no unrelated or generated churn.

## Exemplars

- No current source file qualifies without caveat; that is an explicit migration finding.
- `src/config.ts` is the target data and boundary exemplar after the approved config move.
- `src/features/providers/providers.ts` is the target exhaustive registry exemplar.
- `src/features/providers/arena/arenaPage.ts` is the first target bespoke Provider exemplar.
- `src/features/bridge/fanout.ts` is the target orchestration exemplar.

## Never

- `data`, `result`, `row`, `outcome`, `temp`, `final`, `manager`, `helper`, `args`, `opts`, `ctx`, `req`, `res`, `err`, or `proc` when a domain name exists [rule:naming.domain].
- `resolve*`, `build*`, `to*`, factory, resolver, manager, helper, utils, or common names for project-owned functions, files, or folders [rule:naming.paths].
- Named function declarations, injected runner functions, positional booleans, or grab-bag options objects [rule:functions.arrow] [rule:functions.inputs].
- `??` or `||` fallbacks, nested ternaries, and required values hidden behind optional chains [rule:control.explicit] [rule:control.optional-observation].
- Empty catches or `.catch(() => false | null | undefined | "" | 0 | [] | {})` [rule:async.intent].
- `isRecord` ladders after a boundary, broad assertions, double assertions, or TypeScript enums [rule:types.boundary] [rule:types.assertions] [rule:types.literal-values].
- Application error classes for states a Schema or domain union can eliminate [rule:failures.translate-once].
- Generic `internal/` buckets, one-call forwarding files, one-function folders, and stateless service classes [rule:structure.cohesive-modules] [rule:providers.adapters].
- Wildcard doors, default exports, import aliases, namespace imports, and old names retained beside new ones [rule:modules.exports] [rule:compatibility.none].
- Stored `canAttach`, `displayMessage`, or equivalent values derived from another state field [rule:state.single-owner].
- Chained collection pipelines that hide branching, scoring, ordering, or tie handling [rule:collections.named-phases].
- `console.*` in feature code, global console replacement, process exit below the CLI edge, or feature operations that print [rule:presentation.edge].
- Raw shell execution, unchecked paths, user-built argument strings, or permissive boundary fallbacks [rule:security.fail-closed].
- Placeholder TSDoc, narration comments, snapshot tests, fixture frameworks, and mocks of project-owned logic [rule:documentation.last-resort] [rule:tests.behavior].
- `match?.[1]`, numbered replacement captures, or comments compensating for positional regex groups [rule:regex.named-captures].
- `void` Commander actions, `unknown[]` dispatch, `.at(-1)` argument recovery, and generic command handlers [rule:cli.shared-operations].

## Recipes

### Add a CLI command

1. Put the domain operation in its owning feature and return a domain value.
2. Register one concrete Commander closure that decodes its own options and returns its Promise.
3. Route the matching TUI command to the same operation.
4. Keep human formatting, JSON formatting, diagnostics, and exit codes in the terminal edge.

### Change Provider selectors

1. Edit the single Provider config entry.
2. Run the relevant `scripts/dev/capture*Selectors.mjs` check against a signed-in browser.
3. Update adapter code only when the UI changed behavior, not merely selector data.
4. Record an external quirk comment only when the selector itself cannot explain the constraint.

### Add an MCP Tool

1. Define the request Schema beside the Tool group that owns it.
2. Decode once, confine any path, and pass a concrete request to the domain operation.
3. Register the Tool explicitly in `src/features/tools/registry.ts`.
4. Translate rejection once at the MCP boundary and test invalid input plus successful behavior.

## Verification

```bash
pnpm verify
```

The style-guide checker validates this file against `code-style.rules.json`; Biome
owns mechanics, the boundary and compatibility checks own the narrow rules they can
prove, and `judgment` rules are reviewed against the touched diff.
