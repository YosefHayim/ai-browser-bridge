import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type APIResponse, errors, type Locator, type Page, type Response } from "playwright";
import { BRIDGE_DIR_NAME, PROVIDER_CONFIG, REPO_DIR_NAME } from "@/config";
import type { Attachment, AttachmentManifest, AttachmentRole } from "@/domain/attachment-types.ts";
import type {
  ConnectorSetupOptions,
  ConnectorSetupResult,
  ModelOption,
} from "@/domain/connector-types.ts";
import type { BrowserProvider, CaptureMessagesOptions } from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { createStallReloadWatchdog } from "@/providers/render-stall-watchdog.ts";
import { isResponseGenerating, waitForResponseIdle } from "@/providers/streaming-guard.ts";
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

const EDIT_BUTTON_SELECTORS = [
  'button[data-testid="edit-turn-button"]',
  'button[data-testid="edit-message-button"]',
  'button[aria-label="Edit message"]',
  'button[aria-label*="Edit" i]',
  'button[title="Edit message"]',
  'button:has-text("Edit")',
] as const;

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

const MARKER_PREFIX = "\u0000attachment:";

const MARKER_SUFFIX = "\u0000";

const CONVERSATION_TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-turn-key]';

// A multi-image reply shows one large preview plus a thumbnail strip holding every image once.
const GENERATED_IMAGE_STRIP_SELECTOR = '[role="group"][aria-label="Generated images"] img';

const GENERATED_IMAGE_SELECTOR =
  'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]';

