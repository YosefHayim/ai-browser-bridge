import type { Page } from "playwright";
import { z } from "zod";
import { DesignComposer } from "@/providers/design/design-composer.ts";
import { DesignProjects } from "@/providers/design/design-projects.ts";
import {
  callDesignRpc,
  type DesignProjectDocument,
  ProjectDetailsReplySchema,
  readProjectDocumentFromBase64,
  readProjectIdFromDesignUrl,
} from "@/providers/design/design-rpc.ts";
import { DESIGN_SELECTORS, DesignTabs } from "@/providers/design/design-tabs.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";

const BUTTON_TAG = "button";

const UTF8_ENCODING = "utf8";

const BASE64_ENCODING = "base64";

const DEFAULT_CHAT_TITLE = "Chat";

const GET_PROJECT_RPC_METHOD = "GetProjectData";

const WAITING_FOR_ANSWER_STATUS = "waiting-for-answer";

const RUNNING_STATUS = "running";

const REPLIED_STATUS = "replied";

export type DesignMessage = {
  readonly id: string | undefined;
  readonly role: string;
  readonly kind: string | undefined;
  readonly content: string;
  readonly timestamp: string | undefined;
};

export type DesignConversationSummary = {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly lastOpened: string | undefined;
  readonly active: boolean;
  readonly open: boolean;
};

export type DesignConversationRead = {
  readonly projectId: string;
  readonly conversation: DesignConversationSummary;
  readonly messages: readonly DesignMessage[];
};

const DESIGN_TURN_STATUSES = [REPLIED_STATUS, RUNNING_STATUS, WAITING_FOR_ANSWER_STATUS] as const;
type DesignTurnStatus = (typeof DESIGN_TURN_STATUSES)[number];

export type DesignTurnReport = {
  readonly projectId: string;
  readonly conversationId: string | undefined;
  readonly status: DesignTurnStatus;
  readonly model: string | undefined;
  readonly messages: readonly DesignMessage[];
};

export type DesignTurnSettings = {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly attachments: readonly string[];
  readonly autoDecide: boolean;
  readonly wait: boolean;
  readonly timeoutMilliseconds: number;
};

const TURN_POLL_MILLISECONDS = 2_000;
const TURN_START_GRACE_MILLISECONDS = 30_000;
const PROJECT_URL_WAIT_MILLISECONDS = 60_000;
const PERSIST_WAIT_MILLISECONDS = 30_000;
const TITLE_WAIT_MILLISECONDS = 90_000;
const NAME_SETTLE_MILLISECONDS = 3_000;
const NAME_ATTEMPTS = 3;
const DECIDE_FOR_ME = /^Decide for me$/i;
const CONTINUE = /^Continue$/i;

type ProjectDocumentSnapshot = {
  readonly document: DesignProjectDocument;
  readonly version: string | undefined;
};

export class DesignConversation {
  constructor(
    private readonly page: Page,
    private readonly tabs = new DesignTabs(page),
    private readonly projects = new DesignProjects(page),
  ) {}

  private readProjectDocument = async (projectId: string): Promise<ProjectDocumentSnapshot> => {
    const reply = await callDesignRpc({
      page: this.page,
      method: GET_PROJECT_RPC_METHOD,
      body: { projectId },
      replySchema: ProjectDetailsReplySchema,
    });

    const encodedDocument = reply.data;

    const isReplyBlank = encodedDocument == null || encodedDocument.length === 0;
    if (isReplyBlank) {
      return { document: { chats: {}, closedChats: [] }, version: reply.version };
    }

    return { document: readProjectDocumentFromBase64(encodedDocument), version: reply.version };
  };

  listDesignConversations = async (projectId: string): Promise<DesignConversationSummary[]> => {
    const { document } = await this.readProjectDocument(projectId);
    const activeId = document.viewState?.activeChatId;

    return [
      ...Object.values(document.chats).map((chat) =>
        readConversationSummary(chat, { activeId, open: true }),
      ),
      ...document.closedChats.map((chat) =>
        readConversationSummary(chat, { activeId, open: false }),
      ),
    ];
  };

