import type { BrowserProvider } from "./browserProviderTypes.ts";
import { ChatGptPage } from "./chatgpt/chatgptPage.ts";

const chatGptPage = new ChatGptPage();

/** ChatGPT browser adapter configuration. */
export const CHATGPT_PROVIDER: BrowserProvider = {
  id: chatGptPage.id,
  origin: chatGptPage.origin,
  defaultUrl: chatGptPage.defaultUrl,
  defaultModel: chatGptPage.defaultModel,
  displayName: chatGptPage.displayName,
  composerSelector: chatGptPage.composerSelector,
  supportsMcpConnector: chatGptPage.supportsMcpConnector,
  assertSignedIn: chatGptPage.assertSignedIn.bind(chatGptPage),
  injectPrompt: chatGptPage.injectPrompt.bind(chatGptPage),
  waitForResponse: chatGptPage.waitForResponse.bind(chatGptPage),
  captureLastResponse: chatGptPage.captureLastResponse.bind(chatGptPage),
  countAssistantResponses: chatGptPage.countAssistantResponses.bind(chatGptPage),
  captureAllMessages: chatGptPage.captureAllMessages.bind(chatGptPage),
  readSidebarConversations: chatGptPage.readSidebarConversations.bind(chatGptPage),
  navigateToConversation: chatGptPage.navigateToConversation.bind(chatGptPage),
  newConversation: chatGptPage.newConversation.bind(chatGptPage),
  detectCurrentModel: chatGptPage.detectCurrentModel.bind(chatGptPage),
  listAvailableModels: chatGptPage.listAvailableModels.bind(chatGptPage),
  selectModel: chatGptPage.selectModel.bind(chatGptPage),
  rewindLastUserPrompt: chatGptPage.rewindLastUserPrompt.bind(chatGptPage),
  stopGenerating: chatGptPage.stopGenerating.bind(chatGptPage),
  attachFilesToPrompt: chatGptPage.attachFilesToPrompt.bind(chatGptPage),
  isLikelyModelLabel: chatGptPage.isLikelyModelLabel.bind(chatGptPage),
  setupMcpConnector: chatGptPage.setupMcpConnector.bind(chatGptPage),
};
