/**
 * Single source of truth for supported web-chat providers, keyed by id.
 * The provider id type, the CLI `--provider` help, `bridge chrome start`, and the browser
 * adapters all derive from this table. Adding a provider is one entry here plus (for a
 * bespoke DOM) a `*Page` class — the registry binds behavior, never redeclares metadata.
 *
 * Optional functional selectors (newChat / sidebarItem / modelTrigger / attach) are the
 * live-verified affordances the generic adapter un-stubs per provider; capture them with
 * `src/scripts/dev/captureProviderSelectors.mjs` against the real signed-in DOM.
 */
export const PROVIDER_CONFIG = {
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
    // skipped, like Gemini). Selectors below were LIVE-VERIFIED (2026-07-13) against a
    // signed-in Flow project editor with captureProviderSelectors.mjs: the composer is
    // a Slate editor (data-slate-editor), the submit is the "Create" button that is not
    // a menu (no aria-haspopup), clips are <video> tiles, and ingredients upload through
    // an image file input. The generating/stop state is the one piece still LIVE-VERIFY
    // (needs a running render to observe). Access requires a Google AI Pro/Ultra plan.
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
} satisfies Record<string, ProviderConfigEntry>;

/** Provider used when a command specifies none. */
export const DEFAULT_PROVIDER: BridgeProviderId = "chatgpt";

/** Human-typed aliases mapped to canonical ids. */
export const PROVIDER_ALIASES: Record<string, BridgeProviderId> = {
  gpt: "chatgpt",
  "chat-gpt": "chatgpt",
  bard: "gemini",
  "claude.ai": "claude",
  anthropic: "claude",
  x: "grok",
  ppl: "perplexity",
  veo: "flow",
  "google-flow": "flow",
};

/** All supported provider ids, in config order. */
export const PROVIDER_IDS = Object.keys(PROVIDER_CONFIG) as BridgeProviderId[];

/** Supported provider id — derived from the config keys (the single source of truth). */
export type BridgeProviderId = keyof typeof PROVIDER_CONFIG;

/** DOM selectors describing a web-chat provider's core surface. */
export interface ProviderSelectors {
  /** Composer input (contenteditable or textarea). */
  composer: string;
  /** Container for a single assistant message; the last match is the latest reply. */
  assistant: string;
  /** Container for a single user message (optional; enables full transcript capture). */
  user?: string;
  /** Stop-generating control (optional). */
  stop?: string;
  /** Send-message button; clicked when set and visible, otherwise Enter is pressed (optional). */
  send?: string;
  /** Button that starts a new conversation (optional; falls back to navigating home). */
  newChat?: string;
  /** A conversation link in the history sidebar (optional; enables history listing). */
  sidebarItem?: string;
  /** Button opening the model picker; its visible text is the current model (optional). */
  modelTrigger?: string;
  /** Model option items inside the open picker (optional; enables model switching). */
  modelOption?: string;
  /** File input for attaching local files to the prompt (optional). */
  attach?: string;
  /** Element whose presence means "not signed in" (optional). */
  signedOut?: string;
}

/** Static metadata + core selectors for a supported browser provider. */
export interface ProviderConfigEntry {
  /** Human-readable name for CLI/TUI and logs. */
  displayName: string;
  /** Whether MCP connector setup is supported (ChatGPT, Claude, and Grok today). */
  supportsMcpConnector: boolean;
  /** Origin hostname used to locate an existing tab. */
  origin: string;
  /** URL opened when no provider tab exists. */
  defaultUrl: string;
  /** Fallback model label before detection runs. */
  defaultModel: string;
  /** Core DOM selectors (composer + assistant, plus optional extras). */
  selectors: ProviderSelectors;
}