  readDesignConversation = async (request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly limit: number;
  }): Promise<DesignConversationRead> => {
    const { document } = await this.readProjectDocument(request.projectId);
    const chat = findChat(document, request.conversationId);

    const isChatMissing = chat == null;
    if (isChatMissing) {
      throw new Error(`Claude Design project ${request.projectId} has no such conversation.`);
    }

    return {
      projectId: request.projectId,
      conversation: readConversationSummary(chat, {
        activeId: document.viewState?.activeChatId,
        open: document.chats[chat.id] != null,
      }),
      messages: chat.messages.slice(-request.limit).map(readDesignMessage),
    };
  };

  readActiveDesignMessages = async (projectId: string): Promise<DesignMessage[]> => {
    const { document } = await this.readProjectDocument(projectId);
    const chat = findChat(document, undefined);

    const isChatMissing = chat == null;
    if (isChatMissing) return [];

    return chat.messages.map(readDesignMessage);
  };

  private editProjectDocument = async (request: {
    readonly projectId: string;
    readonly edit: (document: EditableProjectDocument) => EditableProjectDocument;
  }): Promise<void> => {
    await this.tabs.assertDesignProjectIdle(request.projectId);

    const reply = await callDesignRpc({
      page: this.page,
      method: GET_PROJECT_RPC_METHOD,
      body: { projectId: request.projectId },
      replySchema: ProjectDetailsReplySchema,
    });

    const encodedDocument = reply.data;

    const isReplyMissing = encodedDocument == null;
    if (isReplyMissing) {
      throw new Error(`Claude Design project ${request.projectId} has no conversations yet.`);
    }

    const decodedDocument = Buffer.from(encodedDocument, BASE64_ENCODING).toString(UTF8_ENCODING);
    const parsedDocument = JSON.parse(decodedDocument);
    const document = EditableProjectDocumentSchema.parse(parsedDocument);
    const edited = request.edit(document);
    const serializedEditedDocument = JSON.stringify(edited);
    await callDesignRpc({
      page: this.page,
      method: "UpdateProjectData",
      body: {
        projectId: request.projectId,
        data: Buffer.from(serializedEditedDocument, UTF8_ENCODING).toString(BASE64_ENCODING),
        expectedVersion: reply.version,
      },
      replySchema: ProjectDetailsReplySchema,
    });
    // An open tab still holds the old document; reload it so its next save builds on ours.
    const projectTabReloads = this.tabs
      .listDesignProjectTabs(request.projectId)
      .map((projectTab) => projectTab.reload({ waitUntil: "domcontentloaded" }));
    await Promise.all(projectTabReloads);
  };

  // The app has no rename control for a Conversation; it writes chat titles the same way.
  renameDesignConversation = async (request: {
    readonly projectId: string;
    readonly conversationId: string;
    readonly title: string;
  }): Promise<void> => {
    const renamed = { title: request.title, titleIsGenerated: false };
    await this.editProjectDocument({
      projectId: request.projectId,
      edit: (document) => {
        const openChat = document.chats[request.conversationId];

        const hasOpenChat = openChat != null;
        if (hasOpenChat) {
          return {
            ...document,
            chats: { ...document.chats, [request.conversationId]: { ...openChat, ...renamed } },
          };
        }

        requireClosedConversation(document, request);
        return {
          ...document,
          closedChats: document.closedChats.map((closed) => {
            const isDifferentConversation = closed.id !== request.conversationId;
            if (isDifferentConversation) return closed;

            return { ...closed, ...renamed };
          }),
        };
      },
    });
  };

  // A closed Conversation reopens beside the open ones, as picking it in the history does.
  activateDesignConversation = async (request: {
    readonly projectId: string;
    readonly conversationId: string;
  }): Promise<void> => {
    const { document } = await this.readProjectDocument(request.projectId);

    const isConversationActive = document.viewState?.activeChatId === request.conversationId;
    if (isConversationActive) return;

    await this.editProjectDocument({
      projectId: request.projectId,
      edit: (editable) => {
        const viewStatus = { ...editable.viewState, activeChatId: request.conversationId };

        const isChatStored = editable.chats[request.conversationId] != null;

        if (isChatStored) return { ...editable, viewState: viewStatus };

        const closedChat = requireClosedConversation(editable, request);
        return {
          ...editable,
          chats: { ...editable.chats, [request.conversationId]: closedChat },
          closedChats: editable.closedChats.filter(
            (closed) => closed.id !== request.conversationId,
          ),
          viewState: viewStatus,
        };
      },
    });
  };

  startNewDesignConversation = async (projectId: string): Promise<string> => {
    await this.tabs.assertDesignProjectIdle(projectId);
    const before = await this.readProjectDocument(projectId);
    const knownIds = new Set([
      ...Object.keys(before.document.chats),
      ...before.document.closedChats.map((chat) => chat.id),
    ]);
    const projectTab = await this.tabs.openDesignProjectTab(projectId);
    await new DesignComposer(projectTab).closeDesignMenus();
    await projectTab.locator(DESIGN_SELECTORS.chatHistory).click();
    await projectTab
      .locator(`${DESIGN_SELECTORS.menu} button`)
      .filter({ hasText: "New chat" })
      .first()
      .click();
    const deadline = Date.now() + PERSIST_WAIT_MILLISECONDS;
    while (Date.now() < deadline) {
      await projectTab.waitForTimeout(TURN_POLL_MILLISECONDS);
      const { document } = await this.readProjectDocument(projectId);
      const created = Object.keys(document.chats).find((chatId) => !knownIds.has(chatId));

      const hasCreated = created != null;
      if (hasCreated) return created;
    }
    throw new Error(`Claude Design: the new conversation in ${projectId} was not saved in time.`);
  };

  private isButtonVisible = async (name: RegExp): Promise<boolean> => {
    return probeOrFallback(false, () =>
      this.page.getByRole(BUTTON_TAG, { name }).first().isVisible(),
    );
  };

  private answerDesignQuestion = async (): Promise<void> => {
    for (const name of [DECIDE_FOR_ME, CONTINUE]) {
      const hasVisibleButton = await this.isButtonVisible(name);
      if (hasVisibleButton) {
        await this.page.getByRole(BUTTON_TAG, { name }).first().click();
      }
    }
  };

  private turnMessages = async (request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
  }) => {
    const { document } = await this.readProjectDocument(request.projectId);
    const chat = findChat(document, request.conversationId);

    const isChatMissing = chat == null;
    if (isChatMissing) return { conversationId: request.conversationId, messages: [] };

    return { conversationId: chat.id, messages: chat.messages.slice(request.messageCount) };
  };

  // The turn's agent loop runs inside its tab, so the turn stops when that tab goes away.
  private pauseOnTurnTab = async (projectId: string): Promise<void> => {
    try {
      await this.page.waitForTimeout(TURN_POLL_MILLISECONDS);
    } catch (error) {
      const isNotClosedPage = !this.page.isClosed();
      if (isNotClosedPage) throw error;

      throw new Error(
        `Claude Design: the tab running the turn in ${projectId} closed, which stops the turn. Check what was saved with \`design read\`.`,
      );
    }
  };

  // Text stability is not enough, since the agent pauses between tool steps.
  waitForDesignTurn = async (request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
    readonly model: string | undefined;
    readonly autoDecide: boolean;
    readonly timeoutMilliseconds: number;
  }): Promise<DesignTurnReport> => {
    const startedAt = Date.now();
    let sawRunning = false;
    let idlePolls = 0;
    let latest: { conversationId: string | undefined; messages: DesignChat["messages"] } = {
      conversationId: request.conversationId,
      messages: [],
    };
    function createTurnReport(status: DesignTurnStatus): DesignTurnReport {
      return {
        projectId: request.projectId,
        conversationId: latest.conversationId,
        status,
        model: request.model,
        messages: latest.messages.map(readDesignMessage),
      };
    }
    while (Date.now() - startedAt < request.timeoutMilliseconds) {
      await this.pauseOnTurnTab(request.projectId);

      const isAutoDecide = request.autoDecide;
      if (isAutoDecide) await this.answerDesignQuestion();

      const hasBusyDesignTab = await this.tabs.isDesignTabBusy();
      if (hasBusyDesignTab) {
        sawRunning = true;
        idlePolls = 0;
        continue;
      }

      idlePolls += 1;

      const isWithinTurnStartGrace =
        !sawRunning && Date.now() - startedAt < TURN_START_GRACE_MILLISECONDS;
      if (isWithinTurnStartGrace) continue;

      const requiredIdlePolls = 2;

      const isNotYetSettled = idlePolls < requiredIdlePolls;
      if (isNotYetSettled) continue;

      const hasVisibleDecideButton = await this.isButtonVisible(DECIDE_FOR_ME);
      if (hasVisibleDecideButton) return createTurnReport(WAITING_FOR_ANSWER_STATUS);

      const hasVisibleContinueButton = await this.isButtonVisible(CONTINUE);
      if (hasVisibleContinueButton) return createTurnReport(WAITING_FOR_ANSWER_STATUS);

      latest = await this.turnMessages(request);

      const hasAssistantMessage = latest.messages.some((message) => message.role === "assistant");
      if (hasAssistantMessage) {
        return createTurnReport(REPLIED_STATUS);
      }
    }
    latest = await this.turnMessages(request);
    return createTurnReport(RUNNING_STATUS);
  };

  sendDesignMessage = async (
    request: DesignTurnSettings & {
      readonly projectId: string;
      readonly message: string;
      readonly conversationId: string | undefined;
      readonly designSystemIds: readonly string[] | undefined;
    },
  ): Promise<DesignTurnReport> => {
    await this.tabs.assertDesignProjectIdle(request.projectId);

    const hasDesignSystemIds = request.designSystemIds != null;
    if (hasDesignSystemIds) {
      await this.projects.setDesignProjectDesignSystems({
        projectId: request.projectId,
        designSystemIds: request.designSystemIds,
      });
    }

    const hasConversationId = request.conversationId != null;
    if (hasConversationId) {
      await this.activateDesignConversation({
        projectId: request.projectId,
        conversationId: request.conversationId,
      });
    }

    const projectTab = await this.tabs.openDesignProjectTab(request.projectId);
    const model = await new DesignComposer(projectTab).chooseDesignModel({
      model: request.model,
      effort: request.effort,
    });
    await new DesignComposer(projectTab).attachDesignFiles(request.attachments);
    const before = await this.turnMessages({
      projectId: request.projectId,
      conversationId: request.conversationId,
      messageCount: 0,
    });
    await new DesignComposer(projectTab).typeIntoDesignComposer({
      selector: DESIGN_SELECTORS.chatComposer,
      text: request.message,
      append: false,
    });
    await projectTab.locator(DESIGN_SELECTORS.chatSend).click();
    const turn = {
      projectId: request.projectId,
      conversationId: before.conversationId,
      messageCount: before.messages.length,
      model,
      autoDecide: request.autoDecide,
      timeoutMilliseconds: request.timeoutMilliseconds,
    };

    const isNotWait = !request.wait;
    if (isNotWait) return readRunningTurn(turn);

    return new DesignConversation(projectTab).waitForDesignTurn(turn);
  };

  // The requested name is set after the first chat's title, then checked to stick.
  private nameNewDesignProject = async (request: {
    readonly projectId: string;
    readonly name: string;
  }): Promise<void> => {
    const deadline = Date.now() + TITLE_WAIT_MILLISECONDS;
    while (Date.now() < deadline) {
      const { document } = await this.readProjectDocument(request.projectId);
      if (hasGeneratedTitle(document)) break;

      await this.page.waitForTimeout(TURN_POLL_MILLISECONDS);
    }
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      await this.projects.renameDesignProject(request);
      await this.page.waitForTimeout(NAME_SETTLE_MILLISECONDS);

      const hasProjectName =
        (await this.projects.readDesignProject(request.projectId)).name === request.name;
      if (hasProjectName) return;
    }
    throw new Error(
      `Claude Design: project ${request.projectId} kept its generated name instead of "${request.name}".`,
    );
  };

  // A new project starts from the home composer, where templates live.
  private createDesignProjectFromPrompt = async (
    request: DesignTurnSettings & {
      readonly prompt: string;
      readonly name: string | undefined;
      readonly template: string | undefined;
    },
  ): Promise<DesignTurnReport> => {
    const homeTab = await this.tabs.openDesignHomeTab();

    const hasTemplate = request.template != null;
    if (hasTemplate) await new DesignComposer(homeTab).chooseDesignTemplate(request.template);

    const model = await new DesignComposer(homeTab).chooseDesignModel({
      model: request.model,
      effort: request.effort,
    });
    await new DesignComposer(homeTab).attachDesignFiles(request.attachments);
    await new DesignComposer(homeTab).typeIntoDesignComposer({
      selector: DESIGN_SELECTORS.homeComposer,
      text: request.prompt,
      append: request.template != null,
    });
    await homeTab.locator(DESIGN_SELECTORS.homeSend).click();
    await homeTab.waitForURL((url) => readProjectIdFromDesignUrl(url.href) != null, {
      timeout: PROJECT_URL_WAIT_MILLISECONDS,
    });
    const homeTabUrl = homeTab.url();
    const projectId = readProjectIdFromDesignUrl(homeTabUrl);

    const isProjectIdMissing = projectId == null;
    if (isProjectIdMissing) throw new Error("Claude Design: the new project did not open.");

    const turn = {
      projectId,
      conversationId: undefined,
      messageCount: 0,
      model,
      autoDecide: request.autoDecide,
      timeoutMilliseconds: request.timeoutMilliseconds,
    };
    let turnReport = readRunningTurn(turn);

    const isWait = request.wait;
    if (isWait) turnReport = await new DesignConversation(homeTab).waitForDesignTurn(turn);

    const hasName = request.name != null;
    if (hasName) await this.nameNewDesignProject({ projectId, name: request.name });

    return turnReport;
  };

  // With a prompt the project starts from the home composer; without one it is created over RPC.
  createDesignProject = async (request: DesignProjectCreation): Promise<DesignTurnReport> => {
    const isPromptMissing = request.prompt == null;
    if (isPromptMissing) {
      const hasTemplate = request.template != null;
      if (hasTemplate) {
        throw new Error("Claude Design: a template needs a prompt — templates start a first turn.");
      }

      let name = "Untitled";

      const hasName = request.name != null;
      if (hasName) name = request.name;

      const project = await this.projects.createBlankDesignProject({
        name,
        designSystemIds: request.designSystemIds,
      });
      return {
        projectId: project.id,
        conversationId: undefined,
        status: REPLIED_STATUS,
        model: undefined,
        messages: [],
      };
    }

    const hasDesignSystemIds = request.designSystemIds != null;
    if (hasDesignSystemIds) {
      throw new Error(
        "Claude Design: choose design systems on a blank project (create without a prompt), then send.",
      );
    }

    return this.createDesignProjectFromPrompt({ ...request, prompt: request.prompt });
  };
}