export const LIST_GENERATED_IMAGES_ORIGIN = `
const listGeneratedImagesIn = (scope) => {
  const stripImages = Array.from(scope.querySelectorAll(${JSON.stringify(GENERATED_IMAGE_STRIP_SELECTOR)}));
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

// Serialize one conversation turn. Resolves role from an inner role block when present;
// otherwise a turn that only holds a generated image is treated as an assistant message.
// Generated images that render outside the role block (but inside the turn) are appended
// as extra children so the walker still visits them.
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

// Raw row example: "path/with\\bad:chars" unsafe filename chars should match.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from filename candidates
const UNSAFE_FILENAME_CHARS = /[\\/\0-\x1f\x7f]/g;

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const EXTENSION_MIMES = [
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
] as const;

const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

const BRIDGE_CONNECTOR_PREFIX = "ai-browser-bridge";

const ENABLE_DEVELOPER_MODE_SNIPPET = `() => {
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
}`;

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

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

const ASSET_SETTLE_QUIET_MS = 12_000;

/** Quiet window after which an image turn that fell short of its requested/announced count
 *  is treated as finished, so a stopped-short generation never hangs to the full timeout. */
const IMAGE_STALL_QUIET_MS = 45_000;

/** URL fragments that signal a generated image tile arriving over the network. */
// Raw row example: "https://oaiusercontent.com/..." image activity URL should match.
const IMAGE_ACTIVITY_URL = /estuary\/content|oaiusercontent\.com/i;

/** DOM selectors for ChatGPT's interface. Subject to change if ChatGPT updates UI. */
export const SELECTORS = {
  promptInput: PROVIDER_CONFIG.chatgpt.selectors.composer,

  sendButton:
    'button[data-testid="send-button"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]',

  responseBlock: PROVIDER_CONFIG.chatgpt.selectors.assistant,

  lastResponse: PROVIDER_CONFIG.chatgpt.selectors.assistant,

  sidebarConversation: 'nav a[href^="/c/"]',
  // Streaming indicator (stop button appears while a turn is generating).
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(", "),
  /** ChatGPT-generated images render outside the role block, served from the estuary content endpoint. */
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

  conversationTurn: CONVERSATION_TURN_SELECTOR,

  attachmentInput: 'input[type="file"][multiple]:not([accept])',
  attachmentMenuButton: ['button[aria-label="Add files and more"]'],
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
const ATTACHED_FILE_POLL_MS = 500;

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

// ChatGPT shows a "Remove <file>" chip in the composer once it accepts an upload.
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
  const chooserPromise = details.page.waitForEvent("filechooser", { timeout: 5_000 });
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
  const prompt = readRewindPrompt({
    replacement: details.replacement,
    previousText: await readLastUserPromptString({ lastUserBlock: details.lastUserBlock }),
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
  await details.prepared.turnScope.hover().catch(() => {});
  await details.prepared.page.waitForTimeout(300);

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
  return readFirstVisibleIn({ parent: details.turnScope, selectors: EDIT_BUTTON_SELECTORS });
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
  await details.editor.dispatchEvent("input").catch(() => {});
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
  return cleanDisplayString({ value: await details.lastUserBlock.innerText() });
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

const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator(SELECTORS.streamingIndicator).first();
  try {
    await stop.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
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
}): Attachment | undefined => {
  return details.params.existing.find(
    (attachment) =>
      !details.usedExistingIds.has(attachment.id) &&
      attachment.role === details.params.role &&
      attachment.messageIndex === details.params.messageIndex &&
      attachment.kind === details.item.kind &&
      isSameAttachmentOrigin({ attachment, item: details.item }),
  );
};

const isSameAttachmentOrigin = (details: {
  attachment: Attachment;
  item: ExtractedMessage["attachments"][number];
}): boolean => {
  const hasSameUrl = details.attachment.url === details.item.url;
  const isReloadedPageBlob =
    details.attachment.url.startsWith("blob:") && details.item.url.startsWith("blob:");
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
  return parameters.role === "user"
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
  const registered = assignAttachmentIds({
    extracted: parameters.extracted,
    role: "assistant",
    messageIndex: parameters.messageIndex,
    counters: readCountersFromManifest(manifest),
    createdAt: new Date().toISOString(),
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
    message = message.replace(createMarker(index), `[${markerId}]`);
  }
  return message;
};

const createMarker = (index: number): string => {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
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
  opts: DownloadSettings;
}

export const downloadAttachment = async ({
  page,
  conversationId,
  id,
  opts: settings,
}: DownloadAttachmentDetails): Promise<DownloadReport> => {
  const manifest = await loadManifest(conversationId, { manifestRoot: settings.manifestRoot });

  const attachment = manifest.attachments.find((attachment: Attachment) => attachment.id === id);
  const isAttachmentMissing = attachment == null;
  if (isAttachmentMissing)
    throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);

  return downloadPreparedAttachment({
    page,
    conversationId,
    attachment,
    attachments: manifest.attachments,
    opts: settings,
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

  const downloadReports = await downloadIds({ page, conversationId, ids, opts: settings });
  const hasAllDownloadsFailed =
    downloadReports.length > 0 && downloadReports.every((downloadReport) => downloadReport.error);
  if (hasAllDownloadsFailed) {
    const failedIds = settings.ids == null ? "*" : settings.ids.join(",");
    throw new AttachmentDownloadError(
      failedIds,
      undefined,
      `Failed to download all attachments for conversation ${conversationId}`,
      downloadReports,
    );
  }

  return downloadReports;
};

type DownloadPreparedDetails = {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  opts: DownloadSettings;
};

const downloadPreparedAttachment = async (
  details: DownloadPreparedDetails,
): Promise<DownloadReport> => {
  const outDir = readSaveDirectory({
    conversationId: details.conversationId,
    outDir: details.opts.outDir,
    repoRoot: details.opts.repoRoot,
  });
  await mkdir(outDir, { recursive: true });
  try {
    if (isChatGptFileUrl(details.attachment.url)) {
      const downloadUrl = await readChatGptFileDownloadUrl({
        page: details.page,
        conversationId: details.conversationId,
        fileId: readFileIdFromChatGptFileUrl(details.attachment.url),
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
    const isAttachmentUrlStartsWithBlob = details.attachment.url.startsWith("blob:");
    const bytes = isAttachmentUrlStartsWithBlob
      ? await fetchBlobBytes({ page: details.page, attachment: details.attachment })
      : parseEmbeddedUrl({ attachment: details.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    const isErrorInstanceAttachmentDownloadError = error instanceof AttachmentDownloadError;
    if (isErrorInstanceAttachmentDownloadError) throw error;

    throw new AttachmentDownloadError(
      details.attachment.id,
      details.attachment.url,
      `Failed to download attachment ${details.attachment.id}`,
      error,
    );
  }
};

type DownloadIdsDetails = {
  page: Page;
  conversationId: string;
  ids: string[];
  opts: DownloadAllSettings;
};

const downloadIds = async (details: DownloadIdsDetails): Promise<DownloadAllReport[]> => {
  const downloadReports: DownloadAllReport[] = [];
  for (const attachmentId of details.ids) {
    downloadReports.push(await downloadOneId({ input: details, attachmentId }));
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
      opts: details.input.opts,
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

export class AttachmentDownloadError extends Error {
  readonly id: string;
  readonly url: string | undefined;
  override readonly cause: unknown;
  constructor(id: string, url: string | undefined, message: string, cause?: unknown) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.id = id;
    this.url = url;
    this.cause = cause;
  }
}

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
  // Matches data URLs like data:image/png;base64,iVBORw0KGgo=.
  // Named captures: metadata before the comma, encodedPayload after it.
  const hit = /^data:(?<metadata>[^,]*),(?<encodedPayload>.*)$/s.exec(details.attachment.url);
  const isGroupsMissing = hit?.groups == null;
  if (isGroupsMissing) {
    throw new AttachmentDownloadError(
      details.attachment.id,
      details.attachment.url,
      `Invalid data URL for attachment ${details.attachment.id}`,
    );
  }

  const metadata = hit.groups.metadata == null ? "" : hit.groups.metadata;
  const encodedMessage = hit.groups.encodedPayload == null ? "" : hit.groups.encodedPayload;
  return decodeEmbeddedUrlBytes({ metadata, encodedPayload: encodedMessage });
};

const decodeEmbeddedUrlBytes = (details: { metadata: string; encodedPayload: string }): Buffer => {
  const isBase64Encoded = details.metadata.split(";").includes("base64");
  if (isBase64Encoded) {
    return Buffer.from(details.encodedPayload, "base64");
  }

  return Buffer.from(decodeURIComponent(details.encodedPayload), "utf8");
};

type SanitizeFilenameDetails = {
  value: string | undefined;
};

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
    const hasBasename = basename && basename !== "/";
    return hasBasename ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
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

const readMimeExtension = (details: ExtensionForMimeDetails): string | undefined => {
  const normalized = details.mime?.toLowerCase().split(";")[0]?.trim();
  return normalized ? MIME_EXTENSIONS[normalized] : undefined;
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

  const isImageKind = details.attachment.kind === "image";
  if (isImageKind) return ".png";

  const isPdfKind = details.attachment.kind === "pdf";
  if (isPdfKind) return ".pdf";

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

  return sanitizeFilename({ value: readFilenameFromUrl({ url: details.attachment.url }) });
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

  return readSavePath({
    outDir: details.input.outDir,
    filename: createDisambiguatedFilename({
      filename: details.filename,
      id: details.input.attachment.id,
    }),
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

        return new Uint8Array(await blobFetch.arrayBuffer());
      },
      details.attachment.url,
    );
    return Buffer.from(bytes);
  } catch (error) {
    throw new AttachmentDownloadError(
      details.attachment.id,
      details.attachment.url,
      `Failed to fetch blob attachment ${details.attachment.id}`,
      error,
    );
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
  if (isReplyFailed)
    throwFailedHttpAttachment({ attachment: details.attachment, status: httpReply.status() });

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

  return writeIfChanged({ filePath, bytes: await details.httpResponse.body() });
};

const throwFailedHttpAttachment = (details: { attachment: Attachment; status: number }): void => {
  throw new AttachmentDownloadError(
    details.attachment.id,
    details.attachment.url,
    `Attachment ${details.attachment.id} request failed with HTTP ${details.status}`,
  );
};

type SaveDirectoryDetails = {
  conversationId: string;
  outDir?: string;
  repoRoot: string;
};

// Default: <repo>/.bridge/downloads/<conversationId>
const readSaveDirectory = (details: SaveDirectoryDetails): string => {
  if (details.outDir) return path.resolve(details.outDir);

  return path.resolve(details.repoRoot, REPO_DIR_NAME, "downloads", details.conversationId);
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
    throw new AttachmentDownloadError(
      "",
      undefined,
      `Invalid attachment output path: ${details.filename}`,
    );
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

const readExistingSize = async (details: ExistingSizeDetails): Promise<number | undefined> => {
  try {
    return (await stat(details.filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;

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
  opts: ExtractMessagesSettings;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const manifest = await loadManifest(parameters.opts.conversationId, {
    manifestRoot: parameters.opts.manifestRoot,
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
    manifestRoot: parameters.opts.manifestRoot,
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
  opts: ExtractMessagesSettings;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
}) => {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];
  for (const message of parameters.messages) {
    captured.push(
      await captureMessage({
        message,
        opts: parameters.opts,
        counters: parameters.counters,
        now: parameters.now,
        manifest: parameters.manifest,
      }),
    );
  }
  return captured;
};

const captureMessage = async (parameters: {
  message: SerializedMessage;
  opts: ExtractMessagesSettings;
  counters: ReturnType<typeof readCountersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  const isAttachmentRegistrationOff = !shouldRegisterAttachments({
    message: parameters.message,
    opts: parameters.opts,
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
  const role: AttachmentRole = parameters.message.role === "user" ? "user" : "assistant";
  const registered = assignAttachmentIds({
    extracted: extractMessageFromSnapshot(parameters.message.root),
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
  opts: ExtractMessagesSettings;
}): boolean => {
  const isMessageRoleAssistant = parameters.message.role === "assistant";
  if (isMessageRoleAssistant) return true;

  return parameters.message.role === "user" && parameters.opts.includeUserAttachments === true;
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

  return registerExtractedMessage({
    conversationId: settings.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractMessageFromSnapshot(message.root),
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
  const otherAttachments = manifest.attachments.filter((attachment) => attachment.kind !== "image");
  const imageAttachments = listAttachmentsFromImageRefs({
    refs: imageRefs,
    createdAt: new Date().toISOString(),
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
  return persistAllMessages({ messages, opts: settings });
};

const listAttachmentKinds = (): AttachmentKind[] => {
  return ["image", "file", "pdf"];
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
    const suffix = Number(attachment.id.split("-").at(-1));
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
  return path.join(homedir(), BRIDGE_DIR_NAME, "attachment-manifests");
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
  const role = attachment.role == null ? "assistant" : attachment.role;
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
  return {
    conversationId: isManifestConversationIdMissing
      ? parameters.conversationId
      : parameters.manifest.conversationId,
    attachments,
    counters: mergeCounters(readCountersFromAttachments(attachments), parameters.manifest.counters),
  };
};

export const loadManifest = async (
  conversationId: string,
  settings: ManifestStoreSettings = {},
): Promise<AttachmentManifest> => {
  try {
    const unparsed = await readFile(readManifestPath(conversationId, settings), "utf8");
    return cleanManifest({
      conversationId,
      manifest: JSON.parse(unparsed) as Partial<AttachmentManifest>,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
};

const readCountersFromManifest = (manifest: AttachmentManifest): AttachmentCounters => {
  return mergeCounters(readCountersFromAttachments(manifest.attachments), manifest.counters);
};

const inferMimeFromEmbeddedUrl = (url: string): string | undefined => {
  // Matches data URL prefixes like data:image/png;base64,... .
  // Named capture mimeType is the MIME type before ";" or ",".
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

  return parameters.fallback === "image" ? "image/*" : undefined;
};

const readExtensionMime = (path: string): string | undefined => {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    const isPathEndsWithSuffix = path.endsWith(suffix);
    if (isPathEndsWithSuffix) return mime;
  }
  return undefined;
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
  const isNodeTypeString = node.type === "text";
  if (isNodeTypeString) return node.text;

  return node.children.map(readStringOnly).join("");
};

const isFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>): boolean => {
  const hasDownloadAttribute = readAttr({ node, name: "download" }) != null;
  if (hasDownloadAttribute) return true;

  const hrefAttr = readAttr({ node, name: "href" });
  const isHrefAttrMissing = hrefAttr == null;
  const href = isHrefAttrMissing ? "" : hrefAttr;
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const testId = readAttr({ node, name: "data-testid" });
  const isAriaLabelMissing = ariaLabel == null;
  const ariaPart = isAriaLabelMissing ? "" : ariaLabel;
  const isTestIdMissing = testId == null;
  const testIdPart = isTestIdMissing ? "" : testId;
  const label = `${ariaPart} ${testIdPart}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
};

