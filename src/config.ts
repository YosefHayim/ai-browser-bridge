import { z } from "zod";

const CONVERSATION_LINK_SELECTOR = 'a[href*="/c/"]';

const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop"]';

const FILE_PICKER_SELECTOR = 'input[type="file"]';

const MENU_COMMAND_OR_CHOICE_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="option"]';

const MENU_COMMAND_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

const SEND_MESSAGE_BUTTON_SELECTOR = 'button[aria-label="Send message"]';

const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';

const CLAUDE_AI_HOST = "claude.ai";

const DUCK_AI_DISPLAY_NAME = "Duck.ai";

const PERPLEXITY_DISPLAY_NAME = "Perplexity";

const GROK_DISPLAY_NAME = "Grok";

const DEEPSEEK_DISPLAY_NAME = "DeepSeek";

const CLAUDE_DESIGN_DISPLAY_NAME = "Claude Design";

const CLAUDE_DISPLAY_NAME = "Claude";

const GEMINI_DISPLAY_NAME = "Gemini";

const CHATGPT_DISPLAY_NAME = "ChatGPT";

const CHATGPT_PROVIDER_ID = "chatgpt";

export const DEFAULT_MCP_PORT = 8765;

export const REPO_DIRECTORY_NAME = ".bridge";

export const BRIDGE_DIRECTORY_NAME = ".ai-browser-bridge";

export const DEFAULT_TOKEN_LIMIT = 128_000;

export const DEFAULT_PERMISSION_MODE = "auto" as const;

export const DEFAULT_ASK_TIMEOUT_SECONDS = 300;

export const RENDER_STALL_RELOAD_MILLISECONDS = 180_000;

export const MAX_STALL_RELOADS = 2;

export const DEFAULT_PROVIDER = CHATGPT_PROVIDER_ID;

