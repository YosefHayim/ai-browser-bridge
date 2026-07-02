import type { BrowserProvider } from "./browserProviderTypes.ts";
import { GeminiPage } from "./gemini/geminiPage.ts";

const geminiPage = new GeminiPage();

/** Gemini browser adapter configuration. */
export const GEMINI_PROVIDER: BrowserProvider = {
  id: geminiPage.id,
  origin: geminiPage.origin,
  defaultUrl: geminiPage.defaultUrl,
  defaultModel: geminiPage.defaultModel,
  displayName: geminiPage.displayName,
  composerSelector: geminiPage.composerSelector,
  supportsMcpConnector: geminiPage.supportsMcpConnector,
  assertSignedIn: geminiPage.assertSignedIn.bind(geminiPage),
  injectPrompt: geminiPage.injectPrompt.bind(geminiPage),
  waitForResponse: geminiPage.waitForResponse.bind(geminiPage),
  captureLastResponse: geminiPage.captureLastResponse.bind(geminiPage),
  countAssistantResponses: geminiPage.countAssistantResponses.bind(geminiPage),
  captureAllMessages: geminiPage.captureAllMessages.bind(geminiPage),
  readSidebarConversations: geminiPage.readSidebarConversations.bind(geminiPage),
  navigateToConversation: geminiPage.navigateToConversation.bind(geminiPage),
  newConversation: geminiPage.newConversation.bind(geminiPage),
  detectCurrentModel: geminiPage.detectCurrentModel.bind(geminiPage),
  listAvailableModels: geminiPage.listAvailableModels.bind(geminiPage),
  selectModel: geminiPage.selectModel.bind(geminiPage),
  rewindLastUserPrompt: geminiPage.rewindLastUserPrompt.bind(geminiPage),
  stopGenerating: geminiPage.stopGenerating.bind(geminiPage),
  attachFilesToPrompt: geminiPage.attachFilesToPrompt.bind(geminiPage),
  isLikelyModelLabel: geminiPage.isLikelyModelLabel.bind(geminiPage),
};
