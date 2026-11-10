import type { Page } from "playwright";
import { z } from "zod";
import {
  attachDesignFiles,
  chooseDesignModel,
  chooseDesignTemplate,
  closeDesignMenus,
  typeIntoDesignComposer,
} from "./design-composer.ts";
import {
  createBlankDesignProject,
  readDesignProject,
  renameDesignProject,
  setDesignProjectDesignSystems,
} from "./design-projects.ts";
import {
  callDesignRpc,
  type DesignProjectDocument,
  ProjectDetailsReplySchema,
  readProjectDocumentFromBase64,
  readProjectIdFromDesignUrl,
} from "./design-rpc.ts";
import {
  assertDesignProjectIdle,
  DESIGN_SELECTORS,
  isDesignTabBusy,
  listDesignProjectTabs,
  openDesignHomeTab,
  openDesignProjectTab,
} from "./design-tabs.ts";

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

const DESIGN_TURN_STATUSES = ["replied", "running", "waiting-for-answer"] as const;
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
  readonly timeoutMs: number;
};

const TURN_POLL_MS = 2_000;
const TURN_START_GRACE_MS = 30_000;
const PROJECT_URL_WAIT_MS = 60_000;
const PERSIST_WAIT_MS = 30_000;
const TITLE_WAIT_MS = 90_000;
const NAME_SETTLE_MS = 3_000;
const NAME_ATTEMPTS = 3;
const DECIDE_FOR_ME = /^Decide for me$/i;
const CONTINUE = /^Continue$/i;

type ProjectDocumentSnapshot = {
  readonly document: DesignProjectDocument;
  readonly version: string | undefined;
};

const readProjectDocument = async (
  page: Page,
  projectId: string,
): Promise<ProjectDocumentSnapshot> => {
  const reply = await callDesignRpc({
    page,
    method: "GetProjectData",
    body: { projectId },
    replySchema: ProjectDetailsReplySchema,
  });
  const isReplyBlank = reply.data === undefined || reply.data.length === 0;
  if (isReplyBlank) {
    return { document: { chats: {}, closedChats: [] }, version: reply.version };
  }

  return { document: readProjectDocumentFromBase64(reply.data), version: reply.version };
};

type DesignChat = DesignProjectDocument["chats"][string];

const readConversationSummary = (
  chat: DesignChat,
  request: { readonly activeId: string | undefined; readonly open: boolean },
): DesignConversationSummary => {
  let title = "Chat";
  const hasChatTitle = chat.title !== undefined && chat.title.length > 0;
  if (hasChatTitle) title = chat.title;

  return {
    id: chat.id,
    title,
    messageCount: chat.messages.length,
    lastOpened: chat.lastOpened,
    active: chat.id === request.activeId,
    open: request.open,
  };
};

const readDesignMessage = (message: DesignChat["messages"][number]): DesignMessage => {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content ?? "",
    timestamp: message.timestamp,
  };
};

const findChat = (
  document: DesignProjectDocument,
  conversationId: string | undefined,
): DesignChat | undefined => {
  let chatId = conversationId;

  const isChatIdMissing = chatId === undefined;
  if (isChatIdMissing) chatId = document.viewState?.activeChatId;

  if (chatId === undefined) return Object.values(document.chats).at(-1);

  const openChat = document.chats[chatId];

  const hasOpenChat = openChat !== undefined;
  if (hasOpenChat) return openChat;

  return document.closedChats.find((chat) => chat.id === chatId);
};

export const listDesignConversations = async (
  page: Page,
  projectId: string,
): Promise<DesignConversationSummary[]> => {
  const { document } = await readProjectDocument(page, projectId);
  const activeId = document.viewState?.activeChatId;
  return [
    ...Object.values(document.chats).map((chat) =>
      readConversationSummary(chat, { activeId, open: true }),
    ),
    ...document.closedChats.map((chat) => readConversationSummary(chat, { activeId, open: false })),
  ];
};

export const readDesignConversation = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly limit: number;
  },
): Promise<DesignConversationRead> => {
  const { document } = await readProjectDocument(page, request.projectId);
  const chat = findChat(document, request.conversationId);

  const isChatMissing = chat === undefined;
  if (isChatMissing) {
    throw new Error(`Claude Design project ${request.projectId} has no such conversation.`);
  }

  return {
    projectId: request.projectId,
    conversation: readConversationSummary(chat, {
      activeId: document.viewState?.activeChatId,
      open: document.chats[chat.id] !== undefined,
    }),
    messages: chat.messages.slice(-request.limit).map(readDesignMessage),
  };
};

