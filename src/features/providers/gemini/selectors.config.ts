/** DOM selectors for Gemini's web interface. Subject to change when Google updates UI. */
export const SELECTORS = {
  promptInput: [
    'div.ql-editor',
    'rich-textarea [contenteditable="true"]',
    '[aria-label="Enter a prompt here"]',
    '[contenteditable="true"][role="textbox"]',
  ].join(", "),
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    ".send-button",
    "button.send-button",
  ].join(", "),
  responseBlock: [
    "model-response",
    "message-content",
    ".model-response-text",
    ".response-content",
  ].join(", "),
  userBlock: [
    "user-query",
    ".query-text",
    ".user-query",
    '[data-message-author="user"]',
  ].join(", "),
  streamingIndicator: [
    '[aria-busy="true"]',
    'button[aria-label*="Stop" i]',
  ].join(", "),
  sidebarConversation: [
    'a[href*="/app/"]',
    'nav a[href*="gemini.google.com"]',
  ].join(", "),
  modelTrigger: [
    'button[aria-label*="model" i]',
    'button[aria-label*="Model" i]',
    '[data-test-id="model-selector"]',
    'button:has-text("Gemini")',
    'button:has-text("Flash")',
    'button:has-text("Pro")',
  ].join(", "),
  openMenu: '[role="menu"], [role="listbox"], mat-menu-panel',
  signInButton: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    '[aria-label*="Sign in" i]',
  ].join(", "),
  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add file" i]',
  ].join(", "),
  actionButtons: [
    'button[aria-label="Redo"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Show more options"]',
  ].join(", "),
} as const;
