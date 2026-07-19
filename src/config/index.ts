/**
 * Shared config leaf — provider metadata, defaults, and env-backed runtime knobs.
 *
 * One module: Effect Schema validates static tables at load; Effect.Config resolves
 * env overrides. Features import from `@/config`; this module never imports features.
 */
import { Config, Schema } from "effect";

// ---------------------------------------------------------------------------
// Static SCREAMING_CASE tunables (prologue — boundary gate)
// ---------------------------------------------------------------------------

/** Default MCP server listen port. */
export const DEFAULT_MCP_PORT = 8765;

/** Default context window when model is unknown. */
export const DEFAULT_CONTEXT_LIMIT = 128_000;

/** Default permission mode for tool execution. */
export const DEFAULT_PERMISSION_MODE = "auto" as const;

/** Default ask timeout in seconds (headless). */
export const DEFAULT_ASK_TIMEOUT_SECONDS = 300;

/**
 * Milliseconds a render may make no visible progress before the wait loop reloads
 * the tab. Progress resets the clock so a streaming long render is not interrupted.
 */
export const RENDER_STALL_RELOAD_MS = 180_000;

/** Maximum tab reloads a single wait may trigger before falling through to timeout. */
export const MAX_STALL_RELOADS = 2;

/** Provider used when a command specifies none. */
export const DEFAULT_PROVIDER = "chatgpt" as const;

// ---------------------------------------------------------------------------
// Provider surface schemas
// ---------------------------------------------------------------------------

/** DOM selectors for a web-chat provider's core surface. */
export const ProviderSelectorsSchema = Schema.Struct({
  /** Composer input (contenteditable or textarea). */
  composer: Schema.String,
  /** Container for a single assistant message; the last match is the latest reply. */
  assistant: Schema.String,
  /** Container for a single user message (optional; enables full transcript capture). */
  user: Schema.optional(Schema.String),
  /** Stop-generating control (optional). */
  stop: Schema.optional(Schema.String),
  /** Send-message button; clicked when set and visible, otherwise Enter (optional). */
  send: Schema.optional(Schema.String),
  /** Button that starts a new conversation (optional; falls back to home navigation). */
  newChat: Schema.optional(Schema.String),
  /** A conversation link in the history sidebar (optional; enables history listing). */
  sidebarItem: Schema.optional(Schema.String),
  /** Button opening the model picker; its visible text is the current model (optional). */
  modelTrigger: Schema.optional(Schema.String),
  /** Model option items inside the open picker (optional; enables model switching). */
  modelOption: Schema.optional(Schema.String),
  /** File input for attaching local files to the prompt (optional). */
  attach: Schema.optional(Schema.String),
  /** Element whose presence means "not signed in" (optional). */
  signedOut: Schema.optional(Schema.String),
});

/** Static metadata + core selectors for one browser provider. */
export const ProviderConfigEntrySchema = Schema.Struct({
  /** Human-readable name for CLI/TUI and logs. */
  displayName: Schema.String,
  /** Whether MCP connector setup is supported (ChatGPT, Claude, and Grok today). */
  supportsMcpConnector: Schema.Boolean,
  /** Origin hostname used to locate an existing tab. */
  origin: Schema.String,
  /** URL opened when no provider tab exists. */
  defaultUrl: Schema.String,
  /** Fallback model label before detection runs. */
  defaultModel: Schema.String,
  /** Core DOM selectors (composer + assistant, plus optional extras). */
  selectors: ProviderSelectorsSchema,
});

/**
 * Full provider table schema — explicit keys so `BridgeProviderId` stays exact.
 * Adding a provider is one key here, one entry in the raw table below, plus (for a
 * bespoke DOM) a `*Page` class. Optional selectors are the live-verified affordances
 * the generic adapter un-stubs; capture with `captureProviderSelectors.mjs`.
 */
