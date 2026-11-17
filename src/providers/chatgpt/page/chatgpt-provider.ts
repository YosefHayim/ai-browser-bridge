import type { Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { searchChatGptConversations } from "@/providers/chatgpt/backend-api/chatgpt-conversation-search.ts";
import { attachFilesToPrompt } from "@/providers/chatgpt/page/attach-files.ts";
import { removeComposerAttachments } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import { selectModel } from "@/providers/chatgpt/page/chatgpt-model-picker.ts";
import {
  CHATGPT_APP_NAME,
  CHATGPT_ORIGIN_URL,
  CHATGPT_PROVIDER_ID,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  captureAllMessages,
  captureLastReply,
  countAssistantReplies,
} from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { assertSignedIn } from "@/providers/chatgpt/page/chatgpt-session.ts";
import {
  navigateToConversation,
  openNewConversation,
  readSidebarConversations,
} from "@/providers/chatgpt/page/chatgpt-sidebar.ts";
import {
  setupMcpConnectorInChatGpt,
  turnOnConnectorInChatComposer,
} from "@/providers/chatgpt/page/connector-setup.ts";
import { injectPrompt } from "@/providers/chatgpt/page/inject-prompt.ts";
import { detectCurrentModel } from "@/providers/chatgpt/page/model-detection.ts";
import { isLikelyModelLabel, listAvailableModels } from "@/providers/chatgpt/page/model-menu.ts";
import { rewindLastUserPrompt } from "@/providers/chatgpt/page/rewind-last-prompt.ts";
import { stopGenerating } from "@/providers/chatgpt/page/stop-generating.ts";
import { waitForReply } from "@/providers/chatgpt/page/wait-for-reply.ts";
import type { BrowserProvider, ProviderProfile } from "@/providers/engine/browser-provider.ts";

const CHATGPT_HOSTNAME = "chatgpt.com";

export const chatGptProfile = {
  id: CHATGPT_PROVIDER_ID,
  origin: CHATGPT_HOSTNAME,
  defaultUrl: CHATGPT_ORIGIN_URL,
  defaultModel: CHATGPT_APP_NAME,
  displayName: CHATGPT_APP_NAME,
  composerSelector: PROVIDER_SETTINGS.chatgpt.selectors.composer,
  supportsMcpConnector: true,
} satisfies ProviderProfile;

export class ChatGptProvider implements BrowserProvider {
  readonly profile = chatGptProfile;

  constructor(private readonly page: Page) {}

  assertSignedIn: BrowserProvider["assertSignedIn"] = () => assertSignedIn(this.page);

  injectPrompt: BrowserProvider["injectPrompt"] = (prompt, settings) =>
    injectPrompt(this.page, prompt, settings);

  waitForReply: BrowserProvider["waitForReply"] = (waitSettings) =>
    waitForReply(this.page, waitSettings);

  captureLastReply: BrowserProvider["captureLastReply"] = (captureSettings) =>
    captureLastReply(this.page, captureSettings);

  countAssistantReplies: BrowserProvider["countAssistantReplies"] = () =>
    countAssistantReplies(this.page);

  captureAllMessages: BrowserProvider["captureAllMessages"] = (captureSettings) =>
    captureAllMessages(this.page, captureSettings);

  readSidebarConversations: BrowserProvider["readSidebarConversations"] = (settings) =>
    readSidebarConversations(this.page, settings);

  searchConversations: NonNullable<BrowserProvider["searchConversations"]> = (request) =>
    searchChatGptConversations(this.page, request);

  navigateToConversation: BrowserProvider["navigateToConversation"] = (url) =>
    navigateToConversation(this.page, url);

  newConversation: BrowserProvider["newConversation"] = () => openNewConversation(this.page);

  detectCurrentModel: BrowserProvider["detectCurrentModel"] = () => detectCurrentModel(this.page);

  listAvailableModels: BrowserProvider["listAvailableModels"] = () =>
    listAvailableModels(this.page);

  selectModel: BrowserProvider["selectModel"] = (query) => selectModel(this.page, query);

  rewindLastUserPrompt: BrowserProvider["rewindLastUserPrompt"] = (replacement) =>
    rewindLastUserPrompt(this.page, replacement);

  stopGenerating: BrowserProvider["stopGenerating"] = (timeout) =>
    stopGenerating(this.page, timeout);

  attachFilesToPrompt: BrowserProvider["attachFilesToPrompt"] = (paths) =>
    attachFilesToPrompt(this.page, paths);

  removeComposerAttachments: NonNullable<BrowserProvider["removeComposerAttachments"]> = () =>
    removeComposerAttachments(this.page);

  isLikelyModelLabel: BrowserProvider["isLikelyModelLabel"] = (label) => isLikelyModelLabel(label);

  setupMcpConnector: NonNullable<BrowserProvider["setupMcpConnector"]> = (url, setupSettings) =>
    setupMcpConnectorInChatGpt(this.page, url, setupSettings);

  turnOnConnectorInChat: NonNullable<BrowserProvider["turnOnConnectorInChat"]> = (connectorName) =>
    turnOnConnectorInChatComposer(this.page, connectorName);
}
