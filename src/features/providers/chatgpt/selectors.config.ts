/** DOM selectors for ChatGPT's interface. Subject to change if ChatGPT updates UI. */
export const SELECTORS = {
  /** The contenteditable prompt input field. */
  promptInput: '#prompt-textarea, [contenteditable="true"]',
  /** The send button (visible when text is entered). */
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
  /** Individual assistant response blocks. */
  responseBlock: '[data-message-author-role="assistant"]',
  /** The most recent response block. */
  lastResponse: '[data-message-author-role="assistant"]:last-of-type',
  /** Sidebar conversation links. */
  sidebarConversation: 'nav a[href^="/c/"]',
  /** Streaming indicator (the stop button appears while streaming). */
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(", "),
  /** ChatGPT-generated images render outside the role block, served from the estuary content endpoint. */
  generatedImage: 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]',
  /** Model menu triggers in the ChatGPT shell. */
  modelTrigger: [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],
  /** Open dropdown / menu content. */
  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',
  /** User message blocks. */
  userBlock: '[data-message-author-role="user"]',
  /** Conversation turn wrapper. */
  conversationTurn: 'section[data-testid^="conversation-turn-"]',
  /** Composer file attachment controls. */
  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ],
  /** Profile/settings controls. */
  accountMenuButton: [
    '[data-testid="accounts-profile-button"]',
    '[role="button"][aria-label*="open profile menu" i]',
    'button[data-testid="profile-button"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
  ],
  settingsEntrypoint: [
    '[role="menuitem"]:has-text("Settings")',
    'button:has-text("Settings")',
    'a:has-text("Settings")',
  ],
} as const;