type DesignChat = DesignProjectDocument["chats"][string];

function readConversationSummary(
  chat: DesignChat,
  request: { readonly activeId: string | undefined; readonly open: boolean },
): DesignConversationSummary {
  const chatTitle = chat.title;
  const hasChatTitle = chatTitle != null && chatTitle.length > 0;
  const title = hasChatTitle ? chatTitle : DEFAULT_CHAT_TITLE;

  return {
    id: chat.id,
    title,
    messageCount: chat.messages.length,
    lastOpened: chat.lastOpened,
    active: chat.id === request.activeId,
    open: request.open,
  };
}

function readDesignMessage(message: DesignChat["messages"][number]): DesignMessage {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content ?? "",
    timestamp: message.timestamp,
  };
}

function findChat(
  document: DesignProjectDocument,
  conversationId: string | undefined,
): DesignChat | undefined {
  const chatId = conversationId ?? document.viewState?.activeChatId;

  const isChatIdMissing = chatId == null;
  if (isChatIdMissing) return Object.values(document.chats).at(-1);

  const openChat = document.chats[chatId];

  const hasOpenChat = openChat != null;
  if (hasOpenChat) return openChat;

  return document.closedChats.find((chat) => chat.id === chatId);
}

// Writes go through the raw document so unmodeled fields survive; expectedVersion blocks overwrites.
const EditableChatSchema = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  titleIsGenerated: z.boolean().optional(),
});