export const readActiveDesignMessages = async (
  page: Page,
  projectId: string,
): Promise<DesignMessage[]> => {
  const { document } = await readProjectDocument(page, projectId);
  const chat = findChat(document, undefined);

  const isChatMissing = chat === undefined;
  if (isChatMissing) return [];

  return chat.messages.map(readDesignMessage);
};

// Edits go through the raw document so fields this schema does not model survive the
// write; expectedVersion makes a concurrent app save fail instead of being overwritten.
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

const editProjectDocument = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly edit: (document: EditableProjectDocument) => EditableProjectDocument;
  },
): Promise<void> => {
  await assertDesignProjectIdle(page, request.projectId);

  const reply = await callDesignRpc({
    page,
    method: "GetProjectData",
    body: { projectId: request.projectId },
    replySchema: ProjectDetailsReplySchema,
  });
  const isReplyMissing = reply.data === undefined;
  if (isReplyMissing) {
    throw new Error(`Claude Design project ${request.projectId} has no conversations yet.`);
  }

  const decodedDocument = Buffer.from(reply.data, "base64").toString("utf8");
  const document = EditableProjectDocumentSchema.parse(JSON.parse(decodedDocument));
  const edited = request.edit(document);
  await callDesignRpc({
    page,
    method: "UpdateProjectData",
    body: {
      projectId: request.projectId,
      data: Buffer.from(JSON.stringify(edited), "utf8").toString("base64"),
      expectedVersion: reply.version,
    },
    replySchema: ProjectDetailsReplySchema,
  });
  // An open tab still holds the old document; reload it so its next save builds on ours.
  await Promise.all(
    listDesignProjectTabs(page, request.projectId).map((projectTab) =>
      projectTab.reload({ waitUntil: "domcontentloaded" }),
    ),
  );
};

type EditableChat = EditableProjectDocument["closedChats"][number];

const requireClosedConversation = (
  document: EditableProjectDocument,
  request: { readonly projectId: string; readonly conversationId: string },
): EditableChat => {
  const chat = document.closedChats.find((closed) => closed.id === request.conversationId);

  const isChatMissing = chat === undefined;
  if (isChatMissing) {
    throw new Error(
      `Claude Design project ${request.projectId} has no conversation ${request.conversationId}.`,
    );
  }

  return chat;
};

