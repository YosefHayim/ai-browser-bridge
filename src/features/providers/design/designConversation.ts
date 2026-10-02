import { Schema } from "effect";
import type { Page } from "playwright";
import {
  attachDesignFiles,
  chooseDesignModel,
  chooseDesignTemplate,
  closeDesignMenus,
  typeIntoDesignComposer,
} from "./designComposer.ts";
import {
  createBlankDesignProject,
  readDesignProject,
  renameDesignProject,
  setDesignProjectDesignSystems,
} from "./designProjects.ts";
import {
  callDesignRpc,
  type DesignProjectDocument,
  ProjectDataReplySchema,
  projectDocumentFromBase64,
  projectIdFromDesignUrl,
} from "./designRpc.ts";
import {
  assertDesignProjectIdle,
  DESIGN_SELECTORS,
  designProjectTabs,
  isDesignTabBusy,
  openDesignHomeTab,
  openDesignProjectTab,
} from "./designTabs.ts";

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

export const DESIGN_TURN_STATUSES = ["replied", "running", "waiting-for-answer"] as const;
export type DesignTurnStatus = (typeof DESIGN_TURN_STATUSES)[number];

export type DesignTurnOutcome = {
  readonly projectId: string;
  readonly conversationId: string | undefined;
  readonly status: DesignTurnStatus;
  readonly model: string | undefined;
  readonly messages: readonly DesignMessage[];
};

export type DesignTurnOptions = {
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
    replySchema: ProjectDataReplySchema,
  });
  if (reply.data === undefined || reply.data.length === 0) {
    return { document: { chats: {}, closedChats: [] }, version: reply.version };
  }
  return { document: projectDocumentFromBase64(reply.data), version: reply.version };
};

type DesignChat = DesignProjectDocument["chats"][string];

const conversationSummary = (
  chat: DesignChat,
  input: { readonly activeId: string | undefined; readonly open: boolean },
): DesignConversationSummary => {
  let title = "Chat";
  if (chat.title !== undefined && chat.title.length > 0) title = chat.title;
  return {
    id: chat.id,
    title,
    messageCount: chat.messages.length,
    lastOpened: chat.lastOpened,
    active: chat.id === input.activeId,
    open: input.open,
  };
};

const designMessage = (message: DesignChat["messages"][number]): DesignMessage => {
  let content = "";
  if (message.content !== undefined) content = message.content;
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content,
    timestamp: message.timestamp,
  };
};

const chatFor = (
  document: DesignProjectDocument,
  conversationId: string | undefined,
): DesignChat | undefined => {
  let chatId = conversationId;
  if (chatId === undefined) chatId = document.viewState?.activeChatId;
  if (chatId === undefined) return Object.values(document.chats).at(-1);
  const openChat = document.chats[chatId];
  if (openChat !== undefined) return openChat;
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
      conversationSummary(chat, { activeId, open: true }),
    ),
    ...document.closedChats.map((chat) => conversationSummary(chat, { activeId, open: false })),
  ];
};

export const readDesignConversation = async (
  page: Page,
  input: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly limit: number;
  },
): Promise<DesignConversationRead> => {
  const { document } = await readProjectDocument(page, input.projectId);
  const chat = chatFor(document, input.conversationId);
  if (chat === undefined) {
    throw new Error(`Claude Design project ${input.projectId} has no such conversation.`);
  }
  return {
    projectId: input.projectId,
    conversation: conversationSummary(chat, {
      activeId: document.viewState?.activeChatId,
      open: document.chats[chat.id] !== undefined,
    }),
    messages: chat.messages.slice(-input.limit).map(designMessage),
  };
};

export const readActiveDesignMessages = async (
  page: Page,
  projectId: string,
): Promise<DesignMessage[]> => {
  const { document } = await readProjectDocument(page, projectId);
  const chat = chatFor(document, undefined);
  if (chat === undefined) return [];
  return chat.messages.map(designMessage);
};

// Edits go through the raw document so fields this schema does not model survive the
// write; expectedVersion makes a concurrent app save fail instead of being overwritten.
const EditableChatSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  titleIsGenerated: Schema.optional(Schema.Boolean),
});