export const ProviderConfigTableSchema = Schema.Struct({
  chatgpt: ProviderConfigEntrySchema,
  gemini: ProviderConfigEntrySchema,
  claude: ProviderConfigEntrySchema,
  deepseek: ProviderConfigEntrySchema,
  grok: ProviderConfigEntrySchema,
  perplexity: ProviderConfigEntrySchema,
  flow: ProviderConfigEntrySchema,
  duck: ProviderConfigEntrySchema,
  arena: ProviderConfigEntrySchema,
});

export type ProviderSelectors = Schema.Schema.Type<typeof ProviderSelectorsSchema>;
export type ProviderConfigEntry = Schema.Schema.Type<typeof ProviderConfigEntrySchema>;
export type ProviderConfigTable = Schema.Schema.Type<typeof ProviderConfigTableSchema>;

/** Decode-or-throw helper for static tables (fails fast at module load). */
const parseConfig = <A, I>(schema: Schema.Schema<A, I>, input: unknown): A =>
  Schema.decodeUnknownSync(schema)(input);

/**
 * Single source of truth for supported web-chat providers, keyed by id.
 * CLI `--provider`, `bridge chrome start`, and adapters all derive from this table.
 */
export const PROVIDER_CONFIG: ProviderConfigTable = parseConfig(ProviderConfigTableSchema, {
  chatgpt: {
    displayName: "ChatGPT",
    supportsMcpConnector: true,
    origin: "chatgpt.com",
    defaultUrl: "https://chatgpt.com",
    defaultModel: "ChatGPT",
    selectors: {
      composer: '#prompt-textarea, [contenteditable="true"]',
      assistant: '[data-message-author-role="assistant"]',
    },
  },
  gemini: {
    displayName: "Gemini",
    supportsMcpConnector: false,
    origin: "gemini.google.com",
    defaultUrl: "https://gemini.google.com/app",
    defaultModel: "Gemini",
    selectors: {
      composer: 'div.ql-editor, [contenteditable="true"]',
      assistant: "model-response, message-content, .model-response-text, .response-content",
    },
  },
  claude: {
    displayName: "Claude",
    supportsMcpConnector: true,
    origin: "claude.ai",
    defaultUrl: "https://claude.ai/new",
    defaultModel: "Claude",
    selectors: {
      composer: '[data-testid="chat-input"], div[contenteditable="true"]',
      assistant: ".standard-markdown",
      user: '[data-testid="user-message"]',
      stop: 'button[aria-label="Stop response"]',
      send: 'button[aria-label="Send message"]',
      newChat: 'a[aria-label="New chat"]',
      sidebarItem: 'nav a[href*="/chat/"]',
      modelTrigger: '[data-testid="model-selector-dropdown"]',
      modelOption: '[role="menuitem"], [role="menuitemradio"]',
      attach: 'input[data-testid="file-upload"]',
      signedOut: 'a[href*="/login"]',
    },
  },
  deepseek: {
    displayName: "DeepSeek",
    supportsMcpConnector: false,
    origin: "chat.deepseek.com",
    defaultUrl: "https://chat.deepseek.com/",
    defaultModel: "DeepSeek",
    selectors: {
      composer: "textarea#chat-input, textarea",
      assistant: ".ds-markdown",
      stop: 'div[role="button"][aria-label*="Stop"]',
      sidebarItem: 'a[href*="/a/chat/s/"]',
      attach: 'input[type="file"]',
      signedOut: 'button:has-text("Log in")',
    },
  },
  grok: {
    displayName: "Grok",
    supportsMcpConnector: true,
    origin: "grok.com",
    defaultUrl: "https://grok.com/",
    defaultModel: "Grok",
    selectors: {
      composer: '[aria-label="Ask Grok anything"], div.tiptap.ProseMirror, textarea',
      assistant: '[class*="message-bubble"]',
      stop: 'button[aria-label*="Stop"]',
      newChat: '[data-testid="new-chat"]',
      sidebarItem: 'a[href*="/c/"]',
      modelTrigger: 'button[aria-label="Model select"]',
      modelOption: '[role="menuitem"], [role="menuitemradio"]',
      attach: 'input[type="file"]',
      signedOut: 'button:has-text("Sign in")',
    },
  },
  perplexity: {
    displayName: "Perplexity",
    supportsMcpConnector: false,
    origin: "perplexity.ai",
    defaultUrl: "https://www.perplexity.ai/",
    defaultModel: "Perplexity",
    selectors: {
      composer: '#ask-input, textarea, div[contenteditable="true"]',
      assistant: ".prose",
      stop: 'button[aria-label*="Stop"]',
      send: 'button[aria-label="Submit"]',
      sidebarItem: 'a[href*="/search/"]',
      modelTrigger: 'button[aria-label="Model"]',
      modelOption: '[role="menuitem"], [role="menuitemradio"]',
      attach: 'input[type="file"]',
      signedOut: 'button:has-text("Sign Up")',
    },
  },
  flow: {
    // Google Labs Flow is a Veo video studio, not a text chat: a "reply" is a
    // rendered clip and "attach" uploads ingredients (reference images). It has no
    // connector UI, so supportsMcpConnector is false (MCP server + tunnel are
    // skipped, like Gemini). Selectors LIVE-VERIFIED (2026-07-13) against a
    // signed-in Flow project editor with captureProviderSelectors.mjs.
    displayName: "Flow",
    supportsMcpConnector: false,
    origin: "labs.google",
    defaultUrl: "https://labs.google/fx/tools/flow",
    defaultModel: "Veo 3.1",
    selectors: {
      composer: '[data-slate-editor="true"], [role="textbox"][contenteditable="true"]',
      assistant: "video",
      stop: 'button[aria-label*="Cancel" i], button[aria-label*="Stop" i]',
      send: 'button:has-text("Create"):not([aria-haspopup])',
      newChat: 'button:has-text("New project")',
      sidebarItem: 'a[href*="/tools/flow/project"]',
      modelTrigger: 'button:has-text("Settings"), button:has-text("Veo")',
      modelOption: '[role="menuitem"], [role="menuitemradio"], [role="option"]',
      attach: 'input[type="file"][accept*="image" i], input[type="file"]',
      signedOut: 'a[href*="accounts.google.com"], button:has-text("Sign in")',
    },
  },
  duck: {
    // Duck.ai LIVE-VERIFIED (2026-07-19): composer textarea[name=user-prompt] /
    // data-testid=duckai-chat-input; Ask submit; Stop generating; user-message;
    // assistant ids *-assistant-message-* (not heading-*); streaming placeholder
    // "Generating response". No account; no MCP connector.
    displayName: "Duck.ai",
    supportsMcpConnector: false,
    origin: "duck.ai",
    defaultUrl: "https://duck.ai/chat",
    defaultModel: "Duck.ai",
    selectors: {
      composer: 'textarea[name="user-prompt"], [data-testid="duckai-chat-input"] textarea',
      assistant: 'div[id*="-assistant-message-"]:not([id^="heading-"])',
      user: '[data-testid="user-message"]',
      stop: 'button[aria-label="Stop generating"]',
      send: 'button[aria-label="Ask"]',
      newChat: 'button:has-text("New Chat")',
      modelTrigger: '[data-testid="model-picker-button"]',
      modelOption: '[role="menuitem"], [role="menuitemradio"], [role="option"]',
      attach: 'input[name="upload"], input[type="file"]',
    },
  },
  arena: {
    // Arena.ai modes + model picker LIVE-VERIFIED (2026-07-19). Default Direct
    // (/code/direct). Modes: battle / agent / side-by-side / direct. Adapter:
    // providers/arena/.
    displayName: "Arena",
    supportsMcpConnector: false,
    origin: "arena.ai",
    defaultUrl: "https://arena.ai/code/direct",
    defaultModel: "Max",
    selectors: {
      composer: 'textarea[name="message"], [contenteditable="true"]',
      assistant: "div.rounded-xl .prose",
      user: ".bg-surface-raised .prose, .self-end .prose",
      send: 'button[aria-label="Send message"]',
      newChat: 'a[href="/code"], a[href*="/direct"]',
      sidebarItem: 'a[href*="/c/"]',
      modelTrigger: 'button:has-text("Max")',
      modelOption: '[role="option"]',
      attach: 'input[type="file"]',
    },
  },
});