const EditableProjectDocumentSchema = z.looseObject({
  chats: z.record(z.string(), EditableChatSchema),
  closedChats: z.array(EditableChatSchema).default([]),
  viewState: z.looseObject({ activeChatId: z.string().optional() }).optional(),
});

type EditableProjectDocument = z.infer<typeof EditableProjectDocumentSchema>;

type EditableChat = EditableProjectDocument["closedChats"][number];

function requireClosedConversation(
  document: EditableProjectDocument,
  request: { readonly projectId: string; readonly conversationId: string },
): EditableChat {
  const chat = document.closedChats.find((closed) => closed.id === request.conversationId);

  const isChatMissing = chat == null;
  if (isChatMissing) {
    throw new Error(
      `Claude Design project ${request.projectId} has no conversation ${request.conversationId}.`,
    );
  }

  return chat;
}

function readRunningTurn(turn: {
  readonly projectId: string;
  readonly conversationId: string | undefined;
  readonly model: string | undefined;
}): DesignTurnReport {
  return {
    projectId: turn.projectId,
    conversationId: turn.conversationId,
    status: RUNNING_STATUS,
    model: turn.model,
    messages: [],
  };
}

function hasGeneratedTitle(document: DesignProjectDocument): boolean {
  return Object.values(document.chats).some(
    (chat) => chat.title != null && chat.title.length > 0 && chat.title !== DEFAULT_CHAT_TITLE,
  );
}

export type DesignProjectCreation = DesignTurnSettings & {
  readonly name: string | undefined;
  readonly prompt: string | undefined;
  readonly template: string | undefined;
  readonly designSystemIds: readonly string[] | undefined;
};
