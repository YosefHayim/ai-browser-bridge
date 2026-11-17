import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { ATTACHED_FILE_REMOVE_BUTTON_SELECTOR } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import {
  GENERATED_IMAGE_SELECTOR,
  LIST_SEPARATOR,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";

const ADD_FILES_BUTTON_SELECTOR = 'button[aria-label="Add files and more"]';

export const SELECTORS = {
  promptInput: PROVIDER_SETTINGS.chatgpt.selectors.composer,

  sendButton:
    'button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]',

  responseBlock: PROVIDER_SETTINGS.chatgpt.selectors.assistant,

  lastResponse: PROVIDER_SETTINGS.chatgpt.selectors.assistant,

  sidebarConversation: 'nav a[href^="/c/"]',
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(LIST_SEPARATOR),
  generatedImage: GENERATED_IMAGE_SELECTOR,

  modelTrigger: [
    'button[aria-label="Select ChatGPT model"]',
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],

  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',

  userBlock: '[data-message-author-role="user"], [data-user-message-bubble]',

  conversationTurn: '[data-testid^="conversation-turn-"], [data-turn-key]',

  attachmentInput: 'input[type="file"][multiple]:not([accept])',
  attachmentMenuButton: [ADD_FILES_BUTTON_SELECTOR],
  attachmentMenuItem: "Add photos & files",
  attachedFileRemoveButton: ATTACHED_FILE_REMOVE_BUTTON_SELECTOR,

  accountMenuButton: [
    'button[aria-label="Open profile menu"]',
    '[data-testid="accounts-profile-button"]',
    '[role="button"][aria-label*="open profile menu" i]',
    'button[data-testid="profile-button"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
  ],
  guestLoginButton: ['[data-testid="login-button"]', '[data-testid="signup-button"]'],
} as const;