// The app has no rename control for a Conversation; it writes chat titles the same way.
export const renameDesignConversation = async (
  page: Page,
  request: { readonly projectId: string; readonly conversationId: string; readonly title: string },
): Promise<void> => {
  const renamed = { title: request.title, titleIsGenerated: false };
  await editProjectDocument(page, {
    projectId: request.projectId,
    edit: (document) => {
      const openChat = document.chats[request.conversationId];

      const hasOpenChat = openChat !== undefined;
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
export const activateDesignConversation = async (
  page: Page,
  request: { readonly projectId: string; readonly conversationId: string },
): Promise<void> => {
  const { document } = await readProjectDocument(page, request.projectId);
  const isConversationActive = document.viewState?.activeChatId === request.conversationId;
  if (isConversationActive) return;

  await editProjectDocument(page, {
    projectId: request.projectId,
    edit: (editable) => {
      const viewStatus = { ...editable.viewState, activeChatId: request.conversationId };

      if (editable.chats[request.conversationId] !== undefined)
        return { ...editable, viewState: viewStatus };

      const closedChat = requireClosedConversation(editable, request);
      return {
        ...editable,
        chats: { ...editable.chats, [request.conversationId]: closedChat },
        closedChats: editable.closedChats.filter((closed) => closed.id !== request.conversationId),
        viewState: viewStatus,
      };
    },
  });
};

export const startNewDesignConversation = async (
  page: Page,
  projectId: string,
): Promise<string> => {
  await assertDesignProjectIdle(page, projectId);
  const before = await readProjectDocument(page, projectId);
  const knownIds = new Set([
    ...Object.keys(before.document.chats),
    ...before.document.closedChats.map((chat) => chat.id),
  ]);
  const projectTab = await openDesignProjectTab(page, projectId);
  await closeDesignMenus(projectTab);
  await projectTab.locator(DESIGN_SELECTORS.chatHistory).click();
  await projectTab
    .locator(`${DESIGN_SELECTORS.menu} button`)
    .filter({ hasText: "New chat" })
    .first()
    .click();
  const deadline = Date.now() + PERSIST_WAIT_MS;
  while (Date.now() < deadline) {
    await projectTab.waitForTimeout(TURN_POLL_MS);
    const { document } = await readProjectDocument(page, projectId);
    const created = Object.keys(document.chats).find((chatId) => !knownIds.has(chatId));

    const hasCreated = created !== undefined;
    if (hasCreated) return created;
  }
  throw new Error(`Claude Design: the new conversation in ${projectId} was not saved in time.`);
};

const isButtonVisible = async (page: Page, name: RegExp): Promise<boolean> => {
  return page
    .getByRole("button", { name })
    .first()
    .isVisible()
    .catch(() => false);
};

const answerDesignQuestion = async (page: Page): Promise<void> => {
  for (const name of [DECIDE_FOR_ME, CONTINUE]) {
    const hasVisibleButton = await isButtonVisible(page, name);
    if (hasVisibleButton) {
      await page.getByRole("button", { name }).first().click();
    }
  }
};

const turnMessages = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
  },
) => {
  const { document } = await readProjectDocument(page, request.projectId);
  const chat = findChat(document, request.conversationId);

  const isChatMissing = chat === undefined;
  if (isChatMissing) return { conversationId: request.conversationId, messages: [] };

  return { conversationId: chat.id, messages: chat.messages.slice(request.messageCount) };
};

// The turn's agent loop runs inside its tab, so the turn stops when that tab goes away.
const pauseOnTurnTab = async (page: Page, projectId: string): Promise<void> => {
  try {
    await page.waitForTimeout(TURN_POLL_MS);
  } catch (error) {
    const isNotClosedPage = !page.isClosed();
    if (isNotClosedPage) throw error;

    throw new Error(
      `Claude Design: the tab running the turn in ${projectId} closed, which stops the turn. Check what was saved with \`design read\`.`,
    );
  }
};

// Done means: the stop pill has gone for two polls and the reply is saved in the project.
// Text stability is not enough — the agent pauses between tool steps.
export const waitForDesignTurn = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
    readonly model: string | undefined;
    readonly autoDecide: boolean;
    readonly timeoutMs: number;
  },
): Promise<DesignTurnReport> => {
  const startedAt = Date.now();
  let sawRunning = false;
  let idlePolls = 0;
  let latest: { conversationId: string | undefined; messages: DesignChat["messages"] } = {
    conversationId: request.conversationId,
    messages: [],
  };
  const createTurnReport = (status: DesignTurnStatus): DesignTurnReport => ({
    projectId: request.projectId,
    conversationId: latest.conversationId,
    status,
    model: request.model,
    messages: latest.messages.map(readDesignMessage),
  });
  while (Date.now() - startedAt < request.timeoutMs) {
    await pauseOnTurnTab(page, request.projectId);

    if (request.autoDecide) await answerDesignQuestion(page);

    const hasBusyDesignTab = await isDesignTabBusy(page);
    if (hasBusyDesignTab) {
      sawRunning = true;
      idlePolls = 0;
      continue;
    }

    idlePolls += 1;

    const isWithinTurnStartGrace = !sawRunning && Date.now() - startedAt < TURN_START_GRACE_MS;
    if (isWithinTurnStartGrace) continue;

    const isNotYetSettled = idlePolls < 2;
    if (isNotYetSettled) continue;

    const hasVisibleDecideButton = await isButtonVisible(page, DECIDE_FOR_ME);
    if (hasVisibleDecideButton) return createTurnReport("waiting-for-answer");

    const hasVisibleContinueButton = await isButtonVisible(page, CONTINUE);
    if (hasVisibleContinueButton) return createTurnReport("waiting-for-answer");

    latest = await turnMessages(page, request);

    const hasAssistantMessage = latest.messages.some((message) => message.role === "assistant");
    if (hasAssistantMessage) {
      return createTurnReport("replied");
    }
  }
  latest = await turnMessages(page, request);
  return createTurnReport("running");
};

const readRunningTurn = (turn: {
  readonly projectId: string;
  readonly conversationId: string | undefined;
  readonly model: string | undefined;
}): DesignTurnReport => ({
  projectId: turn.projectId,
  conversationId: turn.conversationId,
  status: "running",
  model: turn.model,
  messages: [],
});