/** Supported provider id — derived from the config table keys. */
export type BridgeProviderId = keyof typeof PROVIDER_CONFIG;

/** All supported provider ids, in config order. */
export const PROVIDER_IDS = Object.keys(PROVIDER_CONFIG) as BridgeProviderId[];

/** Schema for a supported provider id (stays in sync with `PROVIDER_CONFIG` keys). */
export const BridgeProviderIdSchema = Schema.Literal(
  ...(PROVIDER_IDS as [BridgeProviderId, ...BridgeProviderId[]]),
);

/** Human-typed aliases mapped to canonical ids. */
export const PROVIDER_ALIASES: Readonly<Record<string, BridgeProviderId>> = parseConfig(
  Schema.Record({ key: Schema.String, value: BridgeProviderIdSchema }),
  {
    gpt: "chatgpt",
    "chat-gpt": "chatgpt",
    bard: "gemini",
    "claude.ai": "claude",
    anthropic: "claude",
    x: "grok",
    ppl: "perplexity",
    veo: "flow",
    "google-flow": "flow",
    duckduckgo: "duck",
    ddg: "duck",
    "duck.ai": "duck",
    lmsys: "arena",
    "arena.ai": "arena",
    "chatbot-arena": "arena",
  },
);

// ---------------------------------------------------------------------------
// Defaults (Schema-validated bundle of the prologue tunables)
// ---------------------------------------------------------------------------