const EditableProjectDocumentSchema = Schema.parseJson(
  Schema.Struct({
    chats: Schema.Record({ key: Schema.String, value: EditableChatSchema }),
    closedChats: Schema.optionalWith(Schema.Array(EditableChatSchema), { default: () => [] }),
    viewState: Schema.optional(Schema.Struct({ activeChatId: Schema.optional(Schema.String) })),
  }),
);

type EditableProjectDocument = typeof EditableProjectDocumentSchema.Type;

const editProjectDocument = async (
  page: Page,
  input: {
    readonly projectId: string;
    readonly edit: (document: EditableProjectDocument) => EditableProjectDocument;
  },
): Promise<void> => {
  await assertDesignProjectIdle(page, input.projectId);
  const reply = await callDesignRpc({
    page,
    method: "GetProjectData",
    body: { projectId: input.projectId },
    replySchema: ProjectDataReplySchema,
  });
  if (reply.data === undefined) {
    throw new Error(`Claude Design project ${input.projectId} has no conversations yet.`);
  }
  const document = Schema.decodeUnknownSync(EditableProjectDocumentSchema, {
    onExcessProperty: "preserve",
  })(Buffer.from(reply.data, "base64").toString("utf8"));
  const edited = input.edit(document);
  await callDesignRpc({
    page,
    method: "UpdateProjectData",
    body: {
      projectId: input.projectId,
      data: Buffer.from(JSON.stringify(edited), "utf8").toString("base64"),
      expectedVersion: reply.version,
    },
    replySchema: ProjectDataReplySchema,
  });
  // An open tab still holds the old document; reload it so its next save builds on ours.
  await Promise.all(
    designProjectTabs(page, input.projectId).map((projectTab) =>
      projectTab.reload({ waitUntil: "domcontentloaded" }),
    ),
  );
};

type EditableChat = EditableProjectDocument["closedChats"][number];

const requireClosedConversation = (
  document: EditableProjectDocument,
  input: { readonly projectId: string; readonly conversationId: string },
): EditableChat => {
  const chat = document.closedChats.find((closed) => closed.id === input.conversationId);
  if (chat === undefined) {
    throw new Error(
      `Claude Design project ${input.projectId} has no conversation ${input.conversationId}.`,
    );
  }
  return chat;
};

// The app has no rename control for a Conversation; it writes chat titles the same way.
export const renameDesignConversation = async (
  page: Page,
  input: { readonly projectId: string; readonly conversationId: string; readonly title: string },
): Promise<void> => {
  const renamed = { title: input.title, titleIsGenerated: false };
  await editProjectDocument(page, {
    projectId: input.projectId,
    edit: (document) => {
      const openChat = document.chats[input.conversationId];
      if (openChat !== undefined) {
        return {
          ...document,
          chats: { ...document.chats, [input.conversationId]: { ...openChat, ...renamed } },
        };
      }
      requireClosedConversation(document, input);
      return {
        ...document,
        closedChats: document.closedChats.map((closed) => {
          if (closed.id !== input.conversationId) return closed;
          return { ...closed, ...renamed };
        }),
      };
    },
  });
};