const readAttachmentFromImage = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const currentSrc = readAttr({ node, name: "currentSrc" });
  const src = readAttr({ node, name: "src" });

  const isCurrentSrcMissing = currentSrc == null;
  const url = isCurrentSrcMissing ? src : currentSrc;
  const isUrlBlank = url == null || url === "";
  if (isUrlBlank) return null;

  return {
    kind: "image" as const,
    url,
    filename: readOptionalString(readAttr({ node, name: "alt" })),
    mime: inferMime({ url, fallback: "image" }),
  };
};

const readAttachmentFromIframe = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "src" });
  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  const title = readAttr({ node, name: "title" });
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const isTitleMissing = title == null;
  const filenameOrigin = isTitleMissing ? ariaLabel : title;
  return {
    kind: "pdf" as const,
    url,
    filename: readOptionalString(filenameOrigin),
    mime: "application/pdf",
  };
};

const readAttachmentFromFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "href" });
  const isUrlEmpty = !url;
  if (isUrlEmpty) return null;

  return {
    kind: "file" as const,
    url,
    filename: (() => {
      const downloadName = readOptionalString(readAttr({ node, name: "download" }));

      const hasDownloadName = downloadName != null;
      if (hasDownloadName) return downloadName;

      return readOptionalString(readStringOnly(node));
    })(),
    mime: inferMime({ url, fallback: "file" }),
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
  const isLeafNode = parameters.node.type === "text";
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
  if (isNodeTagNameBr) return "\n";

  return parameters.node.children
    .map((child) => walkSnapshot({ node: child, attachments: parameters.attachments }))
    .join("");
};

