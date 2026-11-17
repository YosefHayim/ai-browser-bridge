import { PROVIDER_SETTINGS } from "@/provider-settings.ts";

const LIST_SEPARATOR = ", ";

export const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop" i]';

// DOM selectors for Gemini's web interface. Subject to change when Google updates UI.
export const SELECTORS = {
  promptInput: [
    "div.ql-editor",
    'rich-textarea [contenteditable="true"]',
    '[aria-label="Enter a prompt here"]',
    '[contenteditable="true"][role="textbox"]',
  ].join(LIST_SEPARATOR),
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    ".send-button",
    "button.send-button",
  ].join(LIST_SEPARATOR),
  responseBlock: PROVIDER_SETTINGS.gemini.selectors.assistant,
  userBlock: ["user-query", ".query-text", ".user-query", '[data-message-author="user"]'].join(
    LIST_SEPARATOR,
  ),
  streamingIndicator: ['[aria-busy="true"]', STOP_BUTTON_SELECTOR].join(LIST_SEPARATOR),
  sidebarConversation: ['a[href*="/app/"]', 'nav a[href*="gemini.google.com"]'].join(
    LIST_SEPARATOR,
  ),
  modelTrigger: [
    'button[aria-label*="model" i]',
    'button[aria-label*="Model" i]',
    '[data-test-id="model-selector"]',
    'button:has-text("Gemini")',
    'button:has-text("Flash")',
    'button:has-text("Pro")',
  ].join(LIST_SEPARATOR),
  openMenu: '[role="menu"], [role="listbox"], mat-menu-panel',
  signInButton: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    '[aria-label*="Sign in" i]',
  ].join(LIST_SEPARATOR),
  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add file" i]',
  ].join(LIST_SEPARATOR),
  actionButtons: [
    'button[aria-label="Redo"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Show more options"]',
  ].join(LIST_SEPARATOR),
} as const;