// A closed Conversation reopens beside the open ones, as picking it in the history does.
export const activateDesignConversation = async (
  page: Page,
  input: { readonly projectId: string; readonly conversationId: string },
): Promise<void> => {
  const { document } = await readProjectDocument(page, input.projectId);
  if (document.viewState?.activeChatId === input.conversationId) return;
  await editProjectDocument(page, {
    projectId: input.projectId,
    edit: (editable) => {
      const viewState = { ...editable.viewState, activeChatId: input.conversationId };
      if (editable.chats[input.conversationId] !== undefined) return { ...editable, viewState };
      const closedChat = requireClosedConversation(editable, input);
      return {
        ...editable,
        chats: { ...editable.chats, [input.conversationId]: closedChat },
        closedChats: editable.closedChats.filter((closed) => closed.id !== input.conversationId),
        viewState,
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
    if (created !== undefined) return created;
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
    if (await isButtonVisible(page, name)) {
      await page.getByRole("button", { name }).first().click();
    }
  }
};

const turnMessages = async (
  page: Page,
  input: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
  },
) => {
  const { document } = await readProjectDocument(page, input.projectId);
  const chat = chatFor(document, input.conversationId);
  if (chat === undefined) return { conversationId: input.conversationId, messages: [] };
  return { conversationId: chat.id, messages: chat.messages.slice(input.messageCount) };
};

// The turn's agent loop runs inside its tab, so the turn stops when that tab goes away.
const pauseOnTurnTab = async (page: Page, projectId: string): Promise<void> => {
  try {
    await page.waitForTimeout(TURN_POLL_MS);
  } catch (error) {
    if (!page.isClosed()) throw error;
    throw new Error(
      `Claude Design: the tab running the turn in ${projectId} closed, which stops the turn. Check what was saved with \`design read\`.`,
    );
  }
};

// Done means: the stop pill has gone for two polls and the reply is saved in the project.
// Text stability is not enough — the agent pauses between tool steps.
export const waitForDesignTurn = async (
  page: Page,
  input: {
    readonly projectId: string;
    readonly conversationId: string | undefined;
    readonly messageCount: number;
    readonly model: string | undefined;
    readonly autoDecide: boolean;
    readonly timeoutMs: number;
  },
): Promise<DesignTurnOutcome> => {
  const startedAt = Date.now();
  let sawRunning = false;
  let idlePolls = 0;
  let latest: { conversationId: string | undefined; messages: DesignChat["messages"] } = {
    conversationId: input.conversationId,
    messages: [],
  };
  const outcome = (status: DesignTurnStatus): DesignTurnOutcome => ({
    projectId: input.projectId,
    conversationId: latest.conversationId,
    status,
    model: input.model,
    messages: latest.messages.map(designMessage),
  });
  while (Date.now() - startedAt < input.timeoutMs) {
    await pauseOnTurnTab(page, input.projectId);
    if (input.autoDecide) await answerDesignQuestion(page);
    if (await isDesignTabBusy(page)) {
      sawRunning = true;
      idlePolls = 0;
      continue;
    }
    idlePolls += 1;
    if (!sawRunning && Date.now() - startedAt < TURN_START_GRACE_MS) continue;
    if (idlePolls < 2) continue;
    if (await isButtonVisible(page, DECIDE_FOR_ME)) return outcome("waiting-for-answer");
    if (await isButtonVisible(page, CONTINUE)) return outcome("waiting-for-answer");
    latest = await turnMessages(page, input);
    if (latest.messages.some((message) => message.role === "assistant")) {
      return outcome("replied");
    }
  }
  latest = await turnMessages(page, input);
  return outcome("running");
};

const runningTurn = (turn: {
  readonly projectId: string;
  readonly conversationId: string | undefined;
  readonly model: string | undefined;
}): DesignTurnOutcome => ({
  projectId: turn.projectId,
  conversationId: turn.conversationId,
  status: "running",
  model: turn.model,
  messages: [],
});

export const sendDesignMessage = async (
  page: Page,
  input: DesignTurnOptions & {
    readonly projectId: string;
    readonly message: string;
    readonly conversationId: string | undefined;
    readonly designSystemIds: readonly string[] | undefined;
  },
): Promise<DesignTurnOutcome> => {
  await assertDesignProjectIdle(page, input.projectId);
  if (input.designSystemIds !== undefined) {
    await setDesignProjectDesignSystems(page, {
      projectId: input.projectId,
      designSystemIds: input.designSystemIds,
    });
  }
  if (input.conversationId !== undefined) {
    await activateDesignConversation(page, {
      projectId: input.projectId,
      conversationId: input.conversationId,
    });
  }
  const projectTab = await openDesignProjectTab(page, input.projectId);
  const model = await chooseDesignModel(projectTab, { model: input.model, effort: input.effort });
  await attachDesignFiles(projectTab, input.attachments);
  const before = await turnMessages(page, {
    projectId: input.projectId,
    conversationId: input.conversationId,
    messageCount: 0,
  });
  await typeIntoDesignComposer(projectTab, {
    selector: DESIGN_SELECTORS.chatComposer,
    text: input.message,
    append: false,
  });
  await projectTab.locator(DESIGN_SELECTORS.chatSend).click();
  const turn = {
    projectId: input.projectId,
    conversationId: before.conversationId,
    messageCount: before.messages.length,
    model,
    autoDecide: input.autoDecide,
    timeoutMs: input.timeoutMs,
  };
  if (!input.wait) return runningTurn(turn);
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
  input: { readonly projectId: string; readonly name: string },
): Promise<void> => {
  const deadline = Date.now() + TITLE_WAIT_MS;
  while (Date.now() < deadline) {
    const { document } = await readProjectDocument(page, input.projectId);
    if (hasGeneratedTitle(document)) break;
    await page.waitForTimeout(TURN_POLL_MS);
  }
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    await renameDesignProject(page, input);
    await page.waitForTimeout(NAME_SETTLE_MS);
    if ((await readDesignProject(page, input.projectId)).name === input.name) return;
  }
  throw new Error(
    `Claude Design: project ${input.projectId} kept its generated name instead of "${input.name}".`,
  );
};

// A new project starts from the home composer, where templates live.
export const createDesignProjectFromPrompt = async (
  page: Page,
  input: DesignTurnOptions & {
    readonly prompt: string;
    readonly name: string | undefined;
    readonly template: string | undefined;
  },
): Promise<DesignTurnOutcome> => {
  const homeTab = await openDesignHomeTab(page);
  if (input.template !== undefined) await chooseDesignTemplate(homeTab, input.template);
  const model = await chooseDesignModel(homeTab, { model: input.model, effort: input.effort });
  await attachDesignFiles(homeTab, input.attachments);
  await typeIntoDesignComposer(homeTab, {
    selector: DESIGN_SELECTORS.homeComposer,
    text: input.prompt,
    append: input.template !== undefined,
  });
  await homeTab.locator(DESIGN_SELECTORS.homeSend).click();
  await homeTab.waitForURL((url) => projectIdFromDesignUrl(url.href) !== undefined, {
    timeout: PROJECT_URL_WAIT_MS,
  });
  const projectId = projectIdFromDesignUrl(homeTab.url());
  if (projectId === undefined) throw new Error("Claude Design: the new project did not open.");
  const turn = {
    projectId,
    conversationId: undefined,
    messageCount: 0,
    model,
    autoDecide: input.autoDecide,
    timeoutMs: input.timeoutMs,
  };
  let outcome = runningTurn(turn);
  if (input.wait) outcome = await waitForDesignTurn(homeTab, turn);
  if (input.name !== undefined) await nameNewDesignProject(page, { projectId, name: input.name });
  return outcome;
};

export type DesignProjectCreation = DesignTurnOptions & {
  readonly name: string | undefined;
  readonly prompt: string | undefined;
  readonly template: string | undefined;
  readonly designSystemIds: readonly string[] | undefined;
};

// With a prompt the project starts from the home composer (templates, model, a first
// turn); without one it is created blank over RPC.
export const createDesignProject = async (
  page: Page,
  input: DesignProjectCreation,
): Promise<DesignTurnOutcome> => {
  if (input.prompt === undefined) {
    if (input.template !== undefined) {
      throw new Error("Claude Design: a template needs a prompt — templates start a first turn.");
    }
    let name = "Untitled";
    if (input.name !== undefined) name = input.name;
    const project = await createBlankDesignProject(page, {
      name,
      designSystemIds: input.designSystemIds,
    });
    return {
      projectId: project.id,
      conversationId: undefined,
      status: "replied",
      model: undefined,
      messages: [],
    };
  }
  if (input.designSystemIds !== undefined) {
    throw new Error(
      "Claude Design: choose design systems on a blank project (create without a prompt), then send.",
    );
  }
  return createDesignProjectFromPrompt(page, { ...input, prompt: input.prompt });
};