type IsRiskCheckboxVisibleDetails = {
  setup: ConnectorSetupDetails;
};

const isRiskCheckboxVisible = async (details: IsRiskCheckboxVisibleDetails): Promise<boolean> => {
  const checkbox = details.setup.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  const checkboxCount = await checkbox.count();
  const hasNoCheckbox = checkboxCount === 0;
  if (hasNoCheckbox) return false;

  return checkbox.isVisible().catch(() => false);
};

const acceptCustomMcpRiskIfPresent = async (details: ConnectorSetupDetails): Promise<boolean> => {
  const isRiskCheckboxShown = await isRiskCheckboxVisible({ setup: details });
  const isRiskCheckboxHidden = !isRiskCheckboxShown;
  if (isRiskCheckboxHidden) return false;

  const checkbox = details.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  const isCheckboxChecked = await checkbox.isChecked().catch(() => false);
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
    const isNotChatGptHost = !parsed.hostname.endsWith("chatgpt.com");
    if (isNotChatGptHost) return null;

    parsed.hash = "";
    parsed.search = "";

    const isParsedPathnameStartsWithC = parsed.pathname.startsWith("/c/");
    if (isParsedPathnameStartsWithC) return parsed.toString();

    return `${parsed.origin}/`;
  } catch {
    return null;
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
  await deleteDuplicateTargets({
    setup: details,
    deleteTargets: findDeleteTargets({
      summaries,
      connectorName: details.connectorName,
      connectorUrl: details.connectorUrl,
    }),
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
  await details.button.click({ timeout: 3_000, force: true });
  await details.setup.page.waitForTimeout(1_000);
  details.setup.result.steps.push(`Opened existing connector: ${details.setup.connectorName}.`);
};

type ClickConnectorLineButtonDetails = {
  button: Locator;
  page: Page;
};

const clickConnectorLineButton = async (
  details: ClickConnectorLineButtonDetails,
): Promise<void> => {
  await details.button.click({ timeout: 3_000, force: true });
  await details.page.waitForTimeout(1_000);
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
  const elementVisible = await element.isVisible().catch(() => false);
  const isElementHidden = !elementVisible;
  if (isElementHidden) return false;

  await element.click({ timeout: 3_000, force: true });
  await details.page.waitForTimeout(500);
  return true;
};

type ClickDeleteConfirmationDetails = {
  page: Page;
};

const clickDeleteConfirmation = async (details: ClickDeleteConfirmationDetails): Promise<void> => {
  await clickFirstVisible({
    page: details.page,
    selectors: [
      '[role="alertdialog"] button:has-text("Delete")',
      '[role="dialog"] button:has-text("Delete")',
      'button:has-text("Delete app")',
      'button:has-text("Delete App")',
    ],
    timeout: 1_000,
  });
  await details.page.waitForTimeout(2_000);
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
  await details.moreItem.hover().catch(() => {});
  await details.moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await details.setup.page.waitForTimeout(750);
};

type ClickSettingsLineDetails = {
  setup: ConnectorSetupDetails;
};

const clickSettingsLine = async (details: ClickSettingsLineDetails): Promise<void> => {
  const openedSettings = await clickFirstVisible({
    page: details.setup.page,
    selectors: SELECTORS.settingsEntrypoint,
    timeout: 2_000,
  });
  if (openedSettings) {
    details.setup.result.steps.push("Opened ChatGPT settings.");
    await details.setup.page.waitForTimeout(1_000);
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
    await closeButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await details.page.waitForTimeout(500);
  }
};

type ClickDeleteMenuLineDetails = {
  deleteItem: Locator;
  page: import("playwright").Page;
};

const clickDeleteMenuLine = async (details: ClickDeleteMenuLineDetails): Promise<void> => {
  await details.deleteItem.click({ timeout: 2_000, force: true });
  await details.page.waitForTimeout(500);
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
    const aria = await button.getAttribute("aria-label").catch(() => null);
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
    const aria = await button.getAttribute("aria-label").catch(() => null);
    const isRemoveControlSkipped = !aria || aria === `${details.connectorName}, click to remove`;
    if (isRemoveControlSkipped) continue;

    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await details.page.waitForTimeout(250);
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
  options: ConnectorSetupOptions;
  connectorName: string;
  returnUrl: string | null;
  result: ConnectorSetupResult;
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openConnectorList({ page: details.page });
    const lines = await findBridgeConnectorButtons({ page: details.page });
    for (const line of lines) {
      const isOtherLine = line.name !== details.target.name;
      if (isOtherLine) continue;

      await line.button.click({ timeout: 3_000, force: true });
      await details.page.waitForTimeout(1_000);

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

  await manage.click({ timeout: 2_000, force: true });
  await details.page.waitForTimeout(500);
  return confirmOpenConnectorDeletion({ page: details.page });
};

const enableDeveloperModeIfPresent = async (details: ConnectorSetupDetails): Promise<void> => {
  const verdict = await details.page.evaluate(ENABLE_DEVELOPER_MODE_SNIPPET);
  const isVerdictEnabled = verdict === "enabled";
  if (isVerdictEnabled) {
    details.result.steps.push("Enabled Developer mode.");
    await details.page.waitForTimeout(750);
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
  const buttons = await details.page.locator('[role="dialog"] button').all();
  const lines: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = cleanConnectorListLabel({ value: await button.innerText().catch(() => "") });
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
  const buttons = await details.page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = cleanConnectorListLabel({ value: await button.innerText().catch(() => "") });
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
    const isButtonVisible = button && (await button.isVisible().catch(() => false));
    if (isButtonVisible) return true;

    await details.page.waitForTimeout(500);
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

  const isExistingStale = existing === "stale";
  if (isExistingStale) return deleteStaleConnector(details);

  const isExistingUnknown = existing === "unknown";
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
  options: ConnectorSetupOptions;
};

const initConnectorSetupDetails = (
  details: InitConnectorSetupDetailsDetails,
): ConnectorSetupDetails => {
  const connectorName =
    details.options.connectorName == null ? DEFAULT_CONNECTOR_NAME : details.options.connectorName;
  const returnUrl = readChatGptReturnUrl({ url: details.page.url() });
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
    appendUniqueSummary({
      summaries,
      seen,
      summary: await readConnectorSummaryAtIndex({ page: details.page, index }),
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
    timeout: 1_500,
  });
  if (opened) details.result.steps.push("Opened Advanced settings.");
};

const openAppsOrConnectorsPanel = async (details: ConnectorSetupDetails): Promise<void> => {
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
    timeout: 2_000,
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
  await details.page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await details.page.waitForTimeout(1_500);

  const settingsDialogOpen = await details.page
    .locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")')
    .first()
    .isVisible()
    .catch(() => false);
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
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files" i]',
    ],
  });
  const isPlusButtonMissing = plusButton == null;
  if (isPlusButtonMissing) return false;

  await plusButton.click({ timeout: 5_000, force: true });
  await details.setup.page.waitForTimeout(750);
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
  await details.page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await details.page.waitForTimeout(1_000);

  const backButton = await readFirstVisible({
    page: details.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await details.page.waitForTimeout(750);
  }
};

const openCreateConnectorForm = async (details: ConnectorSetupDetails): Promise<void> => {
  const opened = await clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("Create app")',
      'button:has-text("Create App")',
      'button:has-text("Create")',
      'button:has-text("Add connector")',
      'button:has-text("Add Connector")',
      'button:has-text("New app")',
      'button:has-text("New App")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
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

  const isAlreadyOpenNotMissing = alreadyOpen !== "missing";
  if (isAlreadyOpenNotMissing) return alreadyOpen;

  const didOpenConnectorDetailsPanel = await openConnectorDetailsPanel({ setup: details });
  const isConnectorDetailsNotOpened = !didOpenConnectorDetailsPanel;
  if (isConnectorDetailsNotOpened) return "missing";

  return readConnectorStatus({ setup: details });
};

const openSettingsFromAccountMenu = async (details: ConnectorSetupDetails): Promise<void> => {
  await details.page
    .goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await details.page
    .waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 15_000 })
    .catch(() => {});

  const didClickAccountMenu = await clickFirstVisible({
    page: details.page,
    selectors: SELECTORS.accountMenuButton,
    timeout: 2_000,
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
  if (isConnectorDetailsIncomplete) return "missing";

  const isConnectorUrlIn = string.includes(details.connectorUrl);
  if (isConnectorUrlIn) return "current";

  const hasUrlLine = /\bURL\s+https?:\/\//i.test(string);
  if (hasUrlLine) return "stale";

  return "unknown";
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
  const string = await details.page
    .locator('[role="dialog"]')
    .last()
    .innerText()
    .catch(() => "");
  const lines = string
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return parseConnectorSummaryLines({ lines });
};

const refreshOpenConnectorIfPresent = async (details: ConnectorSetupDetails): Promise<boolean> => {
  return clickFirstVisible({
    page: details.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: 1_000,
  });
};

const restoreAfterConnectorSetup = async (details: ConnectorSetupDetails): Promise<void> => {
  await closeSettingsDialogIfPresent(details);
  await restoreReturnUrlIfNeeded(details);
};

const restoreReturnUrlIfNeeded = async (details: ConnectorSetupDetails): Promise<void> => {
  if (
    details.returnUrl &&
    readChatGptReturnUrl({ url: details.page.url() }) !== details.returnUrl
  ) {
    await details.page.goto(details.returnUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }

  await details.page
    .waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 15_000 })
    .catch(() => {});
};

const returnToConnectorListIfNeeded = async (details: ConnectorSetupDetails): Promise<void> => {
  const back = await readFirstVisible({
    page: details.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await details.page.waitForTimeout(750);
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
  await details.page.keyboard.press("Escape").catch(() => {});
  return ensureComposerConnectorSelected(details);
};

const selectNoAuthenticationIfPresent = async (
  details: ConnectorSetupDetails,
): Promise<boolean> => {
  const authSelect = details.page.locator("select#custom-connector-auth").first();
  const isAuthSelectVisible =
    (await authSelect.count()) > 0 && (await authSelect.isVisible().catch(() => false));
  if (isAuthSelectVisible) {
    await authSelect.selectOption("NONE");
    await authSelect.dispatchEvent("change").catch(() => {});
    return true;
  }

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
    timeout: 1_000,
  });
};

type SettingsDialogStringDetails = {
  page: Page;
};

const readSettingsDialogString = async (details: SettingsDialogStringDetails): Promise<string> => {
  return cleanDisplayString({
    value: await details.page
      .locator('[role="dialog"]')
      .last()
      .innerText()
      .catch(() => ""),
  });
};

const setupMcpConnectorInChatGpt = async (
  page: Page,
  connectorUrl: string,
  settings: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  return executeConnectorSetup(
    initConnectorSetupDetails({ page, connectorUrl, options: settings }),
  );
};

type ConnectorFormStillOpenDetails = {
  setup: ConnectorSetupDetails;
};

const isConnectorFormStillOpen = async (
  details: ConnectorFormStillOpenDetails,
): Promise<boolean> => {
  return details.setup.page
    .locator('input[name="custom-connector-url"], #custom-connector-url')
    .first()
    .isVisible()
    .catch(() => false);
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
  const appVisible = await waitForConnectorButton({
    page: details.setup.page,
    connectorName: details.setup.connectorName,
    timeoutMs: 20_000,
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
  const submitted = await clickFirstVisible({
    page: details.page,
    selectors: [
      'button:has-text("Create")',
      'button:has-text("Save")',
      'button:has-text("Add")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
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

  const isExistingNotCurrent = existing !== "current";
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
  settings: CaptureMessagesOptions = {},
): Promise<Array<{ role: string; content: string }>> => {
  return extractAllMessages(page, {
    conversationId: readConversationIdFromPage({ page }),
    manifestRoot: settings.manifestRoot,
  });
};

const sanitizeCapturedString = (field: string): string => {
  return field
    .replace(/\s*\[object Object\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const captureLastReply = async (
  page: Page,
  settings: CaptureMessagesOptions = {},
): Promise<string> => {
  const { text: string } = await extractAssistantMessage(page, {
    conversationId: readConversationIdFromPage({ page }),
    manifestRoot: settings.manifestRoot,
  });

  const cleaned = sanitizeCapturedString(string);
  const isCleanedStringValid = cleaned && !/\[object Object\]/.test(string);
  if (isCleanedStringValid) return cleaned;

  const fallback = await page
    .locator(SELECTORS.lastResponse)
    .last()
    .innerText()
    .catch(() => "");
  return sanitizeCapturedString(fallback) || cleaned;
};

type ConversationIdFromPageDetails = {
  page: Page;
};

const readConversationIdFromPage = (details: ConversationIdFromPageDetails): string => {
  const conversationId = readChatGptConversationIdFromUrl(details.page.url());

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return "current";

  return conversationId;
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

const waitForGenerationIdle = async (page: Page, timeoutMs?: number): Promise<void> => {
  await waitForResponseIdle(page, SELECTORS.streamingIndicator, timeoutMs);
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  const targetUrl = readChatGptConversationUrlFromIdOrUrl(url);
  if (isSameChatGptConversation(page.url(), targetUrl)) {
    await page
      .waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 30_000 })
      .catch(() => {});
    return;
  }

  await waitForGenerationIdle(page);
  await page.goto(targetUrl);
  await page.waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 30_000 });
  await Promise.allSettled([
    page.locator(SELECTORS.conversationTurn).first().waitFor({ timeout: 15_000 }),
  ]);
};

const openNewConversation = async (page: Page): Promise<void> => {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 30_000 });
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

  const parsedUrl = new URL(href, "https://chatgpt.com");
  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  const lastPathPart = pathParts.pop();

  const isLastPathPartMissing = lastPathPart == null;
  const id = isLastPathPartMissing ? "" : lastPathPart;
  const isIdEmpty = !id;
  if (isIdEmpty) return null;

  return { id, title, url: parsedUrl.toString() };
};

const parseSidebarLink = async (link: Locator): Promise<SidebarConversationLine | null> => {
  const href = await link.getAttribute("href");
  const title = await link.innerText();
  return parseChatGptSidebarConversationLink({ href, title });
};

const readLooseConversationsFromScanPage = async (
  page: Page,
): Promise<SidebarConversationLine[]> => {
  const scanPage = await page.context().newPage();
  try {
    await scanPage.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
    return await readLooseConversations(scanPage);
  } finally {
    await scanPage.close().catch(() => {});
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
  const timeout = details.timeout == null ? 1_000 : details.timeout;
  for (const selector of details.selectors) {
    const locator = details.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout }).catch(() => {});

    const isLocatorVisible =
      (await locator.count()) > 0 && (await locator.isVisible().catch(() => false));
    if (isLocatorVisible) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {
        try {
          await locator.click({ timeout, force: true });
          return true;
        } catch {
          // both click attempts failed; fall through to the next candidate locator
        }
      }
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
  await details.field.dispatchEvent("input").catch(() => {});
  await details.field.dispatchEvent("change").catch(() => {});
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
    .replace(/\s+/g, " ")
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
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

type ClickModelAndDetectDetails = {
  page: Page;
  item: Locator;
};

const clickModelAndDetect = async (details: ClickModelAndDetectDetails): Promise<string> => {
  await details.item.click();
  await details.page
    .locator(SELECTORS.openMenu)
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await details.page.waitForTimeout(500);
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
  await details.page.keyboard.press("Escape").catch(() => {});
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
    await details.page.keyboard.press("Escape").catch(() => {});
    return checkedModel;
  } catch {
    await details.page.keyboard.press("Escape").catch(() => {});
    return null;
  }
};

type DetectCheckedModelFromMenuDetails = {
  page: Page;
};

const detectCheckedModelFromMenu = async (
  details: DetectCheckedModelFromMenuDetails,
): Promise<string | null> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: details.page });
    if (checkedModel) return checkedModel;

    await details.page.waitForTimeout(750);
  }
  return null;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const fromDom = await readCheckedModelFromDom({ page });
    if (fromDom) return fromDom;

    const fromTrigger = await readModelFromTrigger({ page });
    if (fromTrigger) return fromTrigger;

    const fromMenu = await detectCheckedModelFromMenu({ page });
    const isFromMenuMissing = fromMenu == null;
    if (isFromMenuMissing) return "ChatGPT";

    return fromMenu;
  } catch {
    return "ChatGPT";
  }
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
    if (isFallbackEmpty && hasHitFallback) fallback = hit.fallback;
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
  const ariaChecked = await details.item.getAttribute("aria-checked").catch(() => null);

  const isAriaCheckedRequested = ariaChecked === "true";
  if (isAriaCheckedRequested) return true;

  const toggleStatus = await details.item.getAttribute("data-state").catch(() => null);
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

  const isQueryContainingLabel = details.normalizedQuery.includes(
    cleanModelQuery({ value: details.label }),
  );
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
  return page
    .locator(
      [
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] [role="menuitemradio"]',
        '[data-radix-menu-content] [role="menuitem"]',
        '[data-radix-menu-content] [role="menuitemradio"]',
        '[role="menu"] [data-testid^="model-switcher-"]',
        '[data-radix-menu-content] [data-testid^="model-switcher-"]',
      ].join(", "),
    )
    .all();
};

