import * as gemini from "./gemini/gemini-page.ts";
import type { BrowserProvider } from "./browser-provider.types.ts";

/** Gemini browser adapter configuration. */
export const GEMINI_PROVIDER: BrowserProvider = {
  id: "gemini",
  origin: "gemini.google.com",
  defaultUrl: "https://gemini.google.com/app",
  defaultModel: "Gemini",
  displayName: "Gemini",
  composerSelector: 'div.ql-editor, rich-textarea [contenteditable="true"], [aria-label="Enter a prompt here"]',
  supportsMcpConnector: false,
  assertSignedIn: gemini.assertSignedIn,
  injectPrompt: gemini.injectPrompt,
  waitForResponse: gemini.waitForResponse,
  captureLastResponse: gemini.captureLastResponse,
  countAssistantResponses: gemini.countAssistantResponses,
  captureAllMessages: gemini.captureAllMessages,
  readSidebarConversations: gemini.readSidebarConversations,
  navigateToConversation: gemini.navigateToConversation,
  newConversation: gemini.newConversation,
  detectCurrentModel: gemini.detectCurrentModel,
  listAvailableModels: gemini.listAvailableModels,
  selectModel: gemini.selectModel,
  rewindLastUserPrompt: gemini.rewindLastUserPrompt,
  stopGenerating: gemini.stopGenerating,
  attachFilesToPrompt: gemini.attachFilesToPrompt,
  isLikelyModelLabel: gemini.isLikelyModelLabel,
};

/** Bind Gemini page helpers to the shared provider interface. */
export function bindGeminiProvider(_input: { unused?: true } = {}): BrowserProvider {
  return GEMINI_PROVIDER;
}
