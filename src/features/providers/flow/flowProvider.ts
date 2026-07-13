import type { BrowserProvider } from "../browserProviderTypes.ts";
import { FlowPage } from "./flowPage.ts";

const flowPage = new FlowPage();

/** Google Flow (Veo) browser adapter configuration. */
export const FLOW_PROVIDER: BrowserProvider = {
  id: flowPage.id,
  origin: flowPage.origin,
  defaultUrl: flowPage.defaultUrl,
  defaultModel: flowPage.defaultModel,
  displayName: flowPage.displayName,
  composerSelector: flowPage.composerSelector,
  supportsMcpConnector: flowPage.supportsMcpConnector,
  assertSignedIn: flowPage.assertSignedIn.bind(flowPage),
  injectPrompt: flowPage.injectPrompt.bind(flowPage),
  waitForResponse: flowPage.waitForResponse.bind(flowPage),
  captureLastResponse: flowPage.captureLastResponse.bind(flowPage),
  countAssistantResponses: flowPage.countAssistantResponses.bind(flowPage),
  captureAllMessages: flowPage.captureAllMessages.bind(flowPage),
  readSidebarConversations: flowPage.readSidebarConversations.bind(flowPage),
  navigateToConversation: flowPage.navigateToConversation.bind(flowPage),
  newConversation: flowPage.newConversation.bind(flowPage),
  detectCurrentModel: flowPage.detectCurrentModel.bind(flowPage),
  listAvailableModels: flowPage.listAvailableModels.bind(flowPage),
  selectModel: flowPage.selectModel.bind(flowPage),
  rewindLastUserPrompt: flowPage.rewindLastUserPrompt.bind(flowPage),
  stopGenerating: flowPage.stopGenerating.bind(flowPage),
  attachFilesToPrompt: flowPage.attachFilesToPrompt.bind(flowPage),
  isLikelyModelLabel: flowPage.isLikelyModelLabel.bind(flowPage),
};