type ClickModelTriggerDetails = {
  trigger: NonNullable<Awaited<ReturnType<typeof readFirstVisible>>>;
};

const clickModelTrigger = async (details: ClickModelTriggerDetails): Promise<void> => {
  try {
    await details.trigger.click({ timeout: 5_000 });
  } catch {
    await details.trigger.click({ timeout: 5_000, force: true });
  }
};

type OpenModelMenuDetails = {
  page: Page;
};

const openModelMenu = async (details: OpenModelMenuDetails): Promise<void> => {
  await details.page
    .locator(SELECTORS.modelTrigger.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});

  const trigger = await readFirstVisible({ page: details.page, selectors: SELECTORS.modelTrigger });
  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) throw new Error("Could not find ChatGPT model switcher button.");

  await clickModelTrigger({ trigger });
  await details.page
    .locator(SELECTORS.openMenu)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
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
  const ariaLabel = await details.trigger.getAttribute("aria-label").catch(() => null);
  const isLabelUsable = ariaLabel && isLikelyModelLabel(ariaLabel);
  return isLabelUsable ? ariaLabel.trim() : null;
};

type ReadLikelyModelLineDetails = {
  text: string;
};

const readLikelyModelLine = (details: ReadLikelyModelLineDetails): string | null => {
  const modelLine = details.text.split("\n").find((part) => isLikelyModelLabel(part));

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
    text: cleanDisplayString({ value: await trigger.innerText().catch(() => "") }),
  });
  if (line) return line;

  return readLikelyAriaModelLabel({ trigger });
};

