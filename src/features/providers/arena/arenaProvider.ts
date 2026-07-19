import type { BrowserProvider } from "../browserProviderTypes.ts";
import { ArenaPage } from "./arenaPage.ts";

const arenaPage = new ArenaPage();

/** Arena.ai browser adapter (modes + model picker + dual-option capture). */
export const ARENA_PROVIDER: BrowserProvider = {
  id: arenaPage.id,
  origin: arenaPage.origin,
  defaultUrl: arenaPage.defaultUrl,
  defaultModel: arenaPage.defaultModel,
  displayName: arenaPage.displayName,
  composerSelector: arenaPage.composerSelector,
  supportsMcpConnector: arenaPage.supportsMcpConnector,
  assertSignedIn: arenaPage.assertSignedIn.bind(arenaPage),
  injectPrompt: arenaPage.injectPrompt.bind(arenaPage),
  waitForResponse: arenaPage.waitForResponse.bind(arenaPage),
  captureLastResponse: arenaPage.captureLastResponse.bind(arenaPage),
  countAssistantResponses: arenaPage.countAssistantResponses.bind(arenaPage),
  captureAllMessages: arenaPage.captureAllMessages.bind(arenaPage),
  readSidebarConversations: arenaPage.readSidebarConversations.bind(arenaPage),
  navigateToConversation: arenaPage.navigateToConversation.bind(arenaPage),
  newConversation: arenaPage.newConversation.bind(arenaPage),
  detectCurrentModel: arenaPage.detectCurrentModel.bind(arenaPage),
  listAvailableModels: arenaPage.listAvailableModels.bind(arenaPage),
  selectModel: arenaPage.selectModel.bind(arenaPage),
  rewindLastUserPrompt: arenaPage.rewindLastUserPrompt.bind(arenaPage),
  stopGenerating: arenaPage.stopGenerating.bind(arenaPage),
  attachFilesToPrompt: arenaPage.attachFilesToPrompt.bind(arenaPage),
  isLikelyModelLabel: arenaPage.isLikelyModelLabel.bind(arenaPage),
};