/** Tunable defaults used across CLI, MCP, and wait loops. */
export const DefaultsSchema = Schema.Struct({
  mcpPort: Schema.Number.pipe(Schema.int(), Schema.positive()),
  contextLimit: Schema.Number.pipe(Schema.int(), Schema.positive()),
  permissionMode: Schema.Literal("read-only", "ask", "auto"),
  askTimeoutSeconds: Schema.Number.pipe(Schema.int(), Schema.positive()),
  renderStallReloadMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
  maxStallReloads: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  defaultProvider: BridgeProviderIdSchema,
});

export type Defaults = Schema.Schema.Type<typeof DefaultsSchema>;

/** Parsed static defaults (fail-fast at module load if a tunable is invalid). */
export const DEFAULTS: Defaults = parseConfig(DefaultsSchema, {
  mcpPort: DEFAULT_MCP_PORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
  permissionMode: DEFAULT_PERMISSION_MODE,
  askTimeoutSeconds: DEFAULT_ASK_TIMEOUT_SECONDS,
  renderStallReloadMs: RENDER_STALL_RELOAD_MS,
  maxStallReloads: MAX_STALL_RELOADS,
  defaultProvider: DEFAULT_PROVIDER,
});

// ---------------------------------------------------------------------------
// Runtime env config (Effect.Config)
// ---------------------------------------------------------------------------

/**
 * Repo root path, resolved from `BRIDGE_REPO_PATH` env var.
 * @returns The configured repo path or the current working directory.
 */
export const RepoPathConfig = Config.string("BRIDGE_REPO_PATH").pipe(
  Config.withDefault(process.cwd()),
);

/**
 * MCP server listen port, resolved from `BRIDGE_MCP_PORT` env var.
 * @returns The configured port or {@link DEFAULT_MCP_PORT}.
 */
export const McpPortConfig = Config.integer("BRIDGE_MCP_PORT").pipe(
  Config.withDefault(DEFAULT_MCP_PORT),
);

/**
 * Active provider id, resolved from `BRIDGE_PROVIDER` env var.
 * @returns The configured provider or {@link DEFAULT_PROVIDER}.
 */
export const ProviderConfig = Config.string("BRIDGE_PROVIDER").pipe(
  Config.withDefault(DEFAULT_PROVIDER),
);