export const sendDesignMessage = async (
  page: Page,
  request: DesignTurnSettings & {
    readonly projectId: string;
    readonly message: string;
    readonly conversationId: string | undefined;
    readonly designSystemIds: readonly string[] | undefined;
  },
): Promise<DesignTurnReport> => {
  await assertDesignProjectIdle(page, request.projectId);

  const hasDesignSystemIds = request.designSystemIds !== undefined;
  if (hasDesignSystemIds) {
    await setDesignProjectDesignSystems(page, {
      projectId: request.projectId,
      designSystemIds: request.designSystemIds,
    });
  }

  const hasConversationId = request.conversationId !== undefined;
  if (hasConversationId) {
    await activateDesignConversation(page, {
      projectId: request.projectId,
      conversationId: request.conversationId,
    });
  }

  const projectTab = await openDesignProjectTab(page, request.projectId);
  const model = await chooseDesignModel(projectTab, {
    model: request.model,
    effort: request.effort,
  });
  await attachDesignFiles(projectTab, request.attachments);
  const before = await turnMessages(page, {
    projectId: request.projectId,
    conversationId: request.conversationId,
    messageCount: 0,
  });
  await typeIntoDesignComposer(projectTab, {
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
    timeoutMs: request.timeoutMs,
  };

  const isNotWait = !request.wait;
  if (isNotWait) return readRunningTurn(turn);

  return waitForDesignTurn(projectTab, turn);
};

const hasGeneratedTitle = (document: DesignProjectDocument): boolean => {
  return Object.values(document.chats).some(
    (chat) => chat.title !== undefined && chat.title.length > 0 && chat.title !== "Chat",
  );
};

// Claude names a new project after its first Conversation's generated title, replacing any
// name set before that, so the requested name goes on afterwards and is checked to stick.
const nameNewDesignProject = async (
  page: Page,
  request: { readonly projectId: string; readonly name: string },
): Promise<void> => {
  const deadline = Date.now() + TITLE_WAIT_MS;
  while (Date.now() < deadline) {
    const { document } = await readProjectDocument(page, request.projectId);
    if (hasGeneratedTitle(document)) break;

    await page.waitForTimeout(TURN_POLL_MS);
  }
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    await renameDesignProject(page, request);
    await page.waitForTimeout(NAME_SETTLE_MS);

    const hasProjectName = (await readDesignProject(page, request.projectId)).name === request.name;
    if (hasProjectName) return;
  }
  throw new Error(
    `Claude Design: project ${request.projectId} kept its generated name instead of "${request.name}".`,
  );
};

// A new project starts from the home composer, where templates live.
const createDesignProjectFromPrompt = async (
  page: Page,
  request: DesignTurnSettings & {
    readonly prompt: string;
    readonly name: string | undefined;
    readonly template: string | undefined;
  },
): Promise<DesignTurnReport> => {
  const homeTab = await openDesignHomeTab(page);

  const hasTemplate = request.template !== undefined;
  if (hasTemplate) await chooseDesignTemplate(homeTab, request.template);

  const model = await chooseDesignModel(homeTab, { model: request.model, effort: request.effort });
  await attachDesignFiles(homeTab, request.attachments);
  await typeIntoDesignComposer(homeTab, {
    selector: DESIGN_SELECTORS.homeComposer,
    text: request.prompt,
    append: request.template !== undefined,
  });
  await homeTab.locator(DESIGN_SELECTORS.homeSend).click();
  await homeTab.waitForURL((url) => readProjectIdFromDesignUrl(url.href) !== undefined, {
    timeout: PROJECT_URL_WAIT_MS,
  });
  const projectId = readProjectIdFromDesignUrl(homeTab.url());

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) throw new Error("Claude Design: the new project did not open.");

  const turn = {
    projectId,
    conversationId: undefined,
    messageCount: 0,
    model,
    autoDecide: request.autoDecide,
    timeoutMs: request.timeoutMs,
  };
  let turnReport = readRunningTurn(turn);

  if (request.wait) turnReport = await waitForDesignTurn(homeTab, turn);

  const hasName = request.name !== undefined;
  if (hasName) await nameNewDesignProject(page, { projectId, name: request.name });

  return turnReport;
};

export type DesignProjectCreation = DesignTurnSettings & {
  readonly name: string | undefined;
  readonly prompt: string | undefined;
  readonly template: string | undefined;
  readonly designSystemIds: readonly string[] | undefined;
};

// With a prompt the project starts from the home composer (templates, model, a first
// turn); without one it is created blank over RPC.
export const createDesignProject = async (
  page: Page,
  request: DesignProjectCreation,
): Promise<DesignTurnReport> => {
  const isPromptMissing = request.prompt === undefined;
  if (isPromptMissing) {
    const hasTemplate = request.template !== undefined;
    if (hasTemplate) {
      throw new Error("Claude Design: a template needs a prompt — templates start a first turn.");
    }

    let name = "Untitled";
    const hasName = request.name !== undefined;
    if (hasName) name = request.name;

    const project = await createBlankDesignProject(page, {
      name,
      designSystemIds: request.designSystemIds,
    });
    return {
      projectId: project.id,
      conversationId: undefined,
      status: "replied",
      model: undefined,
      messages: [],
    };
  }

  const hasDesignSystemIds = request.designSystemIds !== undefined;
  if (hasDesignSystemIds) {
    throw new Error(
      "Claude Design: choose design systems on a blank project (create without a prompt), then send.",
    );
  }

  return createDesignProjectFromPrompt(page, { ...request, prompt: request.prompt });
};