export const PROVIDER_IDS = [
  CHATGPT_PROVIDER_ID,
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

export type BridgeProviderId = (typeof PROVIDER_IDS)[number];

const BridgeProviderIdSchema = z.enum(PROVIDER_IDS);

const ProviderSelectorsSchema = z.object({
  composer: z.string(),
  assistant: z.string(),
  user: z.string().optional(),
  stop: z.string().optional(),
  send: z.string().optional(),
  newChat: z.string().optional(),
  sidebarItem: z.string().optional(),
  modelTrigger: z.string().optional(),
  modelOption: z.string().optional(),
  attach: z.string().optional(),
  signedOut: z.string().optional(),
});

const ProviderSettingSchema = z.object({
  displayName: z.string(),
  supportsMcpConnector: z.boolean(),
  origin: z.string(),
  pathPrefix: z.string().optional(),
  defaultUrl: z.string(),
  defaultModel: z.string(),
  selectors: ProviderSelectorsSchema,
});

const ProviderSettingsTableSchema = z.record(BridgeProviderIdSchema, ProviderSettingSchema);

export type ProviderSettingsTable = z.infer<typeof ProviderSettingsTableSchema>;

const parseSettings = <Parsed>(schema: z.ZodType<Parsed>, unparsedSettings: unknown): Parsed =>
  schema.parse(unparsedSettings);

export const PROVIDER_SETTINGS: ProviderSettingsTable = parseSettings(ProviderSettingsTableSchema, {
  chatgpt: {
    displayName: CHATGPT_DISPLAY_NAME,
    supportsMcpConnector: true,
    origin: "chatgpt.com",
    defaultUrl: "https://chatgpt.com",
    defaultModel: CHATGPT_DISPLAY_NAME,
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
    displayName: GEMINI_DISPLAY_NAME,
    supportsMcpConnector: false,
    origin: "gemini.google.com",
    defaultUrl: "https://gemini.google.com/app",
    defaultModel: GEMINI_DISPLAY_NAME,
    selectors: {
      composer: 'div.ql-editor, [contenteditable="true"]',
      assistant: "model-response, message-content, .model-response-text, .response-content",
    },
  },
  claude: {
    displayName: CLAUDE_DISPLAY_NAME,
    supportsMcpConnector: true,
    origin: CLAUDE_AI_HOST,
    defaultUrl: "https://claude.ai/new",
    defaultModel: CLAUDE_DISPLAY_NAME,
    selectors: {
      composer: '[data-testid="chat-input"], div[contenteditable="true"]',
      assistant: ".standard-markdown",
      user: USER_MESSAGE_SELECTOR,
      stop: 'button[aria-label="Stop response"]',
      send: SEND_MESSAGE_BUTTON_SELECTOR,
      newChat: 'a[aria-label="New chat"]',
      sidebarItem: 'nav a[href*="/chat/"]',
      modelTrigger: '[data-testid="model-selector-dropdown"]',
      modelOption: MENU_COMMAND_SELECTOR,
      attach: 'input[data-testid="file-upload"]',
      signedOut: 'a[href*="/login"]',
    },
  },
  deepseek: {
    displayName: DEEPSEEK_DISPLAY_NAME,
    supportsMcpConnector: false,
    origin: "chat.deepseek.com",
    defaultUrl: "https://chat.deepseek.com/",
    defaultModel: DEEPSEEK_DISPLAY_NAME,
    selectors: {
      composer: "textarea#chat-input, textarea",
      assistant: ".ds-markdown",
      stop: 'div[role="button"][aria-label*="Stop"]',
      sidebarItem: 'a[href*="/a/chat/s/"]',
      attach: FILE_PICKER_SELECTOR,
      signedOut: 'button:has-text("Log in")',
    },
  },
  grok: {
    displayName: GROK_DISPLAY_NAME,
    supportsMcpConnector: true,
    origin: "grok.com",
    defaultUrl: "https://grok.com/",
    defaultModel: GROK_DISPLAY_NAME,
    selectors: {
      composer: '[aria-label="Ask Grok anything"], div.tiptap.ProseMirror, textarea',
      assistant: '[class*="message-bubble"]',
      stop: STOP_BUTTON_SELECTOR,
      newChat: '[data-testid="new-chat"]',
      sidebarItem: CONVERSATION_LINK_SELECTOR,
      modelTrigger: 'button[aria-label="Model select"]',
      modelOption: MENU_COMMAND_SELECTOR,
      attach: FILE_PICKER_SELECTOR,
      signedOut: 'button:has-text("Sign in")',
    },
  },
  perplexity: {
    displayName: PERPLEXITY_DISPLAY_NAME,
    supportsMcpConnector: false,
    origin: "perplexity.ai",
    defaultUrl: "https://www.perplexity.ai/",
    defaultModel: PERPLEXITY_DISPLAY_NAME,
    selectors: {
      composer: '#ask-input, textarea, div[contenteditable="true"]',
      assistant: ".prose",
      stop: STOP_BUTTON_SELECTOR,
      send: 'button[aria-label="Submit"]',
      sidebarItem: 'a[href*="/search/"]',
      modelTrigger: 'button[aria-label="Model"]',
      modelOption: MENU_COMMAND_SELECTOR,
      attach: FILE_PICKER_SELECTOR,
      signedOut: 'button:has-text("Sign Up")',
    },
  },
  flow: {
    // Flow is a video studio, not a chat, and has no MCP connector, so the tunnel is skipped.
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
      modelOption: MENU_COMMAND_OR_CHOICE_SELECTOR,
      attach: 'input[type="file"][accept*="image" i], input[type="file"]',
      signedOut: 'a[href*="accounts.google.com"], button:has-text("Sign in")',
    },
  },
  duck: {
    // Selectors live-verified 2026-07-19; no account and no MCP connector.
    displayName: DUCK_AI_DISPLAY_NAME,
    supportsMcpConnector: false,
    origin: "duck.ai",
    defaultUrl: "https://duck.ai/chat",
    defaultModel: DUCK_AI_DISPLAY_NAME,
    selectors: {
      composer: 'textarea[name="user-prompt"], [data-testid="duckai-chat-input"] textarea',
      assistant: 'div[id*="-assistant-message-"]:not([id^="heading-"])',
      user: USER_MESSAGE_SELECTOR,
      stop: 'button[aria-label="Stop generating"]',
      send: 'button[aria-label="Ask"]',
      newChat: 'button:has-text("New Chat")',
      modelTrigger: '[data-testid="model-picker-button"]',
      modelOption: MENU_COMMAND_OR_CHOICE_SELECTOR,
      attach: 'input[name="upload"], input[type="file"]',
    },
  },
  arena: {
    // Default mode is Direct; the adapter lives in providers/arena/.
    displayName: "Arena",
    supportsMcpConnector: false,
    origin: "arena.ai",
    defaultUrl: "https://arena.ai/code/direct",
    defaultModel: "Max",
    selectors: {
      composer: 'textarea[name="message"], [contenteditable="true"]',
      assistant: "div.rounded-xl .prose",
      user: ".bg-surface-raised .prose, .self-end .prose",
      send: SEND_MESSAGE_BUTTON_SELECTOR,
      newChat: 'a[href="/code"], a[href*="/direct"]',
      sidebarItem: CONVERSATION_LINK_SELECTOR,
      modelTrigger: 'button:has-text("Max")',
      modelOption: '[role="option"]',
      attach: FILE_PICKER_SELECTOR,
    },
  },
  design: {
    // Shares claude.ai with `claude`, so pathPrefix decides tab ownership.
    displayName: CLAUDE_DESIGN_DISPLAY_NAME,
    supportsMcpConnector: false,
    origin: CLAUDE_AI_HOST,
    pathPrefix: "/design",
    defaultUrl: "https://claude.ai/design",
    defaultModel: CLAUDE_DESIGN_DISPLAY_NAME,
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
