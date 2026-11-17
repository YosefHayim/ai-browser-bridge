import type { Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { searchChatGptConversations } from "@/providers/chatgpt/backend-api/chatgpt-conversation-search.ts";
import { ChatGptComposer } from "@/providers/chatgpt/page/chatgpt-composer.ts";
import { ChatGptModelPicker } from "@/providers/chatgpt/page/chatgpt-model-picker.ts";
import {
  CHATGPT_APP_NAME,
  CHATGPT_ORIGIN_URL,
  CHATGPT_PROVIDER_ID,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { ChatGptReplyReader } from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { ChatGptSession } from "@/providers/chatgpt/page/chatgpt-session.ts";
import { ChatGptSidebar } from "@/providers/chatgpt/page/chatgpt-sidebar.ts";
import { ChatGptConnectorSetup } from "@/providers/chatgpt/page/connector-setup.ts";
import { isLikelyModelLabel } from "@/providers/chatgpt/page/model-menu.ts";
import { ChatGptRewinder } from "@/providers/chatgpt/page/rewind-last-prompt.ts";
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

  private readonly session: ChatGptSession;
  private readonly composer: ChatGptComposer;
  private readonly replyReader: ChatGptReplyReader;
  private readonly sidebar: ChatGptSidebar;
  private readonly modelPicker: ChatGptModelPicker;
  private readonly rewinder: ChatGptRewinder;
  private readonly connectorSetup: ChatGptConnectorSetup;

  readonly assertSignedIn: BrowserProvider["assertSignedIn"];
  readonly injectPrompt: BrowserProvider["injectPrompt"];
  readonly waitForReply: BrowserProvider["waitForReply"];
  readonly captureLastReply: BrowserProvider["captureLastReply"];
  readonly countAssistantReplies: BrowserProvider["countAssistantReplies"];
  readonly captureAllMessages: BrowserProvider["captureAllMessages"];
  readonly readSidebarConversations: BrowserProvider["readSidebarConversations"];
  readonly searchConversations: NonNullable<BrowserProvider["searchConversations"]>;
  readonly navigateToConversation: BrowserProvider["navigateToConversation"];
  readonly newConversation: BrowserProvider["newConversation"];
  readonly detectCurrentModel: BrowserProvider["detectCurrentModel"];
  readonly listAvailableModels: BrowserProvider["listAvailableModels"];
  readonly selectModel: BrowserProvider["selectModel"];
  readonly rewindLastUserPrompt: BrowserProvider["rewindLastUserPrompt"];
  readonly stopGenerating: BrowserProvider["stopGenerating"];
  readonly attachFilesToPrompt: BrowserProvider["attachFilesToPrompt"];
  readonly removeComposerAttachments: NonNullable<BrowserProvider["removeComposerAttachments"]>;
  readonly isLikelyModelLabel: BrowserProvider["isLikelyModelLabel"] = isLikelyModelLabel;
  readonly setupMcpConnector: NonNullable<BrowserProvider["setupMcpConnector"]>;
  readonly turnOnConnectorInChat: NonNullable<BrowserProvider["turnOnConnectorInChat"]>;

  constructor(page: Page) {
    this.session = new ChatGptSession(page);
    this.composer = new ChatGptComposer(page);
    this.replyReader = new ChatGptReplyReader(page);
    this.sidebar = new ChatGptSidebar(page);
    this.modelPicker = new ChatGptModelPicker(page);
    this.rewinder = new ChatGptRewinder(page);
    this.connectorSetup = new ChatGptConnectorSetup(page);

    this.assertSignedIn = this.session.assertSignedIn;
    this.injectPrompt = this.composer.injectPrompt;
    this.stopGenerating = this.composer.stopGenerating;
    this.attachFilesToPrompt = this.composer.attachFilesToPrompt;
    this.removeComposerAttachments = this.composer.removeComposerAttachments;
    this.waitForReply = this.replyReader.waitForReply;
    this.captureLastReply = this.replyReader.captureLastReply;
    this.countAssistantReplies = this.replyReader.countAssistantReplies;
    this.captureAllMessages = this.replyReader.captureAllMessages;
    this.readSidebarConversations = this.sidebar.readSidebarConversations;
    this.navigateToConversation = this.sidebar.navigateToConversation;
    this.newConversation = this.sidebar.openNewConversation;
    this.searchConversations = (request) => searchChatGptConversations(page, request);
    this.detectCurrentModel = this.modelPicker.detectCurrentModel;
    this.listAvailableModels = this.modelPicker.listAvailableModels;
    this.selectModel = this.modelPicker.selectModel;
    this.rewindLastUserPrompt = this.rewinder.rewindLastUserPrompt;
    this.setupMcpConnector = this.connectorSetup.setupMcpConnectorInChatGpt;
    this.turnOnConnectorInChat = this.connectorSetup.turnOnConnectorInChatComposer;
  }
}
