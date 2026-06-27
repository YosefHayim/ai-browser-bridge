import * as chatgpt from "./chatgpt/chatgpt-page.ts";
import type { BrowserProvider } from "./browser-provider.types.ts";

/** ChatGPT browser adapter configuration. */
export const CHATGPT_PROVIDER: BrowserProvider = {
  id: "chatgpt",
  origin: "chatgpt.com",
  defaultUrl: "https://chatgpt.com",
  defaultModel: "ChatGPT",
  displayName: "ChatGPT",
  composerSelector: '#prompt-textarea, [contenteditable="true"]',
  supportsMcpConnector: true,
  assertSignedIn: chatgpt.assertSignedIn,
  injectPrompt: chatgpt.injectPrompt,
  waitForResponse: chatgpt.waitForResponse,
  captureLastResponse: chatgpt.captureLastResponse,
  countAssistantResponses: chatgpt.countAssistantResponses,
  captureAllMessages: chatgpt.captureAllMessages,
  readSidebarConversations: chatgpt.readSidebarConversations,
  navigateToConversation: chatgpt.navigateToConversation,
  newConversation: chatgpt.newConversation,
  detectCurrentModel: chatgpt.detectCurrentModel,
  listAvailableModels: chatgpt.listAvailableModels,
  selectModel: chatgpt.selectModel,
  rewindLastUserPrompt: chatgpt.rewindLastUserPrompt,
  stopGenerating: chatgpt.stopGenerating,
  attachFilesToPrompt: chatgpt.attachFilesToPrompt,
  isLikelyModelLabel: chatgpt.isLikelyModelLabel,
  setupMcpConnector: chatgpt.setupMcpConnectorInChatGpt,
};