type ReadModelElementIdDetails = {
  item: Locator;
};

const readModelElementId = async (details: ReadModelElementIdDetails): Promise<string> => {
  const testId = await details.item.getAttribute("data-testid").catch(() => null);
  const isModelSwitcherTestId = testId?.startsWith("model-switcher-");
  if (isModelSwitcherTestId) return testId.replace("model-switcher-", "");

  const label = await readModelElementLabel({ item: details.item });
  return cleanModelQuery({ value: label }).replace(/\s+/g, "-");
};

type ReadModelElementLabelDetails = {
  item: Locator;
};

const readModelElementLabel = async (details: ReadModelElementLabelDetails): Promise<string> => {
  const testId = await details.item.getAttribute("data-testid").catch(() => null);
  const isModelSwitcherTestId = testId?.startsWith("model-switcher-");
  if (isModelSwitcherTestId) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }

  return cleanDisplayString({ value: await details.item.innerText().catch(() => "") });
};

export const readNoModelMatchedMessage = (details: {
  query: string;
  seenLabels: string[];
}): string => {
  const isSeenLabelsEmpty = details.seenLabels.length === 0;
  if (isSeenLabelsEmpty)
    return `No model matched "${details.query}". The model menu opened but showed no model names.`;

  return `No model matched "${details.query}". The model menu showed: ${details.seenLabels.join(", ")}.`;
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
  throw new Error(readNoModelMatchedMessage({ query: details.query, seenLabels }));
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
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
    return;
  } catch {
    // Send button never surfaced within the window; fall through to the Enter fallback.
  }

  // While a response streams, the send slot is the stop button — pressing Enter there would
  // either no-op or interrupt the stream, so skip the fallback until the conversation is idle.
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

