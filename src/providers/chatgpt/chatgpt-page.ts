import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type APIResponse, errors, type Locator, type Page, type Response } from "playwright";
import { BRIDGE_DIRECTORY_NAME, PROVIDER_SETTINGS, REPO_DIRECTORY_NAME } from "@/config";
import type { Attachment, AttachmentManifest, AttachmentRole } from "@/domain/attachment-types.ts";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/domain/connector-types.ts";
import type { BrowserProvider, CaptureMessagesSettings } from "@/providers/browser-provider.ts";
import {
  logUnlessElementMissing,
  probeOrFallback,
  readVisibleText,
} from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { createStallReloadWatchdog } from "@/providers/render-stall-watchdog.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/streaming-guard.ts";
import {
  ATTACHED_FILE_REMOVE_BUTTON_SELECTOR,
  findVisibleComposer,
  removeComposerAttachments,
} from "./chatgpt-composer.ts";
import {
  isChatGptFileUrl,
  listAttachmentsFromImageRefs,
  listConversationImageRefs,
  readChatGptFileDownloadUrl,
  readConversationReply,
  readFileIdFromChatGptFileUrl,
} from "./chatgpt-conversation-images.ts";
import { searchChatGptConversations } from "./chatgpt-conversation-search.ts";
import {
  isSameChatGptConversation,
  readChatGptConversationIdFromUrl,
  readChatGptConversationUrlFromIdOrUrl,
} from "./chatgpt-conversation-url.ts";
import { readLooseConversations } from "./chatgpt-loose-conversations.ts";

const TWO_SECONDS_MILLISECONDS = 2_000;

const ARIA_LABEL_ATTRIBUTE = "aria-label";

const VISIBLE_WAIT_MODE = "visible";

const FIFTEEN_SECONDS_MILLISECONDS = 15_000;

const FIVE_SECONDS_MILLISECONDS = 5_000;

const CHATGPT_PROVIDER_ID = "chatgpt";

const NETWORK_REPLY_EVENT = "response";

const MODEL_SWITCHER_TEST_ID_PREFIX = "model-switcher-";

const CHATGPT_APP_NAME = "ChatGPT";

const CHATGPT_ORIGIN_URL = "https://chatgpt.com";

const THIRTY_SECONDS_MILLISECONDS = 30_000;

const SPACE = " ";

const CURRENT_STATUS = "current";

const CHATGPT_HOME_URL = "https://chatgpt.com/";

const MISSING_STATUS = "missing";

const CONNECT_BUTTON_SELECTOR = 'button:has-text("Connect")';

const CREATE_BUTTON_SELECTOR = 'button:has-text("Create")';

const DIALOG_BACK_BUTTON_SELECTOR = '[role="dialog"] button:has-text("Back")';

const ONE_AND_HALF_SECONDS_MILLISECONDS = 1_500;

const UNKNOWN_STATUS = "unknown";

const STALE_STATUS = "stale";

const DIALOG_BUTTON_SELECTOR = '[role="dialog"] button';

const QUARTER_SECOND_MILLISECONDS = 250;

const THREE_QUARTER_SECOND_MILLISECONDS = 750;

const HALF_SECOND_MILLISECONDS = 500;

const THREE_SECONDS_MILLISECONDS = 3_000;

const CHATGPT_HOSTNAME = "chatgpt.com";

const TRUST_CHECKBOX_SELECTOR = 'input[data-testid="trust-checkbox"], input[type="checkbox"]';

const NEWLINE = "\n";

const SRC_ATTRIBUTE = "src";

const HREF_ATTRIBUTE = "href";

const DOWNLOAD_ATTRIBUTE = "download";

const LEAF_NODE_TYPE = "text";

const DASH = "-";

const FILE_KIND = "file";

const MISSING_FILE_ERROR_CODE = "ENOENT";

const PDF_KIND = "pdf";

const IMAGE_KIND = "image";

const SLASH = "/";

const UTF8_ENCODING = "utf8";

const BASE64_ENCODING = "base64";

const MIME_PARAMETER_SEPARATOR = ";";

const ASSISTANT_ROLE = "assistant";

const USER_ROLE = "user";

const BLOB_URL_PREFIX = "blob:";

const ADD_FILES_BUTTON_SELECTOR = 'button[aria-label="Add files and more"]';

const LIST_SEPARATOR = ", ";

const JPEG_MIME_TYPE = "image/jpeg";

const PDF_MIME_TYPE = "application/pdf";

const GIF_EXTENSION = ".gif";

const WEBP_EXTENSION = ".webp";

const JPG_EXTENSION = ".jpg";

const PNG_EXTENSION = ".png";

const PDF_EXTENSION = ".pdf";

const EDITOR_SELECTORS = [
  'textarea[name="prompt-textarea"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  "textarea",
] as const;

const SUBMIT_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Submit"]',
  'button[aria-label="Send"]',
  'button[aria-label="Send prompt"]',
  'button:has-text("Save & submit")',
  'button:has-text("Submit")',
  'button:has-text("Update")',
] as const;

const GENERATED_IMAGE_SELECTOR =
  'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]';

// A multi-image reply shows one large preview plus a thumbnail strip holding every image once.
export const LIST_GENERATED_IMAGES_ORIGIN = `
const listGeneratedImagesIn = (scope) => {
  const stripImages = Array.from(scope.querySelectorAll(${JSON.stringify('[role="group"][aria-label="Generated images"] img')}));
  const hasStripImages = stripImages.length > 0;
  if (hasStripImages) return stripImages;
  return Array.from(scope.querySelectorAll(${JSON.stringify(GENERATED_IMAGE_SELECTOR)}));
};
`;

const DOM_SNAPSHOT_HELPERS_ORIGIN = `
${LIST_GENERATED_IMAGES_ORIGIN}

const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';

const UNIT_SELECTOR = '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]';

const hasAssistantUnit = (units) =>
  units.some((unit) => unit.getAttribute("data-content-search-unit-key").endsWith(":assistant"));

const conversationTurns = () => {
  const sections = Array.from(document.querySelectorAll(TURN_SELECTOR));
  if (sections.length > 0) return sections;
  const turns = [];
  for (const keyed of Array.from(document.querySelectorAll("[data-turn-key]"))) {
    const units = Array.from(keyed.querySelectorAll(UNIT_SELECTOR));
    turns.push(...units);
    if (!hasAssistantUnit(units) && listGeneratedImagesIn(keyed).length > 0) turns.push(keyed);
  }
  return turns;
};

const imageScope = (turn) => {
  const unitKey = turn.getAttribute("data-content-search-unit-key");
  if (unitKey === null || !unitKey.endsWith(":assistant")) return turn;
  const keyed = turn.closest("[data-turn-key]");
  return keyed === null ? turn : keyed;
};

const turnRoleBlock = (turn) => {
  const authored = turn.querySelector("[data-message-author-role]");
  if (authored) {
    const authorRole = authored.getAttribute("data-message-author-role");
    return { block: authored, role: authorRole === null ? "unknown" : authorRole };
  }
  const unitKey = turn.getAttribute("data-content-search-unit-key");
  if (unitKey === null) return null;
  if (unitKey.endsWith(":assistant")) {
    const markdown = turn.querySelector('[data-markdown-text-style="assistant-message"]');
    return { block: markdown === null ? turn : markdown, role: "assistant" };
  }
  if (unitKey.endsWith(":user")) {
    const bubble = turn.querySelector("[data-user-message-bubble]");
    return { block: bubble === null ? turn : bubble, role: "user" };
  }
  return null;
};

const serializeMessage = (element, role, messageIndex) => {
  let elementString = "";
  if (element instanceof HTMLElement) {
    elementString = element.innerText;
  } else if (element.textContent !== null) {
    elementString = element.textContent;
  }
  return {
    role,
    messageIndex,
    text,
    root: snapshotNode(element),
  };
};

// A turn holding only a generated image has no role block, so it counts as assistant.
const serializeTurn = (turn, messageIndex) => {
  const roleBlock = turnRoleBlock(turn);
  const generatedImages = listGeneratedImagesIn(imageScope(turn));
  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    let text = "";
    if (turn instanceof HTMLElement) {
      turnString = turn.innerText;
    } else if (turn.textContent !== null) {
      turnString = turn.textContent;
    }
    return {
      role: "assistant",
      messageIndex,
      text: turnString,
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }
  const message = serializeMessage(roleBlock.block, roleBlock.role, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.block.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
};

const turnRole = (turn) => {
  const roleBlock = turnRoleBlock(turn);
  if (roleBlock) return roleBlock.role;
  if (listGeneratedImagesIn(turn).length > 0) return "assistant";
  return null;
};

const snapshotNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent === null ? "" : node.textContent };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return { type: "text", text: "" };
  }
  const element = node;
  const attributes = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  if (element instanceof HTMLImageElement && element.currentSrc) {
    attributes.currentSrc = element.currentSrc;
  }
  return {
    type: "element",
    tagName: element.tagName.toLowerCase(),
    attributes,
    children: Array.from(element.childNodes).map(snapshotNode),
  };
};
`;

const LAST_ASSISTANT_MESSAGE_SNAPSHOT_ORIGIN = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  const turns = conversationTurns();
  let assistantIndex = -1;
  let lastAssistant = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") {
      assistantIndex += 1;
      lastAssistant = serializeTurn(turn, assistantIndex);
    }
  }
  return lastAssistant;
})()
`;

const LAST_ASSISTANT_TURN_STATUS_ORIGIN = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  const countImageMarkers = (text) => {
    const matches = text.match(/\[image-\d+\]/g);
    return matches ? matches.length : 0;
  };
  const turns = conversationTurns();
  let lastAssistantTurn = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") lastAssistantTurn = turn;
  }
  if (!lastAssistantTurn) {
    return { text: "", assetCount: 0, loadedAssetCount: 0, pendingAssetCount: 0, expectedImageMarkerCount: 0 };
  }
  const images = listGeneratedImagesIn(imageScope(lastAssistantTurn));
  let loadedAssetCount = 0;
  let pendingAssetCount = 0;
  for (const node of images) {
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) loadedAssetCount += 1;
      else pendingAssetCount += 1;
    } else {
      pendingAssetCount += 1;
    }
  }
  const roleBlock = turnRoleBlock(lastAssistantTurn);
  let rawString = "";
  if (roleBlock !== null && roleBlock.block instanceof HTMLElement) {
    rawString = roleBlock.block.innerText;
  } else if (lastAssistantTurn.innerText) {
    rawString = lastAssistantTurn.innerText;
  }
  const collapsedString = rawString.replace(/\s+/g, " ").trim();
  return {
    text: collapsedString,
    assetCount: images.length,
    loadedAssetCount,
    pendingAssetCount,
    expectedImageMarkerCount: countImageMarkers(collapsedString),
  };
})()
`;

