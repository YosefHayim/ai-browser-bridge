import { PROVIDER_CONFIG } from "@/config.ts";
import type { BrowserProvider } from "../browserProvider.ts";
import { setupMcpConnectorInChatGpt } from "../connectors/chatgptConnector.ts";
import { searchChatGptConversations } from "./chatgptConversationSearch.ts";
import { captureAllMessages, captureLastResponse } from "./content/chatgptAttachments.ts";
import {
  attachFilesToPrompt,
  injectPrompt,
  rewindLastUserPrompt,
  stopGenerating,
} from "./conversation/chatgptComposer.ts";
import { assertSignedIn, countAssistantResponses } from "./conversation/chatgptControls.ts";
import {
  detectCurrentModel,
  isLikelyModelLabel,
  listAvailableModels,
  selectModel,
} from "./conversation/chatgptModelPicker.ts";
import {
  navigateToConversation,
  newConversation,
  readSidebarConversations,
} from "./conversation/chatgptNavigation.ts";
import { waitForResponse } from "./conversation/chatgptResponse.ts";

export const chatGptProvider = {
  id: "chatgpt",
  origin: "chatgpt.com",
  defaultUrl: "https://chatgpt.com",
  defaultModel: "ChatGPT",
  displayName: "ChatGPT",
  composerSelector: PROVIDER_CONFIG.chatgpt.selectors.composer,
  supportsMcpConnector: true,
  assertSignedIn,
  injectPrompt,
  waitForResponse,
  captureLastResponse,
  countAssistantResponses,
  captureAllMessages,
  readSidebarConversations,
  searchConversations: searchChatGptConversations,
  navigateToConversation,
  newConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  isLikelyModelLabel,
  setupMcpConnector: setupMcpConnectorInChatGpt,
} satisfies BrowserProvider;