// A send is confirmed by the composer emptying, a new user turn, or a reply that starts streaming.
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
const submissionConfirmPollMilliseconds = 500;

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
  await page.bringToFront().catch(() => {});
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
  await findVisibleComposer(details.page).waitFor({ state: "visible" });
};

const runInjectPromptAttempts = async (details: RunInjectPromptAttemptsDetails): Promise<void> => {
  await ensureChatMode({ page: details.page });
  const composer = findVisibleComposer(details.page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
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

  // An image turn must also see the image network fall quiet: every tile that lands resets
  // msSinceImageActivity, so a turn streaming several images never settles between them.
  const isImageSettling = awaitingImages && status.msSinceImageActivity < ASSET_SETTLE_QUIET_MS;
  if (isImageSettling) return false;

  // Fewer tiles have loaded than were requested (via --images) or announced (via [image-N]
  // markers): keep waiting, unless generation has clearly stalled — then settle with what
  // loaded so a short generation never hangs to the full timeout.
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
  return Math.max(1_000, details.timeout - (Date.now() - details.startedAt));
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
  return isResponseGenerating(details.page, SELECTORS.streamingIndicator);
};

type ReadNormalizedLastReplyDetails = {
  page: Page;
};

const readNormalizedLastReply = async (
  details: ReadNormalizedLastReplyDetails,
): Promise<string> => {
  const string = await captureLastReply(details.page).catch(() => "");
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
  const turnStatus = (await details.page.evaluate(LAST_ASSISTANT_TURN_STATUS_ORIGIN).catch(() => ({
    text: "",
    assetCount: 0,
    loadedAssetCount: 0,
    pendingAssetCount: 0,
    expectedImageMarkerCount: 0,
  }))) as LastAssistantTurnStatus;
  const streaming = await isStreamingVisible({ page: details.page });
  const string = cleanDisplayString({
    value: turnStatus.text || (await readNormalizedLastReply({ page: details.page })),
  });
  const expectedImageMarkerCount = Math.max(
    turnStatus.expectedImageMarkerCount,
    countExpectedImageMarkers(string),
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
  return isTurnSettled({
    hasText: !!details.snapshot.text,
    isTransientText: isTransientAssistantString({ text: details.snapshot.text }),
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
  await page
    .waitForSelector(SELECTORS.promptInput, { state: "visible", timeout: 15_000 })
    .catch(() => {});
};

const waitForLastAssistantStringStable = async (
  details: WaitForLastAssistantStringStableDetails,
): Promise<void> => {
  const startedAt = Date.now();
  // Recover a render stuck against a stale DOM (lingering stop indicator, tiles that never
  // re-render): when nothing progresses for RENDER_STALL_RELOAD_MS, reload the tab to re-sync
  // with server truth. Real progress (text/asset change or a fresh image response) resets it,
  // so a genuinely-streaming long render is never interrupted.
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
      // A generated-image tile just arrived over the network even if the DOM count has not
      // updated yet — count that as progress so a live image stream is never reloaded.
      watchdog.noteProgress();
    }

    const isTurnSettled = turnSnapshotSettled({
      snapshot,
      stableForMs: Date.now() - stableSince,
      expectImages: details.expectImages,
      msSinceImageActivity: details.imageActivity.msSinceLastActivity(),
      sawImageActivity: details.imageActivity.sawActivity(),
    });
    if (isTurnSettled) return;

    const hasReloadedPage = await watchdog.reloadIfStalled(details.page);
    if (hasReloadedPage) {
      // Re-baseline after the reload so the settle timer never fires on pre-reload reads.
      lastSnapshot = await readTurnSnapshot({ page: details.page });
      stableSince = Date.now();
      continue;
    }

    await details.page.waitForTimeout(500);
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

    await details.page.waitForTimeout(250);
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
    const isImageActivityUrl = IMAGE_ACTIVITY_URL.test(reply.url());
    if (isImageActivityUrl) lastActivityAt = Date.now();
  };
  page.on("response", saveReplyActivity);
  return {
    msSinceLastActivity: () => {
      const hasNoActivity = lastActivityAt === 0;
      return hasNoActivity ? Number.POSITIVE_INFINITY : Date.now() - lastActivityAt;
    },
    sawActivity: () => lastActivityAt !== 0,
    dispose: () => page.off("response", saveReplyActivity),
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
    await waitForLastAssistantStringStable({
      page,
      timeout: readRemainingTimeout({ startedAt, timeout: parsed.timeout }),
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
  try {
    await details.page
      .locator(SELECTORS.streamingIndicator)
      .waitFor({ state: "visible", timeout: 10_000 });
    await details.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: readRemainingTimeout({ startedAt: details.startedAt, timeout: details.timeout }),
    });
  } catch {
    // Response might already be complete
  }
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

  return {
    timeout: settings.timeout == null ? 300_000 : settings.timeout,
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
      providerId: "chatgpt",
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

const SESSION_SIGNAL_TIMEOUT_MS = 15_000;

const waitForSessionSignal = async (page: Page): Promise<void> => {
  const sessionSignalSelectors = [
    ...SELECTORS.accountMenuButton,
    ...SELECTORS.guestLoginButton,
    SELECTORS.promptInput,
  ];
  const sessionSignal = page
    .locator(sessionSignalSelectors.join(", "))
    .filter({ visible: true })
    .first();
  try {
    await sessionSignal.waitFor({ state: "visible", timeout: SESSION_SIGNAL_TIMEOUT_MS });
  } catch (error) {
    const isNotErrorInstanceErrorsTimeoutError = !(error instanceof errors.TimeoutError);
    if (isNotErrorInstanceErrorsTimeoutError) throw error;
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
  id: "chatgpt",
  origin: "chatgpt.com",
  defaultUrl: "https://chatgpt.com",
  defaultModel: "ChatGPT",
  displayName: "ChatGPT",
  composerSelector: PROVIDER_CONFIG.chatgpt.selectors.composer,
  supportsMcpConnector: true,
  assertSignedIn,
  injectPrompt,
  waitForResponse: waitForReply,
  captureLastResponse: captureLastReply,
  countAssistantResponses: countAssistantReplies,
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
