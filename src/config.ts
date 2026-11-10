import { z } from "zod";

/** Default MCP server listen port. */
export const DEFAULT_MCP_PORT = 8765;

/** Repo-local directory that owns all persistent bridge state and downloads. */
export const REPO_DIRECTORY_NAME = ".bridge";

/** Machine-global directory for shared browser state and user configuration. */
export const BRIDGE_DIRECTORY_NAME = ".ai-browser-bridge";

/** Default context window when model is unknown. */
export const DEFAULT_TOKEN_LIMIT = 128_000;

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

/** All supported provider ids, in config order. Each id needs an entry in `PROVIDER_CONFIG`. */
export const PROVIDER_IDS = [
  "chatgpt",
  "gemini",
  "claude",
  "deepseek",
  "grok",
  "perplexity",
  "flow",
  "duck",
  "arena",
  "design",
] as const;

/** Supported provider id, derived from `PROVIDER_IDS`. */
export type BridgeProviderId = (typeof PROVIDER_IDS)[number];

/** Schema for a supported provider id. */
const BridgeProviderIdSchema = z.enum(PROVIDER_IDS);

/** DOM selectors for a web-chat provider's core surface. */
const ProviderSelectorsSchema = z.object({
  /** Composer input (contenteditable or textarea). */
  composer: z.string(),
  /** Container for a single assistant message; the last match is the latest reply. */
  assistant: z.string(),
  /** Container for a single user message (optional; enables full transcript capture). */
  user: z.string().optional(),
  /** Stop-generating control (optional). */
  stop: z.string().optional(),
  /** Send-message button; clicked when set and visible, otherwise Enter (optional). */
  send: z.string().optional(),
  /** Button that starts a new conversation (optional; falls back to home navigation). */
  newChat: z.string().optional(),
  /** A conversation link in the history sidebar (optional; enables history listing). */
  sidebarItem: z.string().optional(),
  /** Button opening the model picker; its visible text is the current model (optional). */
  modelTrigger: z.string().optional(),
  /** Model option items inside the open picker (optional; enables model switching). */
  modelOption: z.string().optional(),
  /** File input for attaching local files to the prompt (optional). */
  attach: z.string().optional(),
  /** Element whose presence means "not signed in" (optional). */
  signedOut: z.string().optional(),
});

/** Static metadata + core selectors for one browser provider. */
const ProviderSettingsLineSchema = z.object({
  /** Human-readable name for CLI/TUI and logs. */
  displayName: z.string(),
  /** Whether MCP connector setup is supported (ChatGPT, Claude, and Grok today). */
  supportsMcpConnector: z.boolean(),
  /** Origin hostname used to locate an existing tab. */
  origin: z.string(),
  /** Path under `origin` that this provider owns when it shares a hostname (optional). */
  pathPrefix: z.string().optional(),
  /** URL opened when no provider tab exists. */
  defaultUrl: z.string(),
  /** Fallback model label before detection runs. */
  defaultModel: z.string(),
  /** Core DOM selectors (composer + assistant, plus optional extras). */
  selectors: ProviderSelectorsSchema,
});

/**
 * Full provider table schema — explicit keys so `BridgeProviderId` stays exact.
 * Adding a provider is one key here, one entry in the raw table below, plus (for a
 * bespoke DOM) a `*Page` class. Optional selectors are the live-verified affordances
 * the generic adapter un-stubs; capture with `captureProviderSelectors.mjs`.
 */
const ProviderSettingsTableSchema = z.record(BridgeProviderIdSchema, ProviderSettingsLineSchema);

export type ProviderSettingsTable = z.infer<typeof ProviderSettingsTableSchema>;

const parseSettings = <Parsed>(schema: z.ZodType<Parsed>, unparsedSettings: unknown): Parsed =>
  schema.parse(unparsedSettings);

/**
 * Single source of truth for supported web-chat providers, keyed by id.
 * CLI `--provider`, `bridge chrome start`, and adapters all derive from this table.
 */
export const PROVIDER_SETTINGS: ProviderSettingsTable = parseSettings(ProviderSettingsTableSchema, {
  chatgpt: {
    displayName: "ChatGPT",
    supportsMcpConnector: true,
    origin: "chatgpt.com",
    defaultUrl: "https://chatgpt.com",
    defaultModel: "ChatGPT",
    selectors: {
      composer: [
        'div.ProseMirror[contenteditable="true"][aria-label="Ask ChatGPT"]',
        '[data-testid="prompt-textarea"]',
        "#prompt-textarea",
        'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
        'form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]',
      ].join(", "),
      assistant:
        '[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]',
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
  design: {
    // Claude Design LIVE-VERIFIED (2026-10-02). Shares claude.ai with `claude`, so
    // `pathPrefix` decides tab ownership. Adapter: providers/design/.
    displayName: "Claude Design",
    supportsMcpConnector: false,
    origin: "claude.ai",
    pathPrefix: "/design",
    defaultUrl: "https://claude.ai/design",
    defaultModel: "Claude Design",
    selectors: {
      composer: '[data-testid="home-composer-input"], [data-testid="chat-composer-input"]',
      assistant: '[data-testid="chat-messages"]',
      stop: '[data-testid="pill-stop-button"]',
      send: '[data-testid="home-composer-send"], [data-testid="chat-send-button"]',
      modelTrigger: '[data-testid="model-selector-button"]',
      modelOption: '[role="menuitemradio"]',
    },
  },
});