const ALL_MESSAGES_SNAPSHOT_ORIGIN = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_ORIGIN}
  let assistantIndex = -1;
  let userIndex = -1;
  const messages = [];
  for (const turn of conversationTurns()) {
    const role = turnRole(turn);
    if (role === null) continue;
    if (role === "assistant") assistantIndex += 1;
    if (role === "user") userIndex += 1;
    let turnIndex = -1;
    if (role === "assistant") turnIndex = assistantIndex;
    else if (role === "user") turnIndex = userIndex;
    const message = serializeTurn(turn, turnIndex);
    if (message) messages.push(message);
  }
  return messages;
})()
`;

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": PDF_EXTENSION,
  "image/png": PNG_EXTENSION,
  "image/jpeg": JPG_EXTENSION,
  "image/webp": WEBP_EXTENSION,
  "image/gif": GIF_EXTENSION,
};

const EXTENSION_MIMES = [
  [PDF_EXTENSION, PDF_MIME_TYPE],
  [PNG_EXTENSION, "image/png"],
  [JPG_EXTENSION, JPEG_MIME_TYPE],
  [".jpeg", JPEG_MIME_TYPE],
  [WEBP_EXTENSION, "image/webp"],
  [GIF_EXTENSION, "image/gif"],
] as const;

const BRIDGE_CONNECTOR_PREFIX = "ai-browser-bridge";

const MODEL_LABELS: Record<string, string> = {
  "gpt-5-3": "GPT-5.3 Instant",
  "gpt-5-5-thinking": "GPT-5.5 Thinking",
  "gpt-5-5-pro": "GPT-5.5 Pro",
  "gpt-5-2": "GPT-5.2",
  "gpt-5-2-chat-latest": "GPT-5.2 Chat",
  "gpt-5-1": "GPT-5.1",
  "gpt-5-1-chat-latest": "GPT-5.1 Chat",
  "gpt-5": "GPT-5",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-1": "GPT-4.1",
  "gpt-4": "GPT-4",
  o1: "o1",
  "o1-pro": "o1 Pro",
  "o1-mini": "o1 Mini",
  "o3-mini": "o3 Mini",
};

const SETTLE_QUIET_MS = ONE_AND_HALF_SECONDS_MILLISECONDS;

const ASSET_SETTLE_QUIET_MS = 12_000;

const IMAGE_STALL_QUIET_MS = 45_000;

export const SELECTORS = {
  promptInput: PROVIDER_SETTINGS.chatgpt.selectors.composer,

  sendButton:
    'button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]',

  responseBlock: PROVIDER_SETTINGS.chatgpt.selectors.assistant,

  lastResponse: PROVIDER_SETTINGS.chatgpt.selectors.assistant,

  sidebarConversation: 'nav a[href^="/c/"]',
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(LIST_SEPARATOR),
  generatedImage: GENERATED_IMAGE_SELECTOR,

  modelTrigger: [
    'button[aria-label="Select ChatGPT model"]',
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],

  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',

  userBlock: '[data-message-author-role="user"], [data-user-message-bubble]',

  conversationTurn: '[data-testid^="conversation-turn-"], [data-turn-key]',

  attachmentInput: 'input[type="file"][multiple]:not([accept])',
  attachmentMenuButton: [ADD_FILES_BUTTON_SELECTOR],
  attachmentMenuItem: "Add photos & files",
  attachedFileRemoveButton: ATTACHED_FILE_REMOVE_BUTTON_SELECTOR,

  accountMenuButton: [
    'button[aria-label="Open profile menu"]',
    '[data-testid="accounts-profile-button"]',
    '[role="button"][aria-label*="open profile menu" i]',
    'button[data-testid="profile-button"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
  ],
  guestLoginButton: ['[data-testid="login-button"]', '[data-testid="signup-button"]'],
  settingsEntrypoint: [
    '[role="menuitem"]:has-text("Settings")',
    'button:has-text("Settings")',
    'a:has-text("Settings")',
  ],
} as const;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === "object" && error !== null && "code" in error;
};

const ATTACHED_FILE_WAIT_POLLS = 40;
const ATTACHED_FILE_POLL_MS = HALF_SECOND_MILLISECONDS;

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const chipsBefore = await page.locator(SELECTORS.attachedFileRemoveButton).count();
  const expectedChips = chipsBefore + paths.length;

  const didAttachFiles = await attachFilesViaFileField({ page, paths });

  const isNotAttachedViaFileField = !didAttachFiles;
  if (isNotAttachedViaFileField) await attachFilesViaChooser({ page, paths });

  const isShownInComposer = await waitForAttachedFileChips({ page, expectedChips });
  if (isShownInComposer) return;

  throw new Error("ChatGPT did not show the attached file in the composer.");
};

type WaitForAttachedFileChipsDetails = {
  page: Page;
  expectedChips: number;
};

const waitForAttachedFileChips = async (
  details: WaitForAttachedFileChipsDetails,
): Promise<boolean> => {
  for (let poll = 0; poll < ATTACHED_FILE_WAIT_POLLS; poll += 1) {
    const chipCount = await details.page.locator(SELECTORS.attachedFileRemoveButton).count();

    const hasEveryChip = chipCount >= details.expectedChips;
    if (hasEveryChip) return true;

    await details.page.waitForTimeout(ATTACHED_FILE_POLL_MS);
  }
  return false;
};

type OpenAttachmentFileChooserDetails = {
  page: Page;
};

const openAttachmentFileChooser = async (details: OpenAttachmentFileChooserDetails) => {
  const attachMenuButton = await readFirstVisible({
    page: details.page,
    selectors: SELECTORS.attachmentMenuButton,
  });

  const isAttachMenuButtonMissing = attachMenuButton == null;
  if (isAttachMenuButtonMissing) throw new Error("Could not find ChatGPT attachment control.");

  await attachMenuButton.click();
  const attachFilesElement = details.page
    .getByRole("button", { name: SELECTORS.attachmentMenuItem })
    .filter({ visible: true })
    .first();
  const chooserPromise = details.page.waitForEvent("filechooser", {
    timeout: FIVE_SECONDS_MILLISECONDS,
  });
  const elementClick = attachFilesElement.click();
  const [chooser] = await Promise.all([chooserPromise, elementClick]);
  return chooser;
};

type AttachFilesViaChooserDetails = {
  page: Page;
  paths: string[];
};

const attachFilesViaChooser = async (details: AttachFilesViaChooserDetails): Promise<void> => {
  const chooser = await openAttachmentFileChooser({ page: details.page });
  await chooser.setFiles(details.paths);
};

type AttachFilesViaFileFieldDetails = {
  page: Page;
  paths: string[];
};

const attachFilesViaFileField = async (
  details: AttachFilesViaFileFieldDetails,
): Promise<boolean> => {
  const attachmentField = details.page.locator(SELECTORS.attachmentInput).first();
  const fileFieldCount = await attachmentField.count();

  const hasNoFileField = fileFieldCount === 0;
  if (hasNoFileField) return false;

  await attachmentField.setInputFiles(details.paths);
  return true;
};

type PreparedRewindTurnDetails = {
  page: PrepareRewindTurnDetails["page"];
  replacement?: string;
  lastUserBlock: Locator;
  previousAssistantCount: number;
  previousLastAssistantText: string;
};

const readPreparedRewindTurn = async (
  details: PreparedRewindTurnDetails,
): Promise<PreparedRewindTurn> => {
  const turnScope = await readLastUserTurnScope({ lastUserBlock: details.lastUserBlock });
  const lastUserPromptString = await readLastUserPromptString({
    lastUserBlock: details.lastUserBlock,
  });
  const prompt = readRewindPrompt({
    replacement: details.replacement,
    previousText: lastUserPromptString,
  });

  return {
    page: details.page,
    turnScope,
    prompt,
    previousAssistantCount: details.previousAssistantCount,
    previousLastAssistantText: details.previousLastAssistantText,
  };
};

type LoadLastUserBlockDetails = {
  page: import("playwright").Page;
};

const loadLastUserBlock = async (details: LoadLastUserBlockDetails) => {
  const blocks = await details.page.locator(SELECTORS.userBlock).all();
  const last = blocks[blocks.length - 1];

  const isLastMissing = last == null;
  if (isLastMissing) throw new Error("No user message found to rewind.");

  return last;
};

type ClickRewindEditButtonDetails = {
  prepared: PreparedRewindTurn;
};

const clickRewindEditButton = async (details: ClickRewindEditButtonDetails): Promise<void> => {
  await probeOrFallback(null, () => details.prepared.turnScope.hover());
  const settlePauseMilliseconds = 300;

  await details.prepared.page.waitForTimeout(settlePauseMilliseconds);

  const editButton = await findRewindEditButton({ turnScope: details.prepared.turnScope });

  const isEditButtonMissing = editButton == null;
  if (isEditButtonMissing)
    throw new Error("Could not find ChatGPT edit button for the last user message.");

  await editButton.click();
};

type OpenRewindEditorDetails = {
  prepared: PreparedRewindTurn;
};

const openRewindEditor = async (details: OpenRewindEditorDetails) => {
  await clickRewindEditButton({ prepared: details.prepared });
  return findRewindEditor({ page: details.prepared.page, turnScope: details.prepared.turnScope });
};

const prepareRewindTurn = async (
  details: PrepareRewindTurnDetails,
): Promise<PreparedRewindTurn> => {
  const lastUserBlock = await loadLastUserBlock({ page: details.page });
  const previousAssistantCount = await countAssistantReplies(details.page);
  const previousLastAssistantString = await captureLastReply(details.page);

  return readPreparedRewindTurn({
    page: details.page,
    replacement: details.replacement,
    lastUserBlock,
    previousAssistantCount,
    previousLastAssistantText: previousLastAssistantString,
  });
};

type FindRewindEditButtonDetails = {
  turnScope: Locator;
};

const findRewindEditButton = async (details: FindRewindEditButtonDetails) => {
  return readFirstVisibleIn({
    parent: details.turnScope,
    selectors: [
      'button[data-testid="edit-turn-button"]',
      'button[data-testid="edit-message-button"]',
      'button[aria-label="Edit message"]',
      'button[aria-label*="Edit" i]',
      'button[title="Edit message"]',
      'button:has-text("Edit")',
    ] as const,
  });
};

type FindRewindEditorDetails = {
  page: Page;
  turnScope: Locator;
};

const findRewindEditor = async (details: FindRewindEditorDetails) => {
  const scopedEditor = await readFirstVisibleIn({
    parent: details.turnScope,
    selectors: EDITOR_SELECTORS,
  });

  const hasScopedEditor = scopedEditor != null;
  if (hasScopedEditor) return scopedEditor;

  return readFirstVisible({ page: details.page, selectors: EDITOR_SELECTORS });
};

type FindRewindSubmitButtonDetails = {
  page: Page;
  turnScope: Locator;
};

const findRewindSubmitButton = async (details: FindRewindSubmitButtonDetails) => {
  const scopedSubmit = await readFirstVisibleIn({
    parent: details.turnScope,
    selectors: SUBMIT_BUTTON_SELECTORS,
  });

  const hasScopedSubmit = scopedSubmit != null;
  if (hasScopedSubmit) return scopedSubmit;

  return readFirstVisible({ page: details.page, selectors: SUBMIT_BUTTON_SELECTORS });
};

type SubmitRewindEditorDetails = {
  editor: Locator;
  prompt: string;
};

const submitRewindEditor = async (details: SubmitRewindEditorDetails): Promise<void> => {
  await details.editor.click();
  await details.editor.fill(details.prompt);
  await probeOrFallback(null, () => details.editor.dispatchEvent("input"));
};

type LastUserTurnDetailsDetails = {
  lastUserBlock: Locator;
};

const readLastUserTurnScope = async (details: LastUserTurnDetailsDetails): Promise<Locator> => {
  const turn = details.lastUserBlock.locator(
    'xpath=ancestor::*[starts-with(@data-testid, "conversation-turn-") or @data-turn-key][1]',
  );
  const turnCount = await turn.count();
  const hasTurn = turnCount > 0;

  return hasTurn ? turn : details.lastUserBlock;
};

type ReadLastUserPromptStringDetails = {
  lastUserBlock: Locator;
};

const readLastUserPromptString = async (
  details: ReadLastUserPromptStringDetails,
): Promise<string> => {
  const lastUserBlockString = await readVisibleText(details.lastUserBlock);
  return cleanDisplayString({ value: lastUserBlockString });
};

type RewindPromptDetails = {
  replacement?: string;
  previousText: string;
};

const readRewindPrompt = (details: RewindPromptDetails): string => {
  const replacement = details.replacement?.trim();

  const isReplacementBlank = replacement == null || replacement === "";
  const prompt = isReplacementBlank ? details.previousText : replacement;

  const isPromptEmpty = !prompt;
  if (isPromptEmpty) throw new Error("Last user message is empty.");

  return prompt;
};

const rewindLastUserPrompt = async (page: Page, replacement?: string): Promise<void> => {
  const prepared = await prepareRewindTurn({ page, replacement });
  await submitRewindTurn({ prepared });
};

type PreparedRewindTurn = {
  page: Page;
  turnScope: Locator;
  prompt: string;
  previousAssistantCount: number;
  previousLastAssistantText: string;
};

type PrepareRewindTurnDetails = {
  page: Page;
  replacement?: string;
};

const stopGenerating = async (
  page: Page,
  timeout = FIVE_SECONDS_MILLISECONDS,
): Promise<boolean> => {
  const stop = page.locator(SELECTORS.streamingIndicator).first();

  const isStopShown = await probeOrFallback(false, async () => {
    await stop.waitFor({ state: VISIBLE_WAIT_MODE, timeout });
    return true;
  });
  const isStopMissing = !isStopShown;
  if (isStopMissing) return false;

  await stop.click();

  return true;
};

type SubmitEditedRewindTurnDetails = {
  prepared: PreparedRewindTurn;
};

const submitEditedRewindTurn = async (details: SubmitEditedRewindTurnDetails): Promise<void> => {
  const submitButton = await findRewindSubmitButton({
    page: details.prepared.page,
    turnScope: details.prepared.turnScope,
  });

  const isSubmitButtonMissing = submitButton == null;
  if (isSubmitButtonMissing) throw new Error("Could not find submit button for edited prompt.");

  await submitButton.click();
  await waitForReply(details.prepared.page, {
    previousAssistantCount: details.prepared.previousAssistantCount,
    previousLastAssistantText: details.prepared.previousLastAssistantText,
  });
};

type SubmitRewindTurnDetails = {
  prepared: PreparedRewindTurn;
};

const submitRewindTurn = async (details: SubmitRewindTurnDetails): Promise<void> => {
  const editor = await openRewindEditor({ prepared: details.prepared });

  const isEditorMissing = editor == null;
  if (isEditorMissing) throw new Error("Could not find editable prompt field after clicking edit.");

  await submitRewindEditor({ editor, prompt: details.prepared.prompt });
  await submitEditedRewindTurn({ prepared: details.prepared });
};

const readRegisteredAttachment = (details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
    existing: Attachment[];
  };
  usedExistingIds: Set<string>;
  newAttachments: Attachment[];
}): Attachment => {
  const existing = findExistingAttachment(details);
  if (existing) return reuseExisting({ details: details, existing });

  return createAttachment(details);
};

const reuseExisting = (parameters: {
  details: { item: ExtractedMessage["attachments"][number]; usedExistingIds: Set<string> };
  existing: Attachment;
}): Attachment => {
  parameters.details.usedExistingIds.add(parameters.existing.id);
  parameters.existing.url = parameters.details.item.url;
  return parameters.existing;
};

const createAttachment = (details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment => {
  details.params.counters[details.params.role][details.item.kind] += 1;
  const attachment = readNewAttachment(details);
  details.newAttachments.push(attachment);
  return attachment;
};

const findExistingAttachment = (details: {
  item: ExtractedMessage["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | null => {
  return (
    details.params.existing.find(
      (attachment) =>
        !details.usedExistingIds.has(attachment.id) &&
        attachment.role === details.params.role &&
        attachment.messageIndex === details.params.messageIndex &&
        attachment.kind === details.item.kind &&
        isSameAttachmentOrigin({ attachment, item: details.item }),
    ) ?? null
  );
};

const isSameAttachmentOrigin = (details: {
  attachment: Attachment;
  item: ExtractedMessage["attachments"][number];
}): boolean => {
  const hasSameUrl = details.attachment.url === details.item.url;
  const isReloadedPageBlob =
    details.attachment.url.startsWith(BLOB_URL_PREFIX) &&
    details.item.url.startsWith(BLOB_URL_PREFIX);
  const hasSameFilename = details.attachment.filename === details.item.filename;

  return hasSameUrl || (isReloadedPageBlob && hasSameFilename);
};

const readNewAttachment = (details: {
  item: ExtractedMessage["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
}): Attachment => {
  const suffix = details.params.counters[details.params.role][details.item.kind];

  return {
    ...details.item,
    id: readAttachmentId({ role: details.params.role, kind: details.item.kind, suffix }),
    role: details.params.role,
    messageIndex: details.params.messageIndex,
    createdAt: details.params.createdAt,
  };
};

const readAttachmentId = (parameters: {
  role: AttachmentRole;
  kind: AttachmentKind;
  suffix: number;
}): string => {
  return parameters.role === USER_ROLE
    ? `user-${parameters.kind}-${parameters.suffix}`
    : `${parameters.kind}-${parameters.suffix}`;
};

const registerExtractedMessage = async (parameters: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedMessage;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  const manifest = await loadManifest(parameters.conversationId, {
    manifestRoot: parameters.manifestRoot,
  });
  const manifestCounters = readCountersFromManifest(manifest);
  const nowIso = new Date().toISOString();
  const registered = assignAttachmentIds({
    extracted: parameters.extracted,
    role: ASSISTANT_ROLE,
    messageIndex: parameters.messageIndex,
    counters: manifestCounters,
    createdAt: nowIso,
    existing: manifest.attachments,
  });

  return finalizeRegistration({ manifest, registered, manifestRoot: parameters.manifestRoot });
};

const assignAttachmentIds = (parameters: {
  extracted: ExtractedMessage;
  role: AttachmentRole;
  messageIndex: number;
  counters: AttachmentCounters;
  createdAt: string;
  existing: Attachment[];
}): {
  text: string;
  attachments: Attachment[];
  newAttachments: Attachment[];
  counters: AttachmentCounters;
} => {
  const usedExistingIds = new Set<string>();
  const newAttachments: Attachment[] = [];
  const attachments = parameters.extracted.attachments.map((element) =>
    readRegisteredAttachment({
      item: element,
      params: parameters,
      usedExistingIds,
      newAttachments,
    }),
  );

  return {
    text: replaceMarkers({ text: parameters.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: parameters.counters,
  };
};

const finalizeRegistration = async (parameters: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  parameters.manifest.attachments.push(...parameters.registered.newAttachments);
  parameters.manifest.counters = parameters.registered.counters;
  await saveManifest(parameters.manifest, { manifestRoot: parameters.manifestRoot });
  return { text: parameters.registered.text, attachments: parameters.registered.attachments };
};

const replaceMarkers = (parameters: { text: string; attachments: Attachment[] }): string => {
  let message = parameters.text;

  for (let index = 0; index < parameters.attachments.length; index += 1) {
    const attachmentId = parameters.attachments[index]?.id;
    const isAttachmentIdMissing = attachmentId == null;
    const markerId = isAttachmentIdMissing ? "" : attachmentId;
    const markerPlaceholder = createMarker(index);
    message = message.replace(markerPlaceholder, `[${markerId}]`);
  }

  return message;
};

const createMarker = (index: number): string => {
  return `${"\u0000attachment:"}${index}${"\u0000"}`;
};

export type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
      type: "element";
      tagName: string;
      attributes: Record<string, string>;
      children: DomSnapshotNode[];
    };

type AttachmentKind = Attachment["kind"];

type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;

type ExtractMessagesSettings = {
  conversationId: string;
  includeUserAttachments?: boolean;
  manifestRoot?: string | undefined;
};

type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

type ManifestStoreSettings = {
  manifestRoot?: string | undefined;
};

type AttachmentCandidate = {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
};

type ExtractedMessage = {
  text: string;
  attachments: AttachmentCandidate[];
};

type SerializedMessage = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};

export interface DownloadAttachmentDetails {
  page: Page;
  conversationId: string;
  id: string;
  settings: DownloadSettings;
}

export const downloadAttachment = async ({
  page,
  conversationId,
  id,
  settings,
}: DownloadAttachmentDetails): Promise<DownloadReport> => {
  const manifest = await loadManifest(conversationId, { manifestRoot: settings.manifestRoot });

  const attachment = manifest.attachments.find((attachment: Attachment) => attachment.id === id);

  const isAttachmentMissing = attachment == null;
  if (isAttachmentMissing)
    throw new Error(`Attachment not found in manifest: ${id}`, {
      cause: { attachmentId: id, attachmentUrl: undefined },
    });

  return downloadPreparedAttachment({
    page,
    conversationId,
    attachment,
    attachments: manifest.attachments,
    settings,
  });
};

export const downloadAll = async (
  page: Page,
  conversationId: string,
  settings: DownloadAllSettings,
): Promise<DownloadAllReport[]> => {
  const manifest = await loadManifest(conversationId, { manifestRoot: settings.manifestRoot });
  const ids =
    settings.ids == null
      ? manifest.attachments.map((attachment: Attachment) => attachment.id)
      : settings.ids;

  const downloadReports = await downloadIds({ page, conversationId, ids, settings });

  const hasAllDownloadsFailed =
    downloadReports.length > 0 && downloadReports.every((downloadReport) => downloadReport.error);
  if (hasAllDownloadsFailed) {
    const failedIds = settings.ids == null ? "*" : settings.ids.join(",");
    throw new Error(`Failed to download all attachments for conversation ${conversationId}`, {
      cause: { attachmentId: failedIds, attachmentUrl: undefined, source: downloadReports },
    });
  }

  return downloadReports;
};

type DownloadPreparedDetails = {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  settings: DownloadSettings;
};

const downloadPreparedAttachment = async (
  details: DownloadPreparedDetails,
): Promise<DownloadReport> => {
  const outDir = readSaveDirectory({
    conversationId: details.conversationId,
    outDir: details.settings.outDir,
    repoRoot: details.settings.repoRoot,
  });
  await mkdir(outDir, { recursive: true });
  try {
    if (isChatGptFileUrl(details.attachment.url)) {
      const attachmentFileId = readFileIdFromChatGptFileUrl(details.attachment.url);
      const downloadUrl = await readChatGptFileDownloadUrl({
        page: details.page,
        conversationId: details.conversationId,
        fileId: attachmentFileId,
      });
      return await downloadHttpAttachment({
        page: details.page,
        attachment: details.attachment,
        url: downloadUrl,
        outDir,
        attachments: details.attachments,
      });
    }

    if (isHttpUrl(details.attachment.url)) {
      return await downloadHttpAttachment({
        page: details.page,
        attachment: details.attachment,
        url: details.attachment.url,
        outDir,
        attachments: details.attachments,
      });
    }

    const filePath = await readAvailableDownloadPath({
      outDir,
      attachment: details.attachment,
      attachments: details.attachments,
    });
    const isAttachmentUrlStartsWithBlob = details.attachment.url.startsWith(BLOB_URL_PREFIX);
    const bytes = isAttachmentUrlStartsWithBlob
      ? await fetchBlobBytes({ page: details.page, attachment: details.attachment })
      : parseEmbeddedUrl({ attachment: details.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (isAttachmentFailure(error)) throw error;

    throw new Error(`Failed to download attachment ${details.attachment.id}`, {
      cause: {
        attachmentId: details.attachment.id,
        attachmentUrl: details.attachment.url,
        source: error,
      },
    });
  }
};

type DownloadIdsDetails = {
  page: Page;
  conversationId: string;
  ids: string[];
  settings: DownloadAllSettings;
};

const downloadIds = async (details: DownloadIdsDetails): Promise<DownloadAllReport[]> => {
  const downloadReports: DownloadAllReport[] = [];

  for (const attachmentId of details.ids) {
    const downloadReport = await downloadOneId({ input: details, attachmentId });
    downloadReports.push(downloadReport);
  }

  return downloadReports;
};

const downloadOneId = async (details: {
  input: DownloadIdsDetails;
  attachmentId: string;
}): Promise<DownloadAllReport> => {
  try {
    const downloaded = await downloadAttachment({
      page: details.input.page,
      conversationId: details.input.conversationId,
      id: details.attachmentId,
      settings: details.input.settings,
    });
    return { id: details.attachmentId, ...downloaded };
  } catch (error) {
    const isErrorObject = error instanceof Error;
    return {
      id: details.attachmentId,
      path: "",
      bytes: 0,
      error: isErrorObject ? error.message : String(error),
    };
  }
};

// Attachment failures are plain Errors whose cause holds the attachment id, url and source error.
const isAttachmentFailure = (error: unknown): boolean => {
  const isErrorObject = error instanceof Error;
  if (!isErrorObject) return false;

  const failureCause = error.cause;
  const isCauseObject = typeof failureCause === "object" && failureCause !== null;
  return isCauseObject && "attachmentId" in failureCause;
};

type DownloadReport = {
  path: string;
  bytes: number;
};

type DownloadAllReport = DownloadReport & {
  id: string;
  error?: string;
};

type DownloadSettings = {
  outDir?: string;
  repoRoot: string;
  manifestRoot?: string | undefined;
};

type DownloadAllSettings = DownloadSettings & {
  ids?: string[];
};

type ParseEmbeddedUrlDetails = {
  attachment: Attachment;
};

const parseEmbeddedUrl = (details: ParseEmbeddedUrlDetails): Buffer => {
  const hit = /^data:(?<metadata>[^,]*),(?<encodedPayload>.*)$/s.exec(details.attachment.url);

  const isGroupsMissing = hit?.groups == null;
  if (isGroupsMissing) {
    throw new Error(`Invalid data URL for attachment ${details.attachment.id}`, {
      cause: { attachmentId: details.attachment.id, attachmentUrl: details.attachment.url },
    });
  }

  const metadata = hit.groups.metadata == null ? "" : hit.groups.metadata;
  const encodedMessage = hit.groups.encodedPayload == null ? "" : hit.groups.encodedPayload;
  return decodeEmbeddedUrlBytes({ metadata, encodedPayload: encodedMessage });
};

const decodeEmbeddedUrlBytes = (details: { metadata: string; encodedPayload: string }): Buffer => {
  const isBase64Encoded = details.metadata
    .split(MIME_PARAMETER_SEPARATOR)
    .includes(BASE64_ENCODING);
  if (isBase64Encoded) {
    return Buffer.from(details.encodedPayload, BASE64_ENCODING);
  }

  const percentDecodedString = decodeURIComponent(details.encodedPayload);
  return Buffer.from(percentDecodedString, UTF8_ENCODING);
};

type SanitizeFilenameDetails = {
  value: string | undefined;
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from filename candidates
const UNSAFE_FILENAME_CHARS = /[\\/\0-\x1f\x7f]/g;

const sanitizeFilename = (details: SanitizeFilenameDetails): string | undefined => {
  const sanitized = details.value?.replace(UNSAFE_FILENAME_CHARS, "").replace(/^\.+/, "").trim();
  return sanitized ? sanitized : undefined;
};

type FilenameFromUrlDetails = {
  url: string;
};

const readFilenameFromUrl = (details: FilenameFromUrlDetails): string | undefined => {
  try {
    const parsed = new URL(details.url);
    const basename = path.posix.basename(parsed.pathname);
    const hasBasename = basename && basename !== SLASH;
    return hasBasename ? decodeURIComponent(basename) : undefined;
  } catch (error) {
    const isUrlOrNameMalformed = error instanceof TypeError || error instanceof URIError;
    if (isUrlOrNameMalformed) return undefined;

    throw error;
  }
};

type SameAttachmentDetails = {
  left: Attachment;
  right: Attachment;
};

const isSameAttachment = (details: SameAttachmentDetails): boolean => {
  return (
    details.left.id === details.right.id &&
    details.left.url === details.right.url &&
    details.left.filename === details.right.filename
  );
};

type ExtensionForMimeDetails = {
  mime: string | undefined;
};

const readMimeExtension = (details: ExtensionForMimeDetails): string | null => {
  const normalized = details.mime?.toLowerCase().split(MIME_PARAMETER_SEPARATOR)[0]?.trim();

  const isMimeMissing = normalized == null || normalized === "";
  if (isMimeMissing) return null;

  return MIME_EXTENSIONS[normalized] ?? null;
};

type ExtensionForAttachmentDetails = {
  attachment: Attachment;
  mimeOverride?: string;
};

const readAttachmentExtension = (details: ExtensionForAttachmentDetails): string => {
  const overrideExtension = readMimeExtension({ mime: details.mimeOverride });
  const attachmentExtension = readMimeExtension({ mime: details.attachment.mime });

  const isOverrideExtensionMissing = overrideExtension == null;

  const mimeExtension = isOverrideExtensionMissing ? attachmentExtension : overrideExtension;
  if (mimeExtension) return mimeExtension;

  const isImageKind = details.attachment.kind === IMAGE_KIND;
  if (isImageKind) return PNG_EXTENSION;

  const isPdfKind = details.attachment.kind === PDF_KIND;
  if (isPdfKind) return PDF_EXTENSION;

  return "";
};

type WithMissingExtensionDetails = {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
};

const addExtensionIfMissing = (details: WithMissingExtensionDetails): string => {
  const hasFileExtension = path.extname(details.filename);
  if (hasFileExtension) return details.filename;

  return `${details.filename}${readAttachmentExtension({ attachment: details.attachment, mimeOverride: details.mimeOverride })}`;
};

type FilenameForAttachmentDetails = {
  attachment: Attachment;
  mimeOverride?: string;
};

const readAttachmentFilename = (details: FilenameForAttachmentDetails): string => {
  const preferred = readPreferredFilename(details);
  if (preferred) return preferred;

  const fallback = sanitizeFilename({
    value: `${details.attachment.id}${readAttachmentExtension({ attachment: details.attachment, mimeOverride: details.mimeOverride })}`,
  });

  const isFallbackMissing = fallback == null;
  if (isFallbackMissing) return details.attachment.id;

  return fallback;
};

const readPreferredFilename = (details: FilenameForAttachmentDetails): string | undefined => {
  const preferred = sanitizeFilename({ value: details.attachment.filename });
  if (preferred)
    return addExtensionIfMissing({
      filename: preferred,
      attachment: details.attachment,
      mimeOverride: details.mimeOverride,
    });

  const filenameFromUrl = readFilenameFromUrl({ url: details.attachment.url });
  return sanitizeFilename({ value: filenameFromUrl });
};

type DownloadPathDetails = {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
};

const readAvailableDownloadPath = async (details: DownloadPathDetails): Promise<string> => {
  const filename = readAttachmentFilename({
    attachment: details.attachment,
    mimeOverride: details.mimeOverride,
  });

  const filePath = readSavePath({ outDir: details.outDir, filename });

  const isFileMissing = (await readExistingSize({ filePath })) == null;
  if (isFileMissing) return filePath;

  return readCollisionFreeDownloadPath({ input: details, filename, filePath });
};

const readCollisionFreeDownloadPath = async (details: {
  input: DownloadPathDetails;
  filename: string;
  filePath: string;
}): Promise<string> => {
  const owner = details.input.attachments.find(
    (element) =>
      readAttachmentFilename({ attachment: element, mimeOverride: details.input.mimeOverride }) ===
      details.filename,
  );

  const isOwnAttachment =
    !owner || isSameAttachment({ left: owner, right: details.input.attachment });
  if (isOwnAttachment) return details.filePath;

  const disambiguatedFilename = createDisambiguatedFilename({
    filename: details.filename,
    id: details.input.attachment.id,
  });
  return readSavePath({
    outDir: details.input.outDir,
    filename: disambiguatedFilename,
  });
};

type FetchBlobDetails = {
  page: Page;
  attachment: Attachment;
};

const fetchBlobBytes = async (details: FetchBlobDetails): Promise<Buffer> => {
  try {
    const bytes = await details.page.evaluate(
      async (url: string): Promise<number[] | Uint8Array> => {
        const blobFetch = await fetch(url);

        const isBlobFetchFailed = !blobFetch.ok;
        if (isBlobFetchFailed) throw new Error(`Blob fetch failed with HTTP ${blobFetch.status}`);

        const blobArrayBuffer = await blobFetch.arrayBuffer();
        return new Uint8Array(blobArrayBuffer);
      },
      details.attachment.url,
    );
    return Buffer.from(bytes);
  } catch (error) {
    throw new Error(`Failed to fetch blob attachment ${details.attachment.id}`, {
      cause: {
        attachmentId: details.attachment.id,
        attachmentUrl: details.attachment.url,
        source: error,
      },
    });
  }
};

type DownloadHttpDetails = {
  page: Page;
  attachment: Attachment;
  url: string;
  outDir: string;
  attachments: Attachment[];
};

const downloadHttpAttachment = async (details: DownloadHttpDetails): Promise<DownloadReport> => {
  const httpReply = await details.page.context().request.get(details.url);

  const isReplyFailed = !httpReply.ok();
  if (isReplyFailed) {
    const httpStatus = httpReply.status();
    throwFailedHttpAttachment({ attachment: details.attachment, status: httpStatus });
  }

  return await saveHttpAttachmentReply({
    outDir: details.outDir,
    attachment: details.attachment,
    attachments: details.attachments,
    httpResponse: httpReply,
  });
};

const saveHttpAttachmentReply = async (details: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  httpResponse: APIResponse;
}): Promise<DownloadReport> => {
  const headers = details.httpResponse.headers();
  const filePath = await readAvailableDownloadPath({
    outDir: details.outDir,
    attachment: details.attachment,
    attachments: details.attachments,
    mimeOverride: headers["content-type"],
  });

  const byteLength = Number(headers["content-length"]);

  const isDownloadAlreadyComplete =
    Number.isSafeInteger(byteLength) && (await readExistingSize({ filePath })) === byteLength;
  if (isDownloadAlreadyComplete) {
    return { path: filePath, bytes: byteLength };
  }

  const downloadedBytes = await details.httpResponse.body();
  return writeIfChanged({ filePath, bytes: downloadedBytes });
};

const throwFailedHttpAttachment = (details: { attachment: Attachment; status: number }): void => {
  throw new Error(
    `Attachment ${details.attachment.id} request failed with HTTP ${details.status}`,
    {
      cause: { attachmentId: details.attachment.id, attachmentUrl: details.attachment.url },
    },
  );
};

type SaveDirectoryDetails = {
  conversationId: string;
  outDir?: string;
  repoRoot: string;
};

const readSaveDirectory = (details: SaveDirectoryDetails): string => {
  if (details.outDir) return path.resolve(details.outDir);

  return path.resolve(details.repoRoot, REPO_DIRECTORY_NAME, "downloads", details.conversationId);
};

type SavePathDetails = {
  outDir: string;
  filename: string;
};

const readSavePath = (details: SavePathDetails): string => {
  const absoluteOutDir = path.resolve(details.outDir);
  const filePath = path.resolve(absoluteOutDir, details.filename);

  const relativePath = path.relative(absoluteOutDir, filePath);

  const isPathOutsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (isPathOutsideRoot) {
    throw new Error(`Invalid attachment output path: ${details.filename}`, {
      cause: { attachmentId: "", attachmentUrl: undefined },
    });
  }

  return filePath;
};

const isHttpUrl = (url: string): boolean => {
  return url.startsWith("https://") || url.startsWith("http://");
};

type DisambiguateDetails = {
  filename: string;
  id: string;
};

const createDisambiguatedFilename = (details: DisambiguateDetails): string => {
  const extension = path.extname(details.filename);

  const isExtensionEmpty = !extension;
  if (isExtensionEmpty) return `${details.filename}-${details.id}`;

  return `${details.filename.slice(0, -extension.length)}-${details.id}${extension}`;
};

type ExistingSizeDetails = {
  filePath: string;
};

const readExistingSize = async (details: ExistingSizeDetails): Promise<number | null> => {
  try {
    return (await stat(details.filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === MISSING_FILE_ERROR_CODE) return null;

    throw error;
  }
};

type WriteIfChangedDetails = {
  filePath: string;
  bytes: Buffer;
};

const writeIfChanged = async (details: WriteIfChangedDetails): Promise<DownloadReport> => {
  const isFileSizeCurrent =
    (await readExistingSize({ filePath: details.filePath })) === details.bytes.byteLength;
  if (isFileSizeCurrent) {
    return { path: details.filePath, bytes: details.bytes.byteLength };
  }

  await writeFile(details.filePath, details.bytes);
  return { path: details.filePath, bytes: details.bytes.byteLength };
};

const persistAllMessages = async (parameters: {
  messages: SerializedMessage[];
  settings: ExtractMessagesSettings;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const manifest = await loadManifest(parameters.settings.conversationId, {
    manifestRoot: parameters.settings.manifestRoot,
  });
  const status = {
    manifest,
    counters: readCountersFromManifest(manifest),
    now: new Date().toISOString(),
  };
  const captured = await listCapturedMessages({ ...parameters, ...status });

  return saveCapturedMessages({
    captured,
    manifest: status.manifest,
    counters: status.counters,
    manifestRoot: parameters.settings.manifestRoot,
  });
};

const saveCapturedMessages = async (parameters: {
  captured: Array<{ role: string; content: string; attachments: Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof readCountersFromManifest>;
  manifestRoot?: string | undefined;
}) => {
  parameters.manifest.counters = parameters.counters;
  await saveManifest(parameters.manifest, { manifestRoot: parameters.manifestRoot });
  return parameters.captured;
};

const listCapturedMessages = async (parameters: {
  messages: SerializedMessage[];
  settings: ExtractMessagesSettings;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
}) => {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];

  for (const message of parameters.messages) {
    const capturedMessage = await captureMessage({
      message,
      settings: parameters.settings,
      counters: parameters.counters,
      now: parameters.now,
      manifest: parameters.manifest,
    });
    captured.push(capturedMessage);
  }

  return captured;
};

const captureMessage = async (parameters: {
  message: SerializedMessage;
  settings: ExtractMessagesSettings;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  const isAttachmentRegistrationOff = !shouldRegisterAttachments({
    message: parameters.message,
    settings: parameters.settings,
  });
  if (isAttachmentRegistrationOff) {
    return { role: parameters.message.role, content: parameters.message.text, attachments: [] };
  }

  return registerMessageAttachments(parameters);
};

const registerMessageAttachments = async (parameters: {
  message: SerializedMessage;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  const role: AttachmentRole = parameters.message.role === USER_ROLE ? USER_ROLE : ASSISTANT_ROLE;
  const extractedSnapshotMessage = extractMessageFromSnapshot(parameters.message.root);
  const registered = assignAttachmentIds({
    extracted: extractedSnapshotMessage,
    role,
    messageIndex: parameters.message.messageIndex,
    counters: parameters.counters,
    createdAt: parameters.now,
    existing: parameters.manifest.attachments,
  });

  parameters.manifest.attachments.push(...registered.newAttachments);

  return {
    role: parameters.message.role,
    content: registered.text,
    attachments: registered.attachments,
  };
};

const shouldRegisterAttachments = (parameters: {
  message: SerializedMessage;
  settings: ExtractMessagesSettings;
}): boolean => {
  const isMessageRoleAssistant = parameters.message.role === ASSISTANT_ROLE;
  if (isMessageRoleAssistant) return true;

  return (
    parameters.message.role === USER_ROLE && parameters.settings.includeUserAttachments === true
  );
};

export const extractAssistantMessage = async (
  page: Page,
  settings: { conversationId: string; manifestRoot?: string | undefined },
): Promise<{ text: string; attachments: Attachment[] }> => {
  const message = await page.evaluate<SerializedMessage | null>(
    LAST_ASSISTANT_MESSAGE_SNAPSHOT_ORIGIN,
  );

  const isMessageEmpty = !message;
  if (isMessageEmpty) return { text: "", attachments: [] };

  const extractedRootMessage = extractMessageFromSnapshot(message.root);
  return registerExtractedMessage({
    conversationId: settings.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractedRootMessage,
    manifestRoot: settings.manifestRoot,
  });
};

export const registerConversationImages = async (parameters: {
  page: Page;
  conversationId: string;
  manifestRoot?: string | undefined;
}): Promise<void> => {
  const conversation = await readConversationReply(parameters.page, parameters.conversationId);
  const imageRefs = listConversationImageRefs(conversation);
  const manifest = await loadManifest(parameters.conversationId, {
    manifestRoot: parameters.manifestRoot,
  });
  const otherAttachments = manifest.attachments.filter(
    (attachment) => attachment.kind !== IMAGE_KIND,
  );
  const nowIso = new Date().toISOString();
  const imageAttachments = listAttachmentsFromImageRefs({
    refs: imageRefs,
    createdAt: nowIso,
  });

  manifest.attachments = [...otherAttachments, ...imageAttachments];
  manifest.counters = readCountersFromAttachments(manifest.attachments);
  await saveManifest(manifest, { manifestRoot: parameters.manifestRoot });
};

export const extractAllMessages = async (
  page: Page,
  settings: ExtractMessagesSettings,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_ORIGIN);
  return persistAllMessages({ messages, settings });
};

const listAttachmentKinds = (): AttachmentKind[] => {
  return [IMAGE_KIND, FILE_KIND, PDF_KIND];
};

const createEmptyCounters = (): AttachmentCounters => {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
};

const readCountersFromAttachments = (attachments: Attachment[]): AttachmentCounters => {
  const counters = createEmptyCounters();
  for (const attachment of attachments) {
    const idLastPart = attachment.id.split(DASH).at(-1);
    const suffix = Number(idLastPart);

    const isSuffixFinite = Number.isFinite(suffix);
    if (isSuffixFinite) {
      counters[attachment.role][attachment.kind] = Math.max(
        counters[attachment.role][attachment.kind],
        suffix,
      );
    }
  }
  return counters;
};

const mergeCounters = (base: AttachmentCounters, overrides: unknown): AttachmentCounters => {
  const currentCounters = readCurrentCounters(overrides);

  const isCurrentCountersMissing = currentCounters == null;
  if (isCurrentCountersMissing) return base;

  return {
    assistant: mergeKindCounters(base.assistant, currentCounters.assistant),
    user: mergeKindCounters(base.user, currentCounters.user),
  };
};

const readCurrentCounters = (field: unknown): AttachmentCounters | null => {
  const isNotPlainObject = !isPlainObject(field);
  if (isNotPlainObject) return null;

  const isKindCountersInvalid = !isKindCounters(field.assistant) || !isKindCounters(field.user);
  if (isKindCountersInvalid) return null;

  return { assistant: field.assistant, user: field.user };
};

const mergeKindCounters = (
  base: Record<AttachmentKind, number>,
  overrides: Record<AttachmentKind, number>,
): Record<AttachmentKind, number> => {
  return {
    image: Math.max(base.image, overrides.image),
    file: Math.max(base.file, overrides.file),
    pdf: Math.max(base.pdf, overrides.pdf),
  };
};

const isPlainObject = (field: unknown): field is Record<string, unknown> => {
  return typeof field === "object" && field !== null;
};

const isKindCounters = (field: unknown): field is Record<AttachmentKind, number> => {
  return (
    isPlainObject(field) && listAttachmentKinds().every((kind) => typeof field[kind] === "number")
  );
};

const readDefaultAttachmentManifestRoot = (): string => {
  const homeFolder = homedir();
  return path.join(homeFolder, BRIDGE_DIRECTORY_NAME, "attachment-manifests");
};

const readManifestPath = (conversationId: string, settings: ManifestStoreSettings = {}): string => {
  const downloadsRoot = settings.manifestRoot
    ? path.resolve(settings.manifestRoot)
    : readDefaultAttachmentManifestRoot();

  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");

  const isOutsideDownloadsRoot = !filePath.startsWith(`${downloadsRoot}${path.sep}`);
  if (isOutsideDownloadsRoot) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }

  return filePath;
};

const cleanAttachment = (attachment: SerializedAttachment): Attachment => {
  const role = attachment.role == null ? ASSISTANT_ROLE : attachment.role;
  return { ...attachment, role };
};

const cleanManifest = (parameters: {
  conversationId: string;
  manifest: Partial<AttachmentManifest>;
}): AttachmentManifest => {
  const attachments = Array.isArray(parameters.manifest.attachments)
    ? parameters.manifest.attachments.map(cleanAttachment)
    : [];
  const isManifestConversationIdMissing = parameters.manifest.conversationId == null;
  const attachmentCounters = readCountersFromAttachments(attachments);

  return {
    conversationId: isManifestConversationIdMissing
      ? parameters.conversationId
      : parameters.manifest.conversationId,
    attachments,
    counters: mergeCounters(attachmentCounters, parameters.manifest.counters),
  };
};

export const loadManifest = async (
  conversationId: string,
  settings: ManifestStoreSettings = {},
): Promise<AttachmentManifest> => {
  try {
    const manifestPath = readManifestPath(conversationId, settings);
    const unparsed = await readFile(manifestPath, UTF8_ENCODING);
    return cleanManifest({
      conversationId,
      manifest: JSON.parse(unparsed) as Partial<AttachmentManifest>,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === MISSING_FILE_ERROR_CODE) {
      return { conversationId, attachments: [], counters: createEmptyCounters() };
    }

    throw error;
  }
};

export const saveManifest = async (
  manifest: AttachmentManifest,
  settings: ManifestStoreSettings = {},
): Promise<void> => {
  const normalized = cleanManifest({ conversationId: manifest.conversationId, manifest });
  const filePath = readManifestPath(normalized.conversationId, settings);
  const folderPath = path.dirname(filePath);
  await mkdir(folderPath, { recursive: true });
  const indentSpaces = 2;

  await writeFile(filePath, `${JSON.stringify(normalized, null, indentSpaces)}\n`, UTF8_ENCODING);
};

const readCountersFromManifest = (manifest: AttachmentManifest): AttachmentCounters => {
  const manifestAttachmentCounters = readCountersFromAttachments(manifest.attachments);
  return mergeCounters(manifestAttachmentCounters, manifest.counters);
};

const inferMimeFromEmbeddedUrl = (url: string): string | undefined => {
  const detailsHit = /^data:(?<mimeType>[^;,]+)/.exec(url);
  return detailsHit?.groups?.mimeType;
};

const inferMimeFromExtension = (parameters: {
  url: string;
  fallback: AttachmentKind;
}): string | undefined => {
  const pathWithoutQuery = parameters.url.split("?")[0];
  const isPathWithoutQueryMissing = pathWithoutQuery == null;
  const lower = isPathWithoutQueryMissing ? "" : pathWithoutQuery.toLowerCase();

  const mapped = readExtensionMime(lower);
  if (mapped) return mapped;

  return parameters.fallback === IMAGE_KIND ? "image/*" : undefined;
};

const readExtensionMime = (path: string): string | null => {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    const isPathEndsWithSuffix = path.endsWith(suffix);
    if (isPathEndsWithSuffix) return mime;
  }
  return null;
};

const inferMime = (parameters: { url: string; fallback: AttachmentKind }): string | undefined => {
  const fromEmbeddedUrl = inferMimeFromEmbeddedUrl(parameters.url);

  const hasFromUrl = fromEmbeddedUrl != null;
  if (hasFromUrl) return fromEmbeddedUrl;

  return inferMimeFromExtension(parameters);
};

const readAttr = (parameters: {
  node: Extract<DomSnapshotNode, { type: "element" }>;
  name: string;
}): string | undefined => {
  return parameters.node.attributes[parameters.name];
};

const readOptionalString = (field: string | undefined): string | undefined => {
  const trimmed = field?.trim();
  return trimmed ? trimmed : undefined;
};

const readStringOnly = (node: DomSnapshotNode): string => {
  const isNodeTypeString = node.type === LEAF_NODE_TYPE;
  if (isNodeTypeString) return node.text;

  return node.children.map(readStringOnly).join("");
};

const isFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>): boolean => {
  const hasDownloadAttribute = readAttr({ node, name: DOWNLOAD_ATTRIBUTE }) != null;
  if (hasDownloadAttribute) return true;

  const hrefAttr = readAttr({ node, name: HREF_ATTRIBUTE });
  const isHrefAttrMissing = hrefAttr == null;
  const href = isHrefAttrMissing ? "" : hrefAttr;
  const ariaLabel = readAttr({ node, name: ARIA_LABEL_ATTRIBUTE });
  const testId = readAttr({ node, name: "data-testid" });
  const isAriaLabelMissing = ariaLabel == null;
  const ariaPart = isAriaLabelMissing ? "" : ariaLabel;
  const isTestIdMissing = testId == null;
  const testIdPart = isTestIdMissing ? "" : testId;
  const label = `${ariaPart} ${testIdPart}`.toLowerCase();
  return (
    href.startsWith(BLOB_URL_PREFIX) ||
    label.includes(DOWNLOAD_ATTRIBUTE) ||
    label.includes(FILE_KIND)
  );
};

const readAttachmentFromImage = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const currentSrc = readAttr({ node, name: "currentSrc" });
  const src = readAttr({ node, name: SRC_ATTRIBUTE });

  const isCurrentSrcMissing = currentSrc == null;
  const url = isCurrentSrcMissing ? src : currentSrc;

  const isUrlBlank = url == null || url === "";
  if (isUrlBlank) return null;

  const altAttribute = readAttr({ node, name: "alt" });
  return {
    kind: IMAGE_KIND as const,
    url,
    filename: readOptionalString(altAttribute),
    mime: inferMime({ url, fallback: IMAGE_KIND }),
  };
};

const readAttachmentFromIframe = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: SRC_ATTRIBUTE });

  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  const title = readAttr({ node, name: "title" });
  const ariaLabel = readAttr({ node, name: ARIA_LABEL_ATTRIBUTE });
  const isTitleMissing = title == null;
  const filenameOrigin = isTitleMissing ? ariaLabel : title;
  return {
    kind: PDF_KIND as const,
    url,
    filename: readOptionalString(filenameOrigin),
    mime: PDF_MIME_TYPE,
  };
};

const readAttachmentFromFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: HREF_ATTRIBUTE });

  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  return {
    kind: FILE_KIND as const,
    url,
    filename: (() => {
      const downloadAttribute = readAttr({ node, name: DOWNLOAD_ATTRIBUTE });
      const downloadName = readOptionalString(downloadAttribute);

      const hasDownloadName = downloadName != null;
      if (hasDownloadName) return downloadName;

      const nodeString = readStringOnly(node);
      return readOptionalString(nodeString);
    })(),
    mime: inferMime({ url, fallback: FILE_KIND }),
  };
};

const readAttachmentFromElement = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const isNodeTagNameImg = node.tagName === "img";
  if (isNodeTagNameImg) return readAttachmentFromImage(node);

  const isNodeTagNameIframe = node.tagName === "iframe";
  if (isNodeTagNameIframe) return readAttachmentFromIframe(node);

  const isFileLinkAnchor = node.tagName === "a" && isFileLink(node);
  if (isFileLinkAnchor) return readAttachmentFromFileLink(node);

  return null;
};

const extractMessageFromSnapshot = (root: DomSnapshotNode): ExtractedMessage => {
  const attachments: AttachmentCandidate[] = [];
  const string = walkSnapshot({ node: root, attachments });
  return { text: string, attachments };
};

const walkSnapshot = (parameters: {
  node: DomSnapshotNode;
  attachments: AttachmentCandidate[];
}): string => {
  const isLeafNode = parameters.node.type === LEAF_NODE_TYPE;
  if (isLeafNode) {
    const isSnapshotStringNode = typeof parameters.node.text === "string";
    return isSnapshotStringNode ? parameters.node.text : "";
  }

  const attachment = readAttachmentFromElement(parameters.node);
  if (attachment) {
    parameters.attachments.push(attachment);
    return createMarker(parameters.attachments.length - 1);
  }

  const isNodeTagNameBr = parameters.node.tagName === "br";
  if (isNodeTagNameBr) return NEWLINE;

  return parameters.node.children
    .map((child) => walkSnapshot({ node: child, attachments: parameters.attachments }))
    .join("");
};

type IsRiskCheckboxVisibleDetails = {
  setup: ConnectorSetupDetails;
};

const isRiskCheckboxVisible = async (details: IsRiskCheckboxVisibleDetails): Promise<boolean> => {
  const checkbox = details.setup.page.locator(TRUST_CHECKBOX_SELECTOR).first();
  const checkboxCount = await checkbox.count();

  const hasNoCheckbox = checkboxCount === 0;
  if (hasNoCheckbox) return false;

  return probeOrFallback(false, () => checkbox.isVisible());
};

const acceptCustomMcpRiskIfPresent = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const isRiskCheckboxShown = await isRiskCheckboxVisible({ setup: details });

  const isRiskCheckboxHidden = !isRiskCheckboxShown;
  if (isRiskCheckboxHidden) return false;

  const checkbox = details.page.locator(TRUST_CHECKBOX_SELECTOR).first();

  const isCheckboxChecked = await probeOrFallback(false, () => checkbox.isChecked());
  if (isCheckboxChecked) return true;

  await checkbox.check({ force: true });
  return true;
};

type AppendUniqueSummaryDetails = {
  summaries: ConnectorAppSummary[];
  seen: Set<string>;
  summary: ConnectorAppSummary | null;
};

const appendUniqueSummary = (details: AppendUniqueSummaryDetails): void => {
  const isSummaryMissing = details.summary == null;
  if (isSummaryMissing) return;

  const key = readConnectorSummaryKey({ summary: details.summary });

  const isKeyInSeen = details.seen.has(key);
  if (isKeyInSeen) return;

  details.seen.add(key);
  details.summaries.push(details.summary);
};

type ChatGptReturnUrlDetails = {
  url: string;
};

const readChatGptReturnUrl = (details: ChatGptReturnUrlDetails): string | null => {
  try {
    const parsed = new URL(details.url);

    const isNotChatGptHost = !parsed.hostname.endsWith(CHATGPT_HOSTNAME);
    if (isNotChatGptHost) return null;

    parsed.hash = "";
    parsed.search = "";

    const isParsedPathnameStartsWithC = parsed.pathname.startsWith("/c/");
    if (isParsedPathnameStartsWithC) return parsed.toString();

    return `${parsed.origin}/`;
  } catch (error) {
    const isUrlInvalid = error instanceof TypeError;
    if (isUrlInvalid) return null;

    throw error;
  }
};

type FindDeleteTargetsDetails = {
  summaries: ConnectorAppSummary[];
  connectorName: string;
  connectorUrl: string;
};

const findDeleteTargets = (details: FindDeleteTargetsDetails): ConnectorAppSummary[] => {
  const current = details.summaries.find(
    (summary) => summary.name === details.connectorName && summary.url === details.connectorUrl,
  );
  return details.summaries.filter((summary) => {
    const isConnectorNameDifferent = summary.name !== details.connectorName;
    if (isConnectorNameDifferent) return true;

    const isUrlChanged = summary.url !== details.connectorUrl;
    if (isUrlChanged) return true;

    const isCurrentMissing = current == null;
    if (isCurrentMissing) return true;

    return !isSameConnectorApp({ a: summary, b: current });
  });
};

const removeDuplicateConnectorApps = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const summaries = await listBridgeConnectorSummaries({ page: details.page });
  const current = summaries.find(
    (summary) => summary.name === details.connectorName && summary.url === details.connectorUrl,
  );
  const connectorDeleteTargets = findDeleteTargets({
    summaries,
    connectorName: details.connectorName,
    connectorUrl: details.connectorUrl,
  });

  await deleteDuplicateTargets({
    setup: details,
    deleteTargets: connectorDeleteTargets,
  });
  await openConnectorList({ page: details.page });

  return current != null;
};

type ClickConnectorDetailsButtonDetails = {
  button: Locator;
  setup: ConnectorSetupDetails;
};

const clickConnectorDetailsButton = async (
  details: ClickConnectorDetailsButtonDetails,
): Promise<void> => {
  await details.button.click({ timeout: THREE_SECONDS_MILLISECONDS, force: true });
  const pauseAfterSetupClickMilliseconds = 1_000;

  await details.setup.page.waitForTimeout(pauseAfterSetupClickMilliseconds);
  details.setup.result.steps.push(`Opened existing connector: ${details.setup.connectorName}.`);
};

type ClickConnectorLineButtonDetails = {
  button: Locator;
  page: Page;
};

const clickConnectorLineButton = async (
  details: ClickConnectorLineButtonDetails,
): Promise<void> => {
  await details.button.click({ timeout: THREE_SECONDS_MILLISECONDS, force: true });
  const pauseAfterButtonClickMilliseconds = 1_000;

  await details.page.waitForTimeout(pauseAfterButtonClickMilliseconds);
};

const clickConnectorFromMoreMenu = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const didClickMoreMenuElement = await hoverAndClickMoreMenuElement({ setup: details });

  const isMoreMenuElementNotClicked = !didClickMoreMenuElement;
  if (isMoreMenuElementNotClicked) return false;

  return clickConnectorMenuElement({ page: details.page, connectorName: details.connectorName });
};

type ClickConnectorListLineDetails = {
  page: Page;
  index: number;
};

const clickConnectorListLine = async (details: ClickConnectorListLineDetails): Promise<boolean> => {
  await openConnectorList({ page: details.page });

  const line = (await findBridgeConnectorButtons({ page: details.page }))[details.index];

  const isLineMissing = line == null;
  if (isLineMissing) return false;

  await clickConnectorLineButton({ button: line.button, page: details.page });
  return true;
};

type ClickConnectorMenuElementDetails = {
  page: ConnectorSetupDetails["page"];
  connectorName: string;
};

const clickConnectorMenuElement = async (
  details: ClickConnectorMenuElementDetails,
): Promise<boolean> => {
  const element = details.page
    .locator(
      `[role="menu"] [role="menuitem"]:has-text("${details.connectorName}"), [role="menu"] button:has-text("${details.connectorName}"), [role="menu"] :text-is("${details.connectorName}")`,
    )
    .last();
  const elementVisible = await probeOrFallback(false, () => element.isVisible());

  const isElementHidden = !elementVisible;
  if (isElementHidden) return false;

  await element.click({ timeout: THREE_SECONDS_MILLISECONDS, force: true });
  await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  return true;
};

type ClickDeleteConfirmationDetails = {
  page: Page;
};

const clickDeleteConfirmation = async (details: ClickDeleteConfirmationDetails): Promise<void> => {
  const deleteAppButtonTimeoutMilliseconds = 1_000;

  await clickFirstVisible({
    page: details.page,
    selectors: [
      '[role="alertdialog"] button:has-text("Delete")',
      '[role="dialog"] button:has-text("Delete")',
      'button:has-text("Delete app")',
      'button:has-text("Delete App")',
    ],
    timeout: deleteAppButtonTimeoutMilliseconds,
  });
  const pauseAfterDeleteMilliseconds = TWO_SECONDS_MILLISECONDS;

  await details.page.waitForTimeout(pauseAfterDeleteMilliseconds);
};

type ClickDeleteMenuElementDetails = {
  page: Page;
};

const clickDeleteMenuElement = async (details: ClickDeleteMenuElementDetails) => {
  return readFirstVisible({
    page: details.page,
    selectors: [
      '[role="menu"] [role="menuitem"]:has-text("Delete")',
      '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
    ],
  });
};

type ClickMoreMenuElementDetails = {
  moreItem: Locator;
  setup: ConnectorSetupDetails;
};

const clickMoreMenuElement = async (details: ClickMoreMenuElementDetails): Promise<void> => {
  await probeOrFallback(null, () => details.moreItem.hover());
  await probeOrFallback(null, () => details.moreItem.click({ timeout: 2_000, force: true }));
  await details.setup.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
};

type ClickSettingsLineDetails = {
  setup: ConnectorSetupDetails;
};

const clickSettingsLine = async (details: ClickSettingsLineDetails): Promise<void> => {
  const settingsEntrypointTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  const openedSettings = await clickFirstVisible({
    page: details.setup.page,
    selectors: SELECTORS.settingsEntrypoint,
    timeout: settingsEntrypointTimeoutMilliseconds,
  });
  if (openedSettings) {
    details.setup.result.steps.push("Opened ChatGPT settings.");
    const pauseAfterOpeningSettingsMilliseconds = 1_000;

    await details.setup.page.waitForTimeout(pauseAfterOpeningSettingsMilliseconds);
  } else {
    details.setup.result.warnings.push("Could not find Settings in the account menu.");
  }
};

const closeSettingsDialogIfPresent = async (details: ConnectorSetupDetails): Promise<void> => {
  const closeButton = await readFirstVisible({
    page: details.page,
    selectors: [
      '[role="dialog"] button[aria-label="Close"]',
      '[role="dialog"] [data-testid="close-button"]',
    ],
  });
  if (closeButton) {
    await probeOrFallback(null, () => closeButton.click({ timeout: 2_000, force: true }));
    await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  }
};

type ClickDeleteMenuLineDetails = {
  deleteItem: Locator;
  page: import("playwright").Page;
};

const clickDeleteMenuLine = async (details: ClickDeleteMenuLineDetails): Promise<void> => {
  const deleteMenuClickTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  await details.deleteItem.click({ timeout: deleteMenuClickTimeoutMilliseconds, force: true });
  await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  await clickDeleteConfirmation({ page: details.page });
};

type ConfirmOpenConnectorDeletionDetails = {
  page: import("playwright").Page;
};

const confirmOpenConnectorDeletion = async (
  details: ConfirmOpenConnectorDeletionDetails,
): Promise<boolean> => {
  const deleteElement = await clickDeleteMenuElement({ page: details.page });

  const isDeleteElementMissing = deleteElement == null;
  if (isDeleteElementMissing) return false;

  await clickDeleteMenuLine({ deleteItem: deleteElement, page: details.page });
  return true;
};

type FindSelectedConnectorPillDetails = {
  page: ConnectorSetupDetails["page"];
  connectorName: string;
};

const findSelectedConnectorPill = async (
  details: FindSelectedConnectorPillDetails,
): Promise<Locator | null> => {
  const buttons = await details.page.locator('button[aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await probeOrFallback(null, () => button.getAttribute("aria-label"));

    const isRemoveButtonLabel = aria === `${details.connectorName}, click to remove`;
    if (isRemoveButtonLabel) return button;
  }
  return null;
};

type IsConnectorSelectedInComposerDetails = {
  setup: ConnectorSetupDetails;
};

const isConnectorSelectedInComposer = async (
  details: IsConnectorSelectedInComposerDetails,
): Promise<boolean> => {
  return !!(await findSelectedConnectorPill({
    page: details.setup.page,
    connectorName: details.setup.connectorName,
  }));
};

const removeStaleBridgeConnectorPills = async (details: ConnectorSetupDetails): Promise<void> => {
  const buttons = await details.page
    .locator('button[aria-label*="ai-browser-bridge"][aria-label*="click to remove"]')
    .all();
  for (const button of buttons) {
    const aria = await probeOrFallback(null, () => button.getAttribute("aria-label"));

    const isRemoveControlSkipped = !aria || aria === `${details.connectorName}, click to remove`;
    if (isRemoveControlSkipped) continue;

    await probeOrFallback(null, () => button.click({ timeout: 1_000, force: true }));
    await details.page.waitForTimeout(QUARTER_SECOND_MILLISECONDS);
  }
};

type NormalizeConnectorListLabelDetails = {
  value: string;
};

const cleanConnectorListLabel = (details: NormalizeConnectorListLabelDetails): string => {
  return cleanDisplayString({ value: details.value }).replace(/\s+/g, "").replace(/DEV$/i, "");
};

type FieldAfterLineDetails = {
  lines: string[];
  label: string;
};

const readFieldAfterLine = (details: FieldAfterLineDetails): string | null => {
  const index = details.lines.indexOf(details.label);
  const isIndexFound = index >= 0;
  const field = isIndexFound ? details.lines[index + 1] : null;
  return field?.trim() || null;
};

type ConnectorSummaryKeyDetails = {
  summary: { name: string; appId: string | null; url: string | null };
};

const readConnectorSummaryKey = (details: ConnectorSummaryKeyDetails): string => {
  const appId = details.summary.appId === undefined ? "" : details.summary.appId;
  const summaryUrl = details.summary.url === undefined ? "" : details.summary.url;
  return `${details.summary.name}\u0000${appId}\u0000${summaryUrl}`;
};

type SameConnectorAppDetails = {
  a: { appId: string | null; name: string; url: string | null };
  b: { appId: string | null; name: string; url: string | null };
};

const isSameConnectorApp = (details: SameConnectorAppDetails): boolean => {
  if (details.a.appId && details.b.appId) return details.a.appId === details.b.appId;

  return details.a.name === details.b.name && details.a.url === details.b.url;
};

type ConnectorSetupDetails = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupSettings;
  connectorName: string;
  returnUrl: string | null;
  result: ConnectorSetupReport;
};

type ExistingConnectorStatus = "missing" | "current" | "stale" | "unknown";

type ConnectorAppSummary = {
  name: string;
  appId: string | null;
  url: string | null;
};

type WarnMissingConnectorUrlFieldDetails = {
  setup: ConnectorSetupDetails;
};

const warnMissingConnectorUrlField = async (
  details: WarnMissingConnectorUrlFieldDetails,
): Promise<void> => {
  details.setup.result.warnings.push(
    "Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.",
  );

  if (details.setup.options.automatic) await restoreAfterConnectorSetup(details.setup);
};

const createNewConnector = async (details: ConnectorSetupDetails): Promise<void> => {
  await openAdvancedSettingsIfPresent(details);
  await enableDeveloperModeIfPresent(details);
  await openCreateConnectorForm(details);

  const didFillConnectorFormFields = await fillConnectorFormFields(details);

  const isFormFillFailed = !didFillConnectorFormFields;
  if (isFormFillFailed) {
    await warnMissingConnectorUrlField({ setup: details });
    return;
  }

  await finishConnectorCreation({ setup: details });
};

type DeleteConnectorAppBySummaryDetails = {
  page: ConnectorSetupDetails["page"];
  target: ConnectorAppSummary;
};

const deleteConnectorAppBySummary = async (
  details: DeleteConnectorAppBySummaryDetails,
): Promise<boolean> => {
  const maxDeleteAttempts = 3;

  for (let attempt = 0; attempt < maxDeleteAttempts; attempt += 1) {
    await openConnectorList({ page: details.page });
    const lines = await findBridgeConnectorButtons({ page: details.page });
    for (const line of lines) {
      const isOtherLine = line.name !== details.target.name;
      if (isOtherLine) continue;

      await line.button.click({ timeout: THREE_SECONDS_MILLISECONDS, force: true });
      const pauseAfterLineClickMilliseconds = 1_000;

      await details.page.waitForTimeout(pauseAfterLineClickMilliseconds);

      const open = await readOpenConnectorSummary({ page: details.page });

      const isConnectorMismatch = !open || !isSameConnectorApp({ a: open, b: details.target });
      if (isConnectorMismatch) continue;

      return deleteOpenConnectorIfPresent({ page: details.page });
    }
  }
  return false;
};

type DeleteDuplicateTargetsDetails = {
  setup: ConnectorSetupDetails;
  deleteTargets: ConnectorAppSummary[];
};

const deleteDuplicateTargets = async (details: DeleteDuplicateTargetsDetails): Promise<void> => {
  for (const target of details.deleteTargets) {
    const deleted = await deleteConnectorAppBySummary({ page: details.setup.page, target });
    if (deleted) {
      details.setup.result.steps.push(
        `Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`,
      );
    } else {
      details.setup.result.warnings.push(
        `Could not delete duplicate connector app: ${target.name}.`,
      );
    }
  }
};

type DeleteOpenConnectorIfPresentDetails = {
  page: Page;
};

const deleteOpenConnectorIfPresent = async (
  details: DeleteOpenConnectorIfPresentDetails,
): Promise<boolean> => {
  const manage = await readFirstVisible({
    page: details.page,
    selectors: ['[role="dialog"] button:has-text("Manage")'],
  });

  const isManageMissing = manage == null;
  if (isManageMissing) return false;

  const manageClickTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  await manage.click({ timeout: manageClickTimeoutMilliseconds, force: true });
  await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  return confirmOpenConnectorDeletion({ page: details.page });
};

const enableDeveloperModeIfPresent = async (details: ConnectorSetupDetails): Promise<void> => {
  const verdict = await details.page.evaluate(`() => {
  const labels = Array.from(document.querySelectorAll("body *"))
    .filter((node) => {
    const labelText = node.textContent;
    if (labelText === null) return false;
    return /Developer mode/i.test(labelText);
  });
  for (const label of labels.slice(0, 25)) {
    let scope = label;
    for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
      const controls = Array.from(scope.querySelectorAll(
        'button[role="switch"], input[type="checkbox"], button[aria-checked], [data-state="checked"], [data-state="unchecked"]',
      ));
      for (const control of controls) {
        const ariaChecked = control.getAttribute("aria-checked");
        const dataState = control.getAttribute("data-state");
        const checkbox = control instanceof HTMLInputElement && control.type === "checkbox" ? control : null;
        const checked = ariaChecked === "true" || dataState === "checked" || checkbox?.checked === true;
        if (checked) return "already-enabled";
        if (control instanceof HTMLElement) {
          control.click();
          return "enabled";
        }
      }
    }
  }
  return "not-found";
}`);

  const isVerdictEnabled = verdict === "enabled";
  if (isVerdictEnabled) {
    details.result.steps.push("Enabled Developer mode.");
    await details.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
    return;
  }

  const isAlreadyEnabled = verdict === "already-enabled";
  if (isAlreadyEnabled) {
    details.result.steps.push("Developer mode was already enabled.");
    return;
  }

  details.result.warnings.push(
    "Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.",
  );
};

const ensureComposerConnectorSelected = async (
  details: ConnectorSetupDetails,
): Promise<boolean> => {
  const isComposerConnectorSelected = await isConnectorSelectedInComposer({ setup: details });
  if (isComposerConnectorSelected) return true;

  await removeStaleBridgeConnectorPills(details);

  const isConnectorStillSelected = await isConnectorSelectedInComposer({ setup: details });
  if (isConnectorStillSelected) return true;

  return openComposerConnectorMenu(details);
};

type RunConnectorSetupStepsDetails = {
  setup: ConnectorSetupDetails;
  hasCurrentConnector: boolean;
};

const runConnectorSetupSteps = async (
  details: RunConnectorSetupStepsDetails,
): Promise<ConnectorSetupDetails["result"]> => {
  const isExistingConnectorFinalized = await tryFinalizeExistingConnector({
    setup: details.setup,
    hasCurrentConnector: details.hasCurrentConnector,
  });
  if (isExistingConnectorFinalized) {
    return details.setup.result;
  }

  const didCheckExistingConnector = await checkExistingConnector(details.setup);

  const isStaleConnectorNotHandled = !didCheckExistingConnector;
  if (isStaleConnectorNotHandled) return details.setup.result;

  await createNewConnector(details.setup);
  return details.setup.result;
};

const executeConnectorSetup = async (
  details: ConnectorSetupDetails,
): Promise<ConnectorSetupDetails["result"]> => {
  await openChatGptSettings(details);
  await openAppsOrConnectorsPanel(details);
  const hasCurrentConnector = await removeDuplicateConnectorApps(details);
  return runConnectorSetupSteps({ setup: details, hasCurrentConnector });
};

type FillConnectorUrlFieldDetails = {
  setup: ConnectorSetupDetails;
};

const fillConnectorUrlField = async (details: FillConnectorUrlFieldDetails): Promise<boolean> => {
  const filledUrl = await fillFirstVisible({
    page: details.setup.page,
    selectors: [
      'input[name="custom-connector-url"]',
      "#custom-connector-url",
      'input[type="url"]',
      'input[name*="url" i]',
      'input[placeholder*="https://" i]',
      'input[placeholder*="url" i]',
      'textarea[name*="url" i]',
      'textarea[placeholder*="https://" i]',
    ],
    value: details.setup.connectorUrl,
  });
  if (filledUrl)
    details.setup.result.steps.push(`Filled connector URL: ${details.setup.connectorUrl}`);

  return filledUrl;
};

type FillConnectorNameFieldDetails = {
  setup: ConnectorSetupDetails;
};

const fillConnectorNameField = async (details: FillConnectorNameFieldDetails): Promise<void> => {
  const filledName = await fillFirstVisible({
    page: details.setup.page,
    selectors: [
      'input[name="custom-connector-name"]',
      "#custom-connector-name",
      'input[name*="name" i]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
    ],
    value: details.setup.connectorName,
  });
  if (filledName)
    details.setup.result.steps.push(`Filled connector name: ${details.setup.connectorName}`);
};

const fillConnectorFormFields = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const didFillConnectorUrlField = await fillConnectorUrlField({ setup: details });

  const isUrlFieldNotFilled = !didFillConnectorUrlField;
  if (isUrlFieldNotFilled) return false;

  await fillConnectorNameField({ setup: details });
  return true;
};

const finalizeCurrentConnector = async (details: ConnectorSetupDetails): Promise<void> => {
  details.result.completed = true;
  details.result.steps.push("Existing connector already uses the current URL.");

  const hasRefreshedOpenConnector = await refreshOpenConnectorIfPresent(details);
  if (hasRefreshedOpenConnector) {
    details.result.steps.push("Refreshed the connector tool schema.");
  }

  await selectConnectorAfterSetup(details);
};

type FindBridgeConnectorButtonsDetails = {
  page: Page;
};

const findBridgeConnectorButtons = async (
  details: FindBridgeConnectorButtonsDetails,
): Promise<Array<{ button: Locator; name: string }>> => {
  const buttons = await details.page.locator(DIALOG_BUTTON_SELECTOR).all();
  const lines: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = cleanConnectorListLabel({
      value: await probeOrFallback("", () => readVisibleText(button)),
    });

    const isBridgeConnectorLabel = label.startsWith(BRIDGE_CONNECTOR_PREFIX);
    if (isBridgeConnectorLabel) {
      lines.push({ button, name: label });
    }
  }
  return lines;
};

type FindConnectorButtonDetails = {
  page: Page;
  connectorName: string;
};

const findConnectorButton = async (
  details: FindConnectorButtonDetails,
): Promise<Locator | null> => {
  const buttons = await details.page.locator(DIALOG_BUTTON_SELECTOR).all();
  for (const button of buttons) {
    const label = cleanConnectorListLabel({
      value: await probeOrFallback("", () => readVisibleText(button)),
    });

    const isConnectorLabel = label === details.connectorName;
    if (isConnectorLabel) return button;
  }
  return null;
};

type WaitForConnectorButtonDetails = {
  page: Page;
  connectorName: string;
  timeoutMs: number;
};

const waitForConnectorButton = async (details: WaitForConnectorButtonDetails): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < details.timeoutMs) {
    const button = await findConnectorButton({
      page: details.page,
      connectorName: details.connectorName,
    });

    const isButtonVisible = button && (await probeOrFallback(false, () => button.isVisible()));
    if (isButtonVisible) return true;

    await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  }
  return false;
};

type ObjectConnectorFormSettingsDetails = {
  setup: ConnectorSetupDetails;
};

const saveConnectorFormSettings = async (
  details: ObjectConnectorFormSettingsDetails,
): Promise<void> => {
  const hasSelectedNoAuthentication = await selectNoAuthenticationIfPresent(details.setup);
  if (hasSelectedNoAuthentication) {
    details.setup.result.steps.push("Selected no-authentication option when visible.");
  }

  const hasAcceptedCustomMcpRisk = await acceptCustomMcpRiskIfPresent(details.setup);
  if (hasAcceptedCustomMcpRisk) {
    details.setup.result.steps.push("Accepted custom MCP server risk notice.");
  }
};

type FinishConnectorCreationDetails = {
  setup: ConnectorSetupDetails;
};

const finishConnectorCreation = async (details: FinishConnectorCreationDetails): Promise<void> => {
  await saveConnectorFormSettings({ setup: details.setup });
  await submitConnectorForm(details.setup);

  if (details.setup.options.automatic && !details.setup.result.completed) {
    await restoreAfterConnectorSetup(details.setup);
  }
};

const checkExistingConnector = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(details);

  const isExistingStale = existing === STALE_STATUS;
  if (isExistingStale) return deleteStaleConnector(details);

  const isExistingUnknown = existing === UNKNOWN_STATUS;
  if (isExistingUnknown) {
    details.result.warnings.push(
      "Existing connector was found, but its URL could not be read from the settings panel.",
    );
  }

  return true;
};

const deleteStaleConnector = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const hasDeletedOpenConnector = await deleteOpenConnectorIfPresent({ page: details.page });
  if (hasDeletedOpenConnector) {
    details.result.steps.push(
      "Deleted stale connector app before recreating it with the new tunnel URL.",
    );
    await returnToConnectorListIfNeeded(details);
    await openAppsOrConnectorsPanel(details);
    await openAdvancedSettingsIfPresent(details);
    return true;
  }

  details.result.warnings.push(
    "Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.",
  );

  if (details.options.automatic) await restoreAfterConnectorSetup(details);

  return false;
};

type HoverAndClickMoreMenuElementDetails = {
  setup: ConnectorSetupDetails;
};

const hoverAndClickMoreMenuElement = async (
  details: HoverAndClickMoreMenuElementDetails,
): Promise<boolean> => {
  const moreElement = await readFirstVisible({
    page: details.setup.page,
    selectors: [
      '[role="menuitem"][aria-haspopup="menu"]:has-text("More")',
      '[role="menuitem"]:has-text("More")',
    ],
  });

  const isMoreElementMissing = moreElement == null;
  if (isMoreElementMissing) return false;

  await clickMoreMenuElement({ moreItem: moreElement, setup: details.setup });
  return true;
};

type InitConnectorSetupDetailsDetails = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupSettings;
};

const initConnectorSetupDetails = (
  details: InitConnectorSetupDetailsDetails,
): ConnectorSetupDetails => {
  const connectorName =
    details.options.connectorName == null ? "ai-browser-bridge" : details.options.connectorName;
  const setupPageUrl = details.page.url();
  const returnUrl = readChatGptReturnUrl({ url: setupPageUrl });

  return {
    page: details.page,
    connectorUrl: details.connectorUrl,
    options: details.options,
    connectorName,
    returnUrl,
    result: {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [],
    },
  };
};

type CollectConnectorSummariesDetails = {
  page: Page;
  entryCount: number;
};

const collectConnectorSummaries = async (
  details: CollectConnectorSummariesDetails,
): Promise<ConnectorAppSummary[]> => {
  const summaries: ConnectorAppSummary[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < details.entryCount; index += 1) {
    const connectorSummaryAtIndex = await readConnectorSummaryAtIndex({
      page: details.page,
      index,
    });
    appendUniqueSummary({
      summaries,
      seen,
      summary: connectorSummaryAtIndex,
    });
  }

  return summaries;
};

type ListBridgeConnectorSummariesDetails = {
  page: Page;
};

const listBridgeConnectorSummaries = async (
  details: ListBridgeConnectorSummariesDetails,
): Promise<ConnectorAppSummary[]> => {
  await openConnectorList({ page: details.page });
  const lineCount = (await findBridgeConnectorButtons({ page: details.page })).length;
  const summaries = await collectConnectorSummaries({ page: details.page, entryCount: lineCount });
  await openConnectorList({ page: details.page });
  return summaries;
};

const openAdvancedSettingsIfPresent = async (details: ConnectorSetupDetails): Promise<void> => {
  const opened = await clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("Advanced settings")',
      'button:has-text("Advanced Settings")',
      'a:has-text("Advanced settings")',
      '[role="tab"]:has-text("Advanced")',
      'button:has-text("Advanced")',
    ],
    timeout: ONE_AND_HALF_SECONDS_MILLISECONDS,
  });
  if (opened) details.result.steps.push("Opened Advanced settings.");
};

const openAppsOrConnectorsPanel = async (details: ConnectorSetupDetails): Promise<void> => {
  const connectorsTabTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  const opened = await clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("Apps")',
      'a:has-text("Apps")',
      '[role="tab"]:has-text("Apps")',
      'button:has-text("Connectors")',
      'a:has-text("Connectors")',
      '[role="tab"]:has-text("Connectors")',
    ],
    timeout: connectorsTabTimeoutMilliseconds,
  });
  if (opened) {
    details.result.steps.push("Opened Apps/Connectors settings.");
  } else {
    details.result.warnings.push(
      "Could not find Apps/Connectors in settings. Use Settings -> Apps manually.",
    );
  }
};

const openChatGptSettings = async (details: ConnectorSetupDetails): Promise<void> => {
  await probeOrFallback(null, () =>
    details.page.goto("https://chatgpt.com/#settings/Connectors", {
      waitUntil: "domcontentloaded",
    }),
  );
  await details.page.waitForTimeout(ONE_AND_HALF_SECONDS_MILLISECONDS);

  const settingsDialogOpen = await probeOrFallback(false, () =>
    details.page
      .locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")')
      .first()
      .isVisible(),
  );
  if (settingsDialogOpen) {
    details.result.steps.push("Opened ChatGPT settings.");
    return;
  }

  await openSettingsFromAccountMenu(details);
};

type OpenComposerPlusMenuDetails = {
  setup: ConnectorSetupDetails;
};

const openComposerPlusMenu = async (details: OpenComposerPlusMenuDetails): Promise<boolean> => {
  const plusButton = await readFirstVisible({
    page: details.setup.page,
    selectors: [
      '[data-testid="composer-plus-btn"]',
      ADD_FILES_BUTTON_SELECTOR,
      'button[aria-label*="Add files" i]',
    ],
  });

  const isPlusButtonMissing = plusButton == null;
  if (isPlusButtonMissing) return false;

  await plusButton.click({ timeout: FIVE_SECONDS_MILLISECONDS, force: true });
  await details.setup.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
  return true;
};

const openComposerConnectorMenu = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const didOpenComposerPlusMenu = await openComposerPlusMenu({ setup: details });

  const isComposerPlusMenuNotOpened = !didOpenComposerPlusMenu;
  if (isComposerPlusMenuNotOpened) return false;

  const isConnectorMenuElementClicked = await clickConnectorMenuElement({
    page: details.page,
    connectorName: details.connectorName,
  });
  if (isConnectorMenuElementClicked) return true;

  return clickConnectorFromMoreMenu(details);
};

type OpenConnectorDetailsPanelDetails = {
  setup: ConnectorSetupDetails;
};

const openConnectorDetailsPanel = async (
  details: OpenConnectorDetailsPanelDetails,
): Promise<boolean> => {
  const button = await findConnectorButton({
    page: details.setup.page,
    connectorName: details.setup.connectorName,
  });

  const isButtonMissing = button == null;
  if (isButtonMissing) return false;

  await clickConnectorDetailsButton({ button, setup: details.setup });
  return true;
};

type OpenConnectorListDetails = {
  page: Page;
};

const openConnectorList = async (details: OpenConnectorListDetails): Promise<void> => {
  await probeOrFallback(null, () =>
    details.page.goto("https://chatgpt.com/#settings/Connectors", {
      waitUntil: "domcontentloaded",
    }),
  );
  const pauseAfterConnectorsOpenMilliseconds = 1_000;

  await details.page.waitForTimeout(pauseAfterConnectorsOpenMilliseconds);

  const backButton = await readFirstVisible({
    page: details.page,
    selectors: [DIALOG_BACK_BUTTON_SELECTOR],
  });
  if (backButton) {
    await probeOrFallback(null, () => backButton.click({ timeout: 2_000, force: true }));
    await details.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
  }
};

const openCreateConnectorForm = async (details: ConnectorSetupDetails): Promise<void> => {
  const connectButtonTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  const opened = await clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("Create app")',
      'button:has-text("Create App")',
      CREATE_BUTTON_SELECTOR,
      'button:has-text("Add connector")',
      'button:has-text("Add Connector")',
      'button:has-text("New app")',
      'button:has-text("New App")',
      CONNECT_BUTTON_SELECTOR,
    ],
    timeout: connectButtonTimeoutMilliseconds,
  });
  if (opened) {
    details.result.steps.push("Opened connector/app creation form.");
  } else {
    details.result.warnings.push(
      "Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.",
    );
  }
};

type ReadConnectorStatusDetails = {
  setup: ConnectorSetupDetails;
};

const readConnectorStatus = (details: ReadConnectorStatusDetails) => {
  return readOpenConnectorStatus({
    page: details.setup.page,
    connectorName: details.setup.connectorName,
    connectorUrl: details.setup.connectorUrl,
  });
};

const openExistingConnectorDetails = async (
  details: ConnectorSetupDetails,
): Promise<ExistingConnectorStatus> => {
  const alreadyOpen = await readConnectorStatus({ setup: details });

  const isAlreadyOpenNotMissing = alreadyOpen !== MISSING_STATUS;
  if (isAlreadyOpenNotMissing) return alreadyOpen;

  const didOpenConnectorDetailsPanel = await openConnectorDetailsPanel({ setup: details });

  const isConnectorDetailsNotOpened = !didOpenConnectorDetailsPanel;
  if (isConnectorDetailsNotOpened) return MISSING_STATUS;

  return readConnectorStatus({ setup: details });
};

const openSettingsFromAccountMenu = async (details: ConnectorSetupDetails): Promise<void> => {
  await probeOrFallback(null, () =>
    details.page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }),
  );
  await probeOrFallback(null, () =>
    details.page.waitForSelector(SELECTORS.promptInput, {
      state: "visible",
      timeout: 15_000,
    }),
  );

  const accountMenuTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  const didClickAccountMenu = await clickFirstVisible({
    page: details.page,
    selectors: SELECTORS.accountMenuButton,
    timeout: accountMenuTimeoutMilliseconds,
  });

  const isAccountMenuNotClicked = !didClickAccountMenu;
  if (isAccountMenuNotClicked) {
    details.result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }

  details.result.steps.push("Opened ChatGPT account menu.");
  await clickSettingsLine({ setup: details });
};

type ReadConnectorSummaryAtIndexDetails = {
  page: Page;
  index: number;
};

const readConnectorSummaryAtIndex = async (details: ReadConnectorSummaryAtIndexDetails) => {
  const didClickConnectorListLine = await clickConnectorListLine({
    page: details.page,
    index: details.index,
  });

  const isConnectorListLineNotClicked = !didClickConnectorListLine;
  if (isConnectorListLineNotClicked) return null;

  return readOpenConnectorSummary({ page: details.page });
};

type ReadOpenConnectorStatusDetails = {
  page: Page;
  connectorName: string;
  connectorUrl: string;
};

const readOpenConnectorStatus = async (
  details: ReadOpenConnectorStatusDetails,
): Promise<ExistingConnectorStatus> => {
  const string = await readSettingsDialogString({ page: details.page });

  const isConnectorDetailsIncomplete =
    !string.includes(details.connectorName) || !/\b(URL|App Id|Version Id)\b/i.test(string);
  if (isConnectorDetailsIncomplete) return MISSING_STATUS;

  const isConnectorUrlIn = string.includes(details.connectorUrl);
  if (isConnectorUrlIn) return CURRENT_STATUS;

  const hasUrlLine = /\bURL\s+https?:\/\//i.test(string);
  if (hasUrlLine) return STALE_STATUS;

  return UNKNOWN_STATUS;
};

type ParseConnectorSummaryLinesDetails = {
  lines: string[];
};

const parseConnectorSummaryLines = (
  details: ParseConnectorSummaryLinesDetails,
): ConnectorAppSummary | null => {
  const backIndex = details.lines.indexOf("Back");
  let name = "";

  const isBackIndexFound = backIndex >= 0;
  if (isBackIndexFound) {
    const nextLine = details.lines[backIndex + 1];
    const isNextLineMissing = nextLine == null;
    name = isNextLineMissing ? "" : nextLine;
  }

  const isNotBridgeConnector = !name.startsWith(BRIDGE_CONNECTOR_PREFIX);
  if (isNotBridgeConnector) return null;

  return {
    name,
    appId: readFieldAfterLine({ lines: details.lines, label: "App Id" }),
    url: readFieldAfterLine({ lines: details.lines, label: "URL" }),
  };
};

type ReadOpenConnectorSummaryDetails = {
  page: Page;
};

const readOpenConnectorSummary = async (
  details: ReadOpenConnectorSummaryDetails,
): Promise<ConnectorAppSummary | null> => {
  const string = await probeOrFallback("", () =>
    readVisibleText(details.page.locator('[role="dialog"]').last()),
  );
  const lines = string
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter(Boolean);

  return parseConnectorSummaryLines({ lines });
};

const refreshOpenConnectorIfPresent = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const refreshButtonTimeoutMilliseconds = 1_000;

  return clickFirstVisible({
    page: details.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: refreshButtonTimeoutMilliseconds,
  });
};

const restoreAfterConnectorSetup = async (details: ConnectorSetupDetails): Promise<void> => {
  await closeSettingsDialogIfPresent(details);
  await restoreReturnUrlIfNeeded(details);
};

const restoreReturnUrlIfNeeded = async (details: ConnectorSetupDetails): Promise<void> => {
  const pageUrl = details.page.url();

  const currentReturnUrl = readChatGptReturnUrl({ url: pageUrl });
  if (details.returnUrl && currentReturnUrl !== details.returnUrl) {
    await probeOrFallback(null, () =>
      details.page.goto(details.returnUrl, { waitUntil: "domcontentloaded" }),
    );
  }

  await probeOrFallback(null, () =>
    details.page.waitForSelector(SELECTORS.promptInput, {
      state: "visible",
      timeout: 15_000,
    }),
  );
};

const returnToConnectorListIfNeeded = async (details: ConnectorSetupDetails): Promise<void> => {
  const back = await readFirstVisible({
    page: details.page,
    selectors: [DIALOG_BACK_BUTTON_SELECTOR],
  });
  if (back) {
    await probeOrFallback(null, () => back.click({ timeout: 2_000, force: true }));
    await details.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
  }
};

const selectConnectorAfterSetup = async (details: ConnectorSetupDetails): Promise<void> => {
  const selectedInComposer = await selectConnectorInComposer(details);
  if (selectedInComposer) {
    details.result.steps.push("Selected the connector in the composer.");
  } else {
    details.result.warnings.push(
      "Connector is configured, but the composer menu did not expose it for automatic selection.",
    );
  }
};

const selectConnectorInComposer = async (details: ConnectorSetupDetails): Promise<boolean> => {
  await closeSettingsDialogIfPresent(details);
  await restoreReturnUrlIfNeeded(details);
  await probeOrFallback(null, () => details.page.keyboard.press("Escape"));
  return ensureComposerConnectorSelected(details);
};

const selectNoAuthenticationIfPresent = async (
  details: ConnectorSetupDetails,
): Promise<boolean> => {
  const authSelect = details.page.locator("select#custom-connector-auth").first();

  const isAuthSelectVisible =
    (await authSelect.count()) > 0 && (await probeOrFallback(false, () => authSelect.isVisible()));
  if (isAuthSelectVisible) {
    await authSelect.selectOption("NONE");
    await probeOrFallback(null, () => authSelect.dispatchEvent("change"));
    return true;
  }

  const noneButtonTimeoutMilliseconds = 1_000;

  return clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("No authentication")',
      'button:has-text("No Authentication")',
      'label:has-text("No authentication")',
      'label:has-text("No Authentication")',
      '[role="radio"]:has-text("No authentication")',
      '[role="radio"]:has-text("No Auth")',
      '[role="option"]:has-text("No authentication")',
      '[role="option"]:has-text("No Auth")',
      'button:has-text("No Auth")',
      'button:has-text("None")',
    ],
    timeout: noneButtonTimeoutMilliseconds,
  });
};

type SettingsDialogStringDetails = {
  page: Page;
};

const readSettingsDialogString = async (details: SettingsDialogStringDetails): Promise<string> => {
  return cleanDisplayString({
    value: await probeOrFallback("", () =>
      readVisibleText(details.page.locator('[role="dialog"]').last()),
    ),
  });
};

const setupMcpConnectorInChatGpt = async (
  page: Page,
  connectorUrl: string,
  settings: ConnectorSetupSettings = {},
): Promise<ConnectorSetupReport> => {
  const setupDetails = initConnectorSetupDetails({ page, connectorUrl, options: settings });
  return executeConnectorSetup(setupDetails);
};

type ConnectorFormStillOpenDetails = {
  setup: ConnectorSetupDetails;
};

const isConnectorFormStillOpen = async (
  details: ConnectorFormStillOpenDetails,
): Promise<boolean> => {
  return probeOrFallback(false, () =>
    details.setup.page
      .locator('input[name="custom-connector-url"], #custom-connector-url')
      .first()
      .isVisible(),
  );
};

type MarkConnectorSubmitCompletedDetails = {
  setup: ConnectorSetupDetails;
};

const markConnectorSubmitCompleted = async (
  details: MarkConnectorSubmitCompletedDetails,
): Promise<void> => {
  details.setup.result.completed = true;
  details.setup.result.steps.push("Submitted the connector form.");
  await selectConnectorAfterSetup(details.setup);
};

type WarnConnectorSubmitIncompleteDetails = {
  setup: ConnectorSetupDetails;
};

const warnConnectorSubmitIncomplete = async (
  details: WarnConnectorSubmitIncompleteDetails,
): Promise<void> => {
  const connectorWaitTimeoutMilliseconds = 20_000;

  const appVisible = await waitForConnectorButton({
    page: details.setup.page,
    connectorName: details.setup.connectorName,
    timeoutMs: connectorWaitTimeoutMilliseconds,
  });

  const formStillOpen = await isConnectorFormStillOpen({ setup: details.setup });

  const isFormStuckOpen = formStillOpen && !appVisible;
  if (isFormStuckOpen) {
    details.setup.result.warnings.push(
      "Connector form is still open after submit. Check the visible validation message in ChatGPT settings.",
    );
    return;
  }

  await markConnectorSubmitCompleted({ setup: details.setup });
};

const submitConnectorForm = async (details: ConnectorSetupDetails): Promise<void> => {
  const connectButtonRetryTimeoutMilliseconds = TWO_SECONDS_MILLISECONDS;

  const submitted = await clickFirstVisible({
    page: details.page,
    selectors: [
      CREATE_BUTTON_SELECTOR,
      'button:has-text("Save")',
      'button:has-text("Add")',
      CONNECT_BUTTON_SELECTOR,
    ],
    timeout: connectButtonRetryTimeoutMilliseconds,
  });

  const isNotSubmitted = !submitted;
  if (isNotSubmitted) {
    details.result.warnings.push(
      "Connector form was filled, but no Create/Save/Add button was visible or enabled.",
    );
    return;
  }

  await warnConnectorSubmitIncomplete({ setup: details });
};

type FinalizeIfCurrentConnectorDetails = {
  setup: ConnectorSetupDetails;
};

const finalizeIfCurrentConnector = async (
  details: FinalizeIfCurrentConnectorDetails,
): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(details.setup);

  const isExistingNotCurrent = existing !== CURRENT_STATUS;
  if (isExistingNotCurrent) return false;

  await finalizeCurrentConnector(details.setup);
  return true;
};

type TryFinalizeExistingConnectorDetails = {
  setup: ConnectorSetupDetails;
  hasCurrentConnector: boolean;
};

const tryFinalizeExistingConnector = async (
  details: TryFinalizeExistingConnectorDetails,
): Promise<boolean> => {
  const hasFinalizedCurrentConnector =
    details.hasCurrentConnector && (await finalizeIfCurrentConnector({ setup: details.setup }));
  if (hasFinalizedCurrentConnector) return true;

  return finalizeIfCurrentConnector({ setup: details.setup });
};

const captureAllMessages = async (
  page: Page,
  settings: CaptureMessagesSettings = {},
): Promise<Array<{ role: string; content: string }>> => {
  const pageConversationId = readConversationIdFromPage({ page });
  return extractAllMessages(page, {
    conversationId: pageConversationId,
    manifestRoot: settings.manifestRoot,
  });
};

const sanitizeCapturedString = (field: string): string => {
  return field
    .replace(/\s*\[object Object\]\s*/g, SPACE)
    .replace(/\s+/g, SPACE)
    .trim();
};

const captureLastReply = async (
  page: Page,
  settings: CaptureMessagesSettings = {},
): Promise<string> => {
  const assistantConversationId = readConversationIdFromPage({ page });
  const { text: string } = await extractAssistantMessage(page, {
    conversationId: assistantConversationId,
    manifestRoot: settings.manifestRoot,
  });

  const cleaned = sanitizeCapturedString(string);

  const isCleanedStringValid = cleaned && !/\[object Object\]/.test(string);
  if (isCleanedStringValid) return cleaned;

  const fallback = await probeOrFallback("", () =>
    readVisibleText(page.locator(SELECTORS.lastResponse).last()),
  );
  return sanitizeCapturedString(fallback) || cleaned;
};

type ConversationIdFromPageDetails = {
  page: Page;
};

const readConversationIdFromPage = (details: ConversationIdFromPageDetails): string => {
  const currentPageUrl = details.page.url();
  const conversationId = readChatGptConversationIdFromUrl(currentPageUrl);

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return CURRENT_STATUS;

  return conversationId;
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

const waitForGenerationIdle = async (page: Page, timeoutMs?: number): Promise<void> => {
  await waitForReplyIdle(page, SELECTORS.streamingIndicator, timeoutMs);
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  const targetUrl = readChatGptConversationUrlFromIdOrUrl(url);

  const openPageUrl = page.url();
  if (isSameChatGptConversation(openPageUrl, targetUrl)) {
    await probeOrFallback(null, () =>
      page.waitForSelector(SELECTORS.promptInput, {
        state: "visible",
        timeout: 30_000,
      }),
    );
    return;
  }

  await waitForGenerationIdle(page);
  await page.goto(targetUrl);
  await page.waitForSelector(SELECTORS.promptInput, {
    state: VISIBLE_WAIT_MODE,
    timeout: THIRTY_SECONDS_MILLISECONDS,
  });
  await Promise.allSettled([
    page
      .locator(SELECTORS.conversationTurn)
      .first()
      .waitFor({ timeout: FIFTEEN_SECONDS_MILLISECONDS }),
  ]);
};

const openNewConversation = async (page: Page): Promise<void> => {
  await page.goto(CHATGPT_HOME_URL);
  await page.waitForSelector(SELECTORS.promptInput, {
    state: VISIBLE_WAIT_MODE,
    timeout: THIRTY_SECONDS_MILLISECONDS,
  });
};

type SidebarConversationLine = {
  id: string;
  title: string;
  url: string;
};

type SidebarConversationLink = {
  href: string | null;
  title: string;
};

export const parseChatGptSidebarConversationLink = (
  link: SidebarConversationLink,
): SidebarConversationLine | null => {
  const href = link.href == null ? "" : link.href.trim();

  const title = link.title.trim();

  const isLinkIncomplete = !href || !title;
  if (isLinkIncomplete) return null;

  const parsedUrl = new URL(href, CHATGPT_ORIGIN_URL);
  const pathParts = parsedUrl.pathname.split(SLASH).filter(Boolean);
  const lastPathPart = pathParts.pop();

  const isLastPathPartMissing = lastPathPart == null;
  const id = isLastPathPartMissing ? "" : lastPathPart;

  const isIdEmpty = !id;
  if (isIdEmpty) return null;

  return { id, title, url: parsedUrl.toString() };
};

const parseSidebarLink = async (link: Locator): Promise<SidebarConversationLine | null> => {
  const href = await link.getAttribute(HREF_ATTRIBUTE);
  const title = await readVisibleText(link);
  return parseChatGptSidebarConversationLink({ href, title });
};

const readLooseConversationsFromScanPage = async (
  page: Page,
): Promise<SidebarConversationLine[]> => {
  const scanPage = await page.context().newPage();

  try {
    await scanPage.goto(CHATGPT_HOME_URL, { waitUntil: "domcontentloaded" });
    return await readLooseConversations(scanPage);
  } finally {
    await probeOrFallback(null, () => scanPage.close());
  }
};

const readSidebarConversations = async (
  page: Page,
  settings: { readonly orphans?: boolean } = {},
): Promise<SidebarConversationLine[]> => {
  if (settings.orphans) return readLooseConversationsFromScanPage(page);

  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: SidebarConversationLine[] = [];
  for (const link of links) {
    const line = await parseSidebarLink(link);

    const isParsedLine = line != null;
    if (isParsedLine) conversations.push(line);
  }
  return conversations;
};

type ClickFirstVisibleDetails = {
  page: Page;
  selectors: readonly string[];
  timeout?: number;
};

const clickFirstVisible = async (details: ClickFirstVisibleDetails): Promise<boolean> => {
  const defaultClickTimeoutMilliseconds = 1_000;

  const timeout = details.timeout == null ? defaultClickTimeoutMilliseconds : details.timeout;
  for (const selector of details.selectors) {
    const locator = details.page.locator(selector).first();
    await probeOrFallback(null, () => locator.waitFor({ state: "visible", timeout }));

    const isLocatorVisible =
      (await locator.count()) > 0 && (await probeOrFallback(false, () => locator.isVisible()));
    if (isLocatorVisible) {
      // A failed plain click is retried with force before the next candidate locator.
      const isPlainClickLanded = await probeOrFallback(false, async () => {
        await locator.click({ timeout });
        return true;
      });
      if (isPlainClickLanded) return true;

      const isForcedClickLanded = await probeOrFallback(false, async () => {
        await locator.click({ timeout, force: true });
        return true;
      });
      if (isForcedClickLanded) return true;
    }
  }
  return false;
};

type FillFirstVisibleDetails = {
  page: import("playwright").Page;
  selectors: readonly string[];
  value: string;
};

type FillVisibleFieldDetails = {
  field: Locator;
  value: string;
};

const fillVisibleField = async (details: FillVisibleFieldDetails): Promise<void> => {
  await details.field.fill(details.value);
  await probeOrFallback(null, () => details.field.dispatchEvent("input"));
  await probeOrFallback(null, () => details.field.dispatchEvent("change"));
};

const fillFirstVisible = async (details: FillFirstVisibleDetails): Promise<boolean> => {
  const field = await readFirstVisible({ page: details.page, selectors: details.selectors });

  const isFieldMissing = field == null;
  if (isFieldMissing) return false;

  await fillVisibleField({ field, value: details.value });
  return true;
};

type FirstVisibleInDetails = {
  parent: Locator;
  selectors: readonly string[];
};

const readFirstVisibleIn = async (details: FirstVisibleInDetails): Promise<Locator | null> => {
  for (const selector of details.selectors) {
    const locator = details.parent.locator(selector).filter({ visible: true }).first();
    const locatorCount = await locator.count();

    const hasLocatorHit = locatorCount > 0;
    if (hasLocatorHit) return locator;
  }
  return null;
};

type FirstVisibleDetails = {
  page: Page;
  selectors: readonly string[];
};

const readFirstVisible = async (details: FirstVisibleDetails): Promise<Locator | null> => {
  for (const selector of details.selectors) {
    const locator = details.page.locator(selector).filter({ visible: true }).first();
    const locatorCount = await locator.count();

    const hasLocatorHit = locatorCount > 0;
    if (hasLocatorHit) return locator;
  }
  return null;
};

type NormalizeDisplayStringDetails = {
  value: string;
};

const cleanDisplayString = (details: NormalizeDisplayStringDetails): string => {
  return details.value
    .replace(/\s+/g, SPACE)
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
};

type NormalizeModelQueryDetails = {
  value: string;
};

const cleanModelQuery = (details: NormalizeModelQueryDetails): string => {
  return details.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, SPACE)
    .replace(/\s+/g, SPACE)
    .trim();
};

type ClickModelAndDetectDetails = {
  page: Page;
  item: Locator;
};

const clickModelAndDetect = async (details: ClickModelAndDetectDetails): Promise<string> => {
  await details.item.click();
  await probeOrFallback(null, () =>
    details.page.locator(SELECTORS.openMenu).waitFor({ state: "hidden", timeout: 5_000 }),
  );
  await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);

  return detectCurrentModel(details.page);
};

type CollectModelsFromElementsDetails = {
  items: Locator[];
};

const collectModelsFromElements = async (
  details: CollectModelsFromElementsDetails,
): Promise<ModelOption[]> => {
  const models: ModelOption[] = [];
  for (const element of details.items) {
    const option = await parseModelMenuElement({ item: element });

    const isOptionNotListed =
      option && !models.some((model) => model.id === option.id && model.label === option.label);
    if (isOptionNotListed) {
      models.push(option);
    }
  }
  return models;
};

type CloseModelMenuDetails = {
  page: Page;
};

const closeModelMenu = async (details: CloseModelMenuDetails): Promise<void> => {
  await probeOrFallback(null, () => details.page.keyboard.press("Escape"));
};

type DetectCheckedModelFromMenuOnceDetails = {
  page: Page;
};

const detectCheckedModelFromMenuOnce = async (
  details: DetectCheckedModelFromMenuOnceDetails,
): Promise<string | null> => {
  try {
    await openModelMenu({ page: details.page });
    const checkedModel = await readCheckedModelFromOpenMenu({ page: details.page });
    await probeOrFallback(null, () => details.page.keyboard.press("Escape"));
    return checkedModel;
  } catch (error) {
    logUnlessElementMissing(error);
    await probeOrFallback(null, () => details.page.keyboard.press("Escape"));
    return null;
  }
};

type DetectCheckedModelFromMenuDetails = {
  page: Page;
};

const detectCheckedModelFromMenu = async (
  details: DetectCheckedModelFromMenuDetails,
): Promise<string | null> => {
  const maxMenuReadAttempts = 4;

  for (let attempt = 0; attempt < maxMenuReadAttempts; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: details.page });
    if (checkedModel) return checkedModel;

    await details.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
  }
  return null;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  return probeOrFallback(CHATGPT_APP_NAME, async () => {
    const fromDom = await readCheckedModelFromDom({ page });
    if (fromDom) return fromDom;

    const fromTrigger = await readModelFromTrigger({ page });
    if (fromTrigger) return fromTrigger;

    const fromMenu = await detectCheckedModelFromMenu({ page });

    const isFromMenuMissing = fromMenu == null;
    if (isFromMenuMissing) return CHATGPT_APP_NAME;

    return fromMenu;
  });
};

type FindModelMenuHitDetails = {
  page: Page;
  normalizedQuery: string;
};

const findModelMenuHit = async (details: FindModelMenuHitDetails): Promise<Locator | null> => {
  const elements = await listModelMenuElements(details.page);
  let fallback: Locator | null = null;
  for (const element of elements) {
    const hit = await readModelElementHitReport({
      item: element,
      normalizedQuery: details.normalizedQuery,
    });
    if (hit.matched) return element;

    const isFallbackEmpty = !fallback;

    const hasHitFallback = Boolean(hit.fallback);
    const isFirstFallbackFound = isFallbackEmpty && hasHitFallback;
    if (isFirstFallbackFound) fallback = hit.fallback;
  }
  return fallback;
};

const isLikelyModelLabel = (field: string): boolean => {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(field);
};

type IsSelectedModelElementDetails = {
  item: Locator;
};

const isSelectedModelElement = async (details: IsSelectedModelElementDetails): Promise<boolean> => {
  const ariaChecked = await probeOrFallback(null, () => details.item.getAttribute("aria-checked"));

  const isAriaCheckedRequested = ariaChecked === "true";
  if (isAriaCheckedRequested) return true;

  const toggleStatus = await probeOrFallback(null, () => details.item.getAttribute("data-state"));
  return toggleStatus === "checked";
};

const listAvailableModels = async (page: Page) => {
  await openModelMenu({ page });
  const elements = await listModelMenuElements(page);
  const models = await collectModelsFromElements({ items: elements });
  await closeModelMenu({ page });
  return models;
};

type ModelElementHitReportDetails = {
  item: Locator;
  normalizedQuery: string;
};

type ModelElementHitReport = {
  matched: boolean;
  fallback: Locator | null;
};

type ModelElementHitDetails = {
  item: Locator;
  label: string;
  normalizedQuery: string;
  searchable: string;
};

const readModelElementHit = (details: ModelElementHitDetails): ModelElementHitReport => {
  const isQueryMatched =
    details.searchable === details.normalizedQuery ||
    details.searchable.includes(details.normalizedQuery);
  if (isQueryMatched) {
    return { matched: true, fallback: null };
  }

  const cleanedLabelQuery = cleanModelQuery({ value: details.label });
  const isQueryContainingLabel = details.normalizedQuery.includes(cleanedLabelQuery);
  const fallback = isQueryContainingLabel ? details.item : null;
  return { matched: false, fallback };
};

const readModelElementHitReport = async (
  details: ModelElementHitReportDetails,
): Promise<ModelElementHitReport> => {
  const label = await readModelElementLabel({ item: details.item });
  const id = await readModelElementId({ item: details.item });
  const searchable = cleanModelQuery({ value: `${label} ${id}` });

  const isLabelUnusable = !label || !isLikelyModelLabel(label);
  if (isLabelUnusable) return { matched: false, fallback: null };

  return readModelElementHit({
    item: details.item,
    label,
    normalizedQuery: details.normalizedQuery,
    searchable,
  });
};

const listModelMenuElements = async (page: Page): Promise<Locator[]> => {
  const modelMenuCssSelector = [
    '[role="menu"] [role="menuitem"]',
    '[role="menu"] [role="menuitemradio"]',
    '[data-radix-menu-content] [role="menuitem"]',
    '[data-radix-menu-content] [role="menuitemradio"]',
    '[role="menu"] [data-testid^="model-switcher-"]',
    '[data-radix-menu-content] [data-testid^="model-switcher-"]',
  ].join(LIST_SEPARATOR);

  return page.locator(modelMenuCssSelector).all();
};

type ClickModelTriggerDetails = {
  trigger: NonNullable<Awaited<ReturnType<typeof readFirstVisible>>>;
};

const clickModelTrigger = async (details: ClickModelTriggerDetails): Promise<void> => {
  try {
    await details.trigger.click({ timeout: FIVE_SECONDS_MILLISECONDS });
  } catch (error) {
    logUnlessElementMissing(error);
    await details.trigger.click({ timeout: FIVE_SECONDS_MILLISECONDS, force: true });
  }
};

type OpenModelMenuDetails = {
  page: Page;
};

const openModelMenu = async (details: OpenModelMenuDetails): Promise<void> => {
  const modelTriggerSelector = SELECTORS.modelTrigger.join(LIST_SEPARATOR);
  await probeOrFallback(null, () =>
    details.page
      .locator(modelTriggerSelector)
      .first()
      .waitFor({ state: "visible", timeout: 5_000 }),
  );

  const trigger = await readFirstVisible({ page: details.page, selectors: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) throw new Error("Could not find ChatGPT model switcher button.");

  await clickModelTrigger({ trigger });
  await details.page
    .locator(SELECTORS.openMenu)
    .first()
    .waitFor({ state: VISIBLE_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS });
};

type ParseModelMenuElementDetails = {
  item: Locator;
};

const parseModelMenuElement = async (
  details: ParseModelMenuElementDetails,
): Promise<ModelOption | null> => {
  const label = await readModelElementLabel({ item: details.item });

  const isLabelUnusable = !label || !isLikelyModelLabel(label);
  if (isLabelUnusable) return null;

  const id = await readModelElementId({ item: details.item });
  const selected = await isSelectedModelElement({ item: details.item });
  return { id, label, selected };
};

type ReadCheckedModelFromDomDetails = {
  page: Page;
};

const readCheckedModelFromDom = async (
  details: ReadCheckedModelFromDomDetails,
): Promise<string | null> => {
  const checked = details.page
    .locator('[data-testid^="model-switcher-"][aria-checked="true"]')
    .first();
  const checkedCount = await checked.count();

  const hasCheckedElement = checkedCount > 0;
  if (hasCheckedElement) {
    return readModelElementLabel({ item: checked });
  }

  return null;
};

type ReadCheckedModelFromOpenMenuDetails = {
  page: Page;
};

const readCheckedModelFromOpenMenu = async (
  details: ReadCheckedModelFromOpenMenuDetails,
): Promise<string | null> => {
  const elements = await listModelMenuElements(details.page);

  for (const element of elements) {
    const isSelectedModel = await isSelectedModelElement({ item: element });
    if (isSelectedModel) {
      const label = await readModelElementLabel({ item: element });
      if (label) return label;
    }
  }

  return null;
};

type ReadLikelyAriaModelLabelDetails = {
  trigger: Locator;
};

const readLikelyAriaModelLabel = async (
  details: ReadLikelyAriaModelLabelDetails,
): Promise<string | null> => {
  const ariaLabel = await probeOrFallback(null, () => details.trigger.getAttribute("aria-label"));
  const isLabelUsable = ariaLabel && isLikelyModelLabel(ariaLabel);
  return isLabelUsable ? ariaLabel.trim() : null;
};

type ReadLikelyModelLineDetails = {
  text: string;
};

const readLikelyModelLine = (details: ReadLikelyModelLineDetails): string | null => {
  const modelLine = details.text.split(NEWLINE).find((part) => isLikelyModelLabel(part));

  const isModelLineMissing = modelLine == null;
  if (isModelLineMissing) return null;

  return modelLine;
};

type ReadModelFromTriggerDetails = {
  page: Page;
};

const readModelFromTrigger = async (
  details: ReadModelFromTriggerDetails,
): Promise<string | null> => {
  const trigger = await readFirstVisible({ page: details.page, selectors: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) return null;

  const line = readLikelyModelLine({
    text: cleanDisplayString({ value: await probeOrFallback("", () => readVisibleText(trigger)) }),
  });
  if (line) return line;

  return readLikelyAriaModelLabel({ trigger });
};

type ReadModelElementIdDetails = {
  item: Locator;
};

const readModelElementId = async (details: ReadModelElementIdDetails): Promise<string> => {
  const testId = await probeOrFallback(null, () => details.item.getAttribute("data-testid"));

  const isModelSwitcherTestId = testId?.startsWith(MODEL_SWITCHER_TEST_ID_PREFIX);
  if (isModelSwitcherTestId) return testId.replace(MODEL_SWITCHER_TEST_ID_PREFIX, "");

  const label = await readModelElementLabel({ item: details.item });
  return cleanModelQuery({ value: label }).replace(/\s+/g, DASH);
};

type ReadModelElementLabelDetails = {
  item: Locator;
};

const readModelElementLabel = async (details: ReadModelElementLabelDetails): Promise<string> => {
  const testId = await probeOrFallback(null, () => details.item.getAttribute("data-testid"));

  const isModelSwitcherTestId = testId?.startsWith(MODEL_SWITCHER_TEST_ID_PREFIX);
  if (isModelSwitcherTestId) {
    const key = testId.replace(MODEL_SWITCHER_TEST_ID_PREFIX, "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }

  return cleanDisplayString({
    value: await probeOrFallback("", () => readVisibleText(details.item)),
  });
};

export const readNoModelMatchedMessage = (details: {
  query: string;
  seenLabels: string[];
}): string => {
  const isSeenLabelsEmpty = details.seenLabels.length === 0;
  if (isSeenLabelsEmpty)
    return `No model matched "${details.query}". The model menu opened but showed no model names.`;

  return `No model matched "${details.query}". The model menu showed: ${details.seenLabels.join(LIST_SEPARATOR)}.`;
};

const listModelMenuLabels = async (details: { page: Page }): Promise<string[]> => {
  const elements = await listModelMenuElements(details.page);
  const labels: string[] = [];

  for (const element of elements) {
    const label = await readModelElementLabel({ item: element });
    if (label) labels.push(label);
  }

  return labels;
};

type SelectModelOrThrowDetails = {
  page: Page;
  query: string;
  normalizedQuery: string;
};

const selectModelOrThrow = async (details: SelectModelOrThrowDetails): Promise<string> => {
  await openModelMenu({ page: details.page });

  const hit = await findModelMenuHit({
    page: details.page,
    normalizedQuery: details.normalizedQuery,
  });
  if (hit) return clickModelAndDetect({ page: details.page, item: hit });

  const seenLabels = await listModelMenuLabels({ page: details.page });
  await closeModelMenu({ page: details.page });
  const noModelMatchedMessage = readNoModelMatchedMessage({ query: details.query, seenLabels });
  throw new Error(noModelMatchedMessage);
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const normalizedQuery = cleanModelQuery({ value: query });

  const isNormalizedQueryEmpty = !normalizedQuery;
  if (isNormalizedQueryEmpty) throw new Error("Model name is required.");

  return selectModelOrThrow({ page, query, normalizedQuery });
};

type ClickSendButtonDetails = {
  page: Page;
};

const clickSendButton = async (details: ClickSendButtonDetails): Promise<void> => {
  const sendBtn = details.page.locator(SELECTORS.sendButton).filter({ visible: true }).first();
  // The send button may never surface; then the Enter fallback runs.
  const isSendButtonClicked = await probeOrFallback(false, async () => {
    await sendBtn.waitFor({ state: VISIBLE_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS });
    await sendBtn.click();
    return true;
  });
  if (isSendButtonClicked) return;

  // While a response streams, the send slot is the stop button, so Enter would interrupt it.
  const isStreamingShown = await isStreamingVisible({ page: details.page });
  if (isStreamingShown) return;

  await details.page.keyboard.press("Enter");
};

type SubmissionConfirmedDetails = {
  page: Page;
  userTurnsBefore: number;
};

const countUserTurns = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.userBlock).count();
};

const isSubmissionConfirmed = async (details: SubmissionConfirmedDetails): Promise<boolean> => {
  const composerString = await readComposerString({ page: details.page });

  const isComposerEmpty = composerString === "";
  if (isComposerEmpty) return true;

  const userTurnsNow = await countUserTurns(details.page);

  const isThereNewUserTurn = userTurnsNow > details.userTurnsBefore;
  if (isThereNewUserTurn) return true;

  return isStreamingVisible({ page: details.page });
};

// Attachments can take a while to upload before ChatGPT sends, so the wait is long.
const submissionConfirmPolls = 60;
const submissionConfirmPollMilliseconds = HALF_SECOND_MILLISECONDS;

const waitForSubmissionConfirmed = async (
  details: SubmissionConfirmedDetails,
): Promise<boolean> => {
  for (let poll = 0; poll < submissionConfirmPolls; poll += 1) {
    const isSubmissionVerified = await isSubmissionConfirmed(details);
    if (isSubmissionVerified) return true;

    await details.page.waitForTimeout(submissionConfirmPollMilliseconds);
  }
  return false;
};

export const injectPrompt = async (page: Page, string: string): Promise<void> => {
  await probeOrFallback(null, () => page.bringToFront());
  await runInjectPromptAttempts({ page, text: string });
};

type ReadComposerStringDetails = {
  page: Page;
};

export const readComposerString = async (details: ReadComposerStringDetails): Promise<string> => {
  const string = await details.page.evaluate((selector) => {
    const isRendered = (element: Element): boolean => element.getClientRects().length > 0;
    const prompt = [...document.querySelectorAll<HTMLElement>(selector)].find(isRendered);

    const isThereNoRenderedComposer = prompt == null;
    if (isThereNoRenderedComposer) return "";

    const field = (prompt as HTMLInputElement | HTMLTextAreaElement).value;

    const isTypeString = typeof field === "string";
    if (isTypeString) return field.trim();

    // biome-ignore lint/performance/useDomNodeTextContent: the prompt copy must match what the user sees
    return (prompt.innerText ?? prompt.textContent ?? "").trim();
  }, SELECTORS.promptInput);

  const isStringMissing = string == null;
  if (isStringMissing) return "";

  return string;
};

type RunInjectPromptAttemptsDetails = {
  page: Page;
  text: string;
};

type EnsureChatModeDetails = {
  page: Page;
};

const ensureChatMode = async (details: EnsureChatModeDetails): Promise<void> => {
  const inactiveChatToggle = details.page
    .locator('button[aria-pressed="false"]')
    .filter({ hasText: /^Chat$/ })
    .first();
  const inactiveChatToggleCount = await inactiveChatToggle.count();

  const hasNoInactiveToggle = inactiveChatToggleCount === 0;
  if (hasNoInactiveToggle) return;

  await inactiveChatToggle.click();
  await findVisibleComposer(details.page).waitFor({ state: VISIBLE_WAIT_MODE });
};

const runInjectPromptAttempts = async (details: RunInjectPromptAttemptsDetails): Promise<void> => {
  await ensureChatMode({ page: details.page });
  const composer = findVisibleComposer(details.page);
  const maxComposerReadAttempts = 3;

  for (let attempt = 0; attempt < maxComposerReadAttempts; attempt += 1) {
    // Never type or send into a busy conversation — wait out any in-flight response first.
    await waitForGenerationIdle(details.page);

    // A confirmed send returns here and is never sent again; only an unconfirmed one is retried.
    const hasSubmittedPromptAttempt = await submitPromptAttempt({
      page: details.page,
      input: composer,
      text: details.text,
    });
    if (hasSubmittedPromptAttempt) return;
  }
  throw new Error("injectPrompt: no send was confirmed after 3 attempts");
};

type SubmitPromptAttemptDetails = {
  page: Page;
  input: Locator;
  text: string;
};

const submitPromptAttempt = async (details: SubmitPromptAttemptDetails): Promise<boolean> => {
  const userTurnsBefore = await countUserTurns(details.page);

  await details.input.click();
  await details.input.fill(details.text);
  await details.input.dispatchEvent("input");
  await clickSendButton({ page: details.page });

  return waitForSubmissionConfirmed({ page: details.page, userTurnsBefore });
};

type IsTransientAssistantStringDetails = {
  text: string;
};

const isTransientAssistantString = (details: IsTransientAssistantStringDetails): boolean => {
  const normalized = details.text.trim().toLowerCase();

  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized) ||
    /^thought for\b/.test(normalized) ||
    normalized.startsWith("thought for ")
  );
};

export const isTurnSettled = (status: TurnSettledStatus): boolean => {
  if (status.streaming) return false;

  const hasPendingAssets = status.pendingAssetCount > 0;
  if (hasPendingAssets) return false;

  const targetImageCount = Math.max(status.expectImages, status.expectedImageMarkerCount);

  const awaitingImages = targetImageCount > 0 || status.sawImageActivity || status.assetCount > 0;

  // Image tiles keep resetting the quiet timer, so a multi-image turn never settles between them.
  const isImageSettling = awaitingImages && status.msSinceImageActivity < ASSET_SETTLE_QUIET_MS;
  if (isImageSettling) return false;

  // Fewer tiles than requested or announced: keep waiting unless generation has stalled.
  const hasPendingImages = targetImageCount > 0 && status.loadedAssetCount < targetImageCount;
  if (hasPendingImages) {
    return status.stableForMs >= IMAGE_STALL_QUIET_MS;
  }

  const requiredQuietMs = awaitingImages ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;

  const isNotQuietEnough = status.stableForMs < requiredQuietMs;
  if (isNotQuietEnough) return false;

  const hasLoadedAssets = status.loadedAssetCount > 0;
  if (hasLoadedAssets) return true;

  const hasTargetImages = targetImageCount > 0;
  if (hasTargetImages) return false;

  return status.hasText && !status.isTransientText;
};

type RemainingTimeoutDetails = {
  startedAt: number;
  timeout: number;
};

const readRemainingTimeout = (details: RemainingTimeoutDetails): number => {
  const minimumRemainingTimeoutMilliseconds = 1_000;

  return Math.max(
    minimumRemainingTimeoutMilliseconds,
    details.timeout - (Date.now() - details.startedAt),
  );
};

type ReplyStartedAfterBaselineDetails = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

const isReplyStartedAfterBaseline = async (
  details: ReplyStartedAfterBaselineDetails,
): Promise<boolean> => {
  const isStreamingShown = await isStreamingVisible({ page: details.page });
  if (isStreamingShown) return true;

  const count = await details.page.locator(SELECTORS.responseBlock).count();

  const isCountAboveBaseline =
    details.previousAssistantCount != null && count > details.previousAssistantCount;
  if (isCountAboveBaseline) return true;

  const lastString = await readNormalizedLastReply({ page: details.page });
  return (
    !!details.previousLastAssistantText &&
    !!lastString &&
    lastString !== details.previousLastAssistantText
  );
};

type ReplyWaitSettings = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
};

type IsStreamingVisibleDetails = {
  page: Page;
};

const isStreamingVisible = async (details: IsStreamingVisibleDetails): Promise<boolean> => {
  return isReplyGenerating(details.page, SELECTORS.streamingIndicator);
};

type ReadNormalizedLastReplyDetails = {
  page: Page;
};

const readNormalizedLastReply = async (
  details: ReadNormalizedLastReplyDetails,
): Promise<string> => {
  const string = await probeOrFallback("", () => captureLastReply(details.page));
  return cleanDisplayString({ value: string });
};

type TurnSettledStatus = {
  hasText: boolean;
  isTransientText: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
  streaming: boolean;
  stableForMs: number;
  expectImages: number;
  sawImageActivity: boolean;
  msSinceImageActivity: number;
};

type ReadTurnSnapshotDetails = {
  page: Page;
};

type TurnSnapshot = {
  text: string;
  streaming: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

export const countExpectedImageMarkers = (string: string): number => {
  const markers = string.match(/\[image-\d+\]/g);

  const isMarkersMissing = markers == null;
  if (isMarkersMissing) return 0;

  return markers.length;
};

const turnSnapshotChanged = (previous: TurnSnapshot, next: TurnSnapshot): boolean => {
  return (
    previous.text !== next.text ||
    previous.assetCount !== next.assetCount ||
    previous.loadedAssetCount !== next.loadedAssetCount ||
    previous.pendingAssetCount !== next.pendingAssetCount ||
    previous.expectedImageMarkerCount !== next.expectedImageMarkerCount
  );
};

type LastAssistantTurnStatus = {
  text: string;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

const readTurnSnapshot = async (details: ReadTurnSnapshotDetails): Promise<TurnSnapshot> => {
  const turnStatus = await details.page
    .evaluate<LastAssistantTurnStatus>(LAST_ASSISTANT_TURN_STATUS_ORIGIN)
    .catch(() => ({
      text: "",
      assetCount: 0,
      loadedAssetCount: 0,
      pendingAssetCount: 0,
      expectedImageMarkerCount: 0,
    }));
  const streaming = await isStreamingVisible({ page: details.page });
  const string = cleanDisplayString({
    value: turnStatus.text || (await readNormalizedLastReply({ page: details.page })),
  });
  const markerCountInString = countExpectedImageMarkers(string);
  const expectedImageMarkerCount = Math.max(
    turnStatus.expectedImageMarkerCount,
    markerCountInString,
  );

  return {
    text: string,
    streaming,
    assetCount: turnStatus.assetCount,
    loadedAssetCount: turnStatus.loadedAssetCount,
    pendingAssetCount: turnStatus.pendingAssetCount,
    expectedImageMarkerCount,
  };
};

type TurnSnapshotSettledDetails = {
  snapshot: TurnSnapshot;
  stableForMs: number;
  expectImages: number;
  msSinceImageActivity: number;
  sawImageActivity: boolean;
};

const turnSnapshotSettled = (details: TurnSnapshotSettledDetails): boolean => {
  const isSnapshotTransient = isTransientAssistantString({ text: details.snapshot.text });

  return isTurnSettled({
    hasText: !!details.snapshot.text,
    isTransientText: isSnapshotTransient,
    assetCount: details.snapshot.assetCount,
    loadedAssetCount: details.snapshot.loadedAssetCount,
    pendingAssetCount: details.snapshot.pendingAssetCount,
    expectedImageMarkerCount: details.snapshot.expectedImageMarkerCount,
    streaming: details.snapshot.streaming,
    stableForMs: details.stableForMs,
    expectImages: details.expectImages,
    msSinceImageActivity: details.msSinceImageActivity,
    sawImageActivity: details.sawImageActivity,
  });
};

type WaitForLastAssistantStringStableDetails = {
  page: Page;
  timeout: number;
  expectImages: number;
  imageActivity: ImageNetworkActivity;
};

const waitForComposerReady = async (page: Page): Promise<void> => {
  await probeOrFallback(null, () =>
    page.waitForSelector(SELECTORS.promptInput, {
      state: "visible",
      timeout: 15_000,
    }),
  );
};

const waitForLastAssistantStringStable = async (
  details: WaitForLastAssistantStringStableDetails,
): Promise<void> => {
  const startedAt = Date.now();
  // A stale DOM can hold a render forever, so reload the tab once nothing has progressed.
  const watchdog = createStallReloadWatchdog({
    waitAfterReload: waitForComposerReady,
    onReload: (count) =>
      process.stderr.write(`[bridge] ChatGPT render stalled — reloaded tab (reload ${count}).\n`),
  });
  let lastSnapshot = await readTurnSnapshot({ page: details.page });
  let stableSince = Date.now();
  while (Date.now() - startedAt < details.timeout) {
    const snapshot = await readTurnSnapshot({ page: details.page });

    const hasTurnChanged = turnSnapshotChanged(lastSnapshot, snapshot);
    if (hasTurnChanged) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
      watchdog.noteProgress();
    } else if (
      details.imageActivity.sawActivity() &&
      details.imageActivity.msSinceLastActivity() < ASSET_SETTLE_QUIET_MS
    ) {
      // A generated-image tile counts as progress even before the DOM count catches up.
      watchdog.noteProgress();
    }

    const nowMilliseconds = Date.now();
    const msSinceImageActivity = details.imageActivity.msSinceLastActivity();
    const sawImageActivity = details.imageActivity.sawActivity();

    const isTurnSettled = turnSnapshotSettled({
      snapshot,
      stableForMs: nowMilliseconds - stableSince,
      expectImages: details.expectImages,
      msSinceImageActivity,
      sawImageActivity,
    });
    if (isTurnSettled) return;

    const hasReloadedPage = await watchdog.reloadIfStalled(details.page);
    if (hasReloadedPage) {
      // Re-baseline after the reload so the settle timer never fires on pre-reload reads.
      lastSnapshot = await readTurnSnapshot({ page: details.page });
      stableSince = Date.now();
      continue;
    }

    await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
};

type WaitForReplyAfterBaselineDetails = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  timeout: number;
};

const waitForReplyAfterBaseline = async (
  details: WaitForReplyAfterBaselineDetails,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < details.timeout) {
    const hasReplyStarted = await isReplyStartedAfterBaseline(details);
    if (hasReplyStarted) return;

    await details.page.waitForTimeout(QUARTER_SECOND_MILLISECONDS);
  }
  throw new Error("Timed out waiting for ChatGPT to start a new response.");
};

type ImageNetworkActivity = {
  msSinceLastActivity(): number;
  sawActivity(): boolean;
  dispose(): void;
};

const trackImageNetworkActivity = (page: Page): ImageNetworkActivity => {
  let lastActivityAt = 0;
  const saveReplyActivity = (reply: Response): void => {
    const replyAddress = reply.url();

    const isImageActivityUrl = /estuary\/content|oaiusercontent\.com/i.test(replyAddress);
    if (isImageActivityUrl) lastActivityAt = Date.now();
  };
  page.on(NETWORK_REPLY_EVENT, saveReplyActivity);
  return {
    msSinceLastActivity: () => {
      const hasNoActivity = lastActivityAt === 0;
      return hasNoActivity ? Number.POSITIVE_INFINITY : Date.now() - lastActivityAt;
    },
    sawActivity: () => lastActivityAt !== 0,
    dispose: () => page.off(NETWORK_REPLY_EVENT, saveReplyActivity),
  };
};

const waitForReply = async (
  page: Page,
  settings: number | ReplyWaitSettings = {},
): Promise<void> => {
  const parsed = parseReplyWaitSettings(settings);
  const startedAt = Date.now();
  const imageActivity = trackImageNetworkActivity(page);
  try {
    if (parsed.previousAssistantCount != null || parsed.previousLastAssistantText) {
      await waitForReplyAfterBaseline({ page, ...parsed });
    } else {
      await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
    }

    await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
    const remainingWaitTimeout = readRemainingTimeout({ startedAt, timeout: parsed.timeout });
    await waitForLastAssistantStringStable({
      page,
      timeout: remainingWaitTimeout,
      expectImages: parsed.expectImages == null ? 0 : parsed.expectImages,
      imageActivity,
    });
  } finally {
    imageActivity.dispose();
  }
};

type WaitForStreamingToFinishDetails = {
  page: Page;
  startedAt: number;
  timeout: number;
};

const waitForStreamingToFinish = async (
  details: WaitForStreamingToFinishDetails,
): Promise<void> => {
  // The response might already be complete, so a missing streaming indicator is not an error.
  await probeOrFallback(null, async () => {
    const streamingIndicatorTimeoutMilliseconds = 10_000;

    await details.page
      .locator(SELECTORS.streamingIndicator)
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: streamingIndicatorTimeoutMilliseconds });
    const remainingStreamTimeout = readRemainingTimeout({
      startedAt: details.startedAt,
      timeout: details.timeout,
    });
    await details.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: remainingStreamTimeout,
    });
  });
};

const parseReplyWaitSettings = (
  settings: number | ReplyWaitSettings,
): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
} => {
  const isTypeNumber = typeof settings === "number";
  if (isTypeNumber) {
    return { timeout: settings };
  }

  const defaultSettingsTimeoutMilliseconds = 300_000;

  return {
    timeout: settings.timeout == null ? defaultSettingsTimeoutMilliseconds : settings.timeout,
    previousAssistantCount: settings.previousAssistantCount,
    previousLastAssistantText: cleanDisplayString({
      value: settings.previousLastAssistantText == null ? "" : settings.previousLastAssistantText,
    }),
    expectImages: settings.expectImages,
  };
};

const assertSignedIn = async (page: Page): Promise<void> => {
  await ensureChatMode({ page });

  const isGuestSessionDetected = await isGuestSession(page);
  if (isGuestSessionDetected) {
    throw createGuestSessionError({
      providerId: CHATGPT_PROVIDER_ID,
      reason:
        "Run `bridge chrome start --provider chatgpt`, click Log in if needed, complete sign-in, leave Chrome open, then run again.",
    });
  }
};

type HasGuestLoginButtonsDetails = {
  page: Page;
};

const hasGuestLoginButtons = async (details: HasGuestLoginButtonsDetails): Promise<boolean> => {
  const loginButton = await readFirstVisible({
    page: details.page,
    selectors: SELECTORS.guestLoginButton,
  });
  return loginButton != null;
};

type HasVisibleAccountMenuDetails = {
  page: Page;
};

const hasVisibleAccountMenu = async (details: HasVisibleAccountMenuDetails): Promise<boolean> => {
  const accountMenu = await readFirstVisible({
    page: details.page,
    selectors: SELECTORS.accountMenuButton,
  });
  return accountMenu != null;
};

type HasVisibleComposerDetails = {
  page: Page;
};

const hasVisibleComposer = async (details: HasVisibleComposerDetails): Promise<boolean> => {
  const composer = await readFirstVisible({
    page: details.page,
    selectors: [SELECTORS.promptInput],
  });
  return composer != null;
};

const SESSION_SIGNAL_TIMEOUT_MS = FIFTEEN_SECONDS_MILLISECONDS;

const waitForSessionSignal = async (page: Page): Promise<void> => {
  const sessionSignalSelectors = [
    ...SELECTORS.accountMenuButton,
    ...SELECTORS.guestLoginButton,
    SELECTORS.promptInput,
  ];
  const sessionSignalCssSelector = sessionSignalSelectors.join(LIST_SEPARATOR);
  const sessionSignal = page.locator(sessionSignalCssSelector).filter({ visible: true }).first();

  try {
    await sessionSignal.waitFor({ state: VISIBLE_WAIT_MODE, timeout: SESSION_SIGNAL_TIMEOUT_MS });
  } catch (error) {
    const isSessionSignalSlow = error instanceof errors.TimeoutError;
    if (isSessionSignalSlow) return;

    throw error;
  }
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  await waitForSessionSignal(page);

  const hasAccountMenuVisible = await hasVisibleAccountMenu({ page });
  if (hasAccountMenuVisible) return false;

  const hasGuestLoginVisible = await hasGuestLoginButtons({ page });
  if (hasGuestLoginVisible) return true;

  return !(await hasVisibleComposer({ page }));
};

export const chatGptProvider = {
  id: CHATGPT_PROVIDER_ID,
  origin: CHATGPT_HOSTNAME,
  defaultUrl: CHATGPT_ORIGIN_URL,
  defaultModel: CHATGPT_APP_NAME,
  displayName: CHATGPT_APP_NAME,
  composerSelector: PROVIDER_SETTINGS.chatgpt.selectors.composer,
  supportsMcpConnector: true,
  assertSignedIn,
  injectPrompt,
  waitForReply,
  captureLastReply,
  countAssistantReplies,
  captureAllMessages,
  readSidebarConversations,
  searchConversations: searchChatGptConversations,
  navigateToConversation,
  newConversation: openNewConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  removeComposerAttachments,
  isLikelyModelLabel,
  setupMcpConnector: setupMcpConnectorInChatGpt,
} satisfies BrowserProvider;
