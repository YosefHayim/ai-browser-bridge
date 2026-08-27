import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { APIResponse, Locator, Page, Response } from "playwright";
import { BRIDGE_DIR_NAME, PROVIDER_CONFIG, REPO_DIR_NAME } from "@/config";
import type {
  Attachment,
  AttachmentManifest,
  AttachmentRole,
  ConnectorSetupOptions,
  ConnectorSetupResult,
  ModelOption,
} from "@/features/domain";
import type { BrowserProvider, CaptureMessagesOptions } from "../browserProvider.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { stallReloadWatchdogFor } from "../renderStallWatchdog.ts";
import { isResponseGenerating, waitForResponseIdle } from "../streamingGuard.ts";
import { searchChatGptConversations } from "./chatgptConversationSearch.ts";
import {
  chatGptConversationIdFromUrl,
  chatGptConversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "./chatgptConversationUrl.ts";

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

const DOM_SNAPSHOT_HELPERS_SOURCE = `
const GENERATED_IMAGE_SELECTOR = 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image"]';

const serializeMessage = (element, messageIndex) => {
  const authorRole = element.getAttribute("data-message-author-role");
  const role = authorRole === null ? "unknown" : authorRole;
  let text = "";
  if (element instanceof HTMLElement) {
    text = element.innerText;
  } else if (element.textContent !== null) {
    text = element.textContent;
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
  const roleBlock = turn.querySelector("[data-message-author-role]");
  const generatedImages = Array.from(turn.querySelectorAll(GENERATED_IMAGE_SELECTOR));
  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    let text = "";
    if (turn instanceof HTMLElement) {
      text = turn.innerText;
    } else if (turn.textContent !== null) {
      text = turn.textContent;
    }
    return {
      role: "assistant",
      messageIndex,
      text,
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }
  const message = serializeMessage(roleBlock, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
};

const turnRole = (turn) => {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  if (roleBlock) {
    const authorRole = roleBlock.getAttribute("data-message-author-role");
    return authorRole === null ? "unknown" : authorRole;
  }
  if (turn.querySelector(GENERATED_IMAGE_SELECTOR)) return "assistant";
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

const LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}
  const turns = Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'));
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

const LAST_ASSISTANT_TURN_STATE_SOURCE = String.raw`
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}
  const countImageMarkers = (text) => {
    const matches = text.match(/\[image-\d+\]/g);
    return matches ? matches.length : 0;
  };
  const turns = Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'));
  let lastAssistantTurn = null;
  for (const turn of turns) {
    if (turnRole(turn) === "assistant") lastAssistantTurn = turn;
  }
  if (!lastAssistantTurn) {
    return { text: "", assetCount: 0, loadedAssetCount: 0, pendingAssetCount: 0, expectedImageMarkerCount: 0 };
  }
  const images = Array.from(lastAssistantTurn.querySelectorAll(GENERATED_IMAGE_SELECTOR));
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
  const roleBlock = lastAssistantTurn.querySelector('[data-message-author-role="assistant"]');
  let rawText = "";
  if (roleBlock instanceof HTMLElement) {
    rawText = roleBlock.innerText;
  } else if (lastAssistantTurn.innerText) {
    rawText = lastAssistantTurn.innerText;
  }
  const text = rawText.replace(/\s+/g, " ").trim();
  return {
    text,
    assetCount: images.length,
    loadedAssetCount,
    pendingAssetCount,
    expectedImageMarkerCount: countImageMarkers(text),
  };
})()
`;

const ALL_MESSAGES_SNAPSHOT_SOURCE = `
(() => {
  ${DOM_SNAPSHOT_HELPERS_SOURCE}
  let assistantIndex = -1;
  let userIndex = -1;
  const messages = [];
  for (const turn of Array.from(document.querySelectorAll('section[data-testid^="conversation-turn-"]'))) {
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
    'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',

  responseBlock: PROVIDER_CONFIG.chatgpt.selectors.assistant,

  lastResponse: `${PROVIDER_CONFIG.chatgpt.selectors.assistant}:last-of-type`,

  sidebarConversation: 'nav a[href^="/c/"]',
  // Streaming indicator (stop button appears while a turn is generating).
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(", "),
  /** ChatGPT-generated images render outside the role block, served from the estuary content endpoint. */
  generatedImage: 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]',

  modelTrigger: [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],

  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',

  userBlock: '[data-message-author-role="user"]',

  conversationTurn: 'section[data-testid^="conversation-turn-"]',

  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ],

  accountMenuButton: [
    '[data-testid="accounts-profile-button"]',
    '[role="button"][aria-label*="open profile menu" i]',
    'button[data-testid="profile-button"]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="account" i]',
    'button[aria-label*="user" i]',
  ],
  settingsEntrypoint: [
    '[role="menuitem"]:has-text("Settings")',
    'button:has-text("Settings")',
    'a:has-text("Settings")',
  ],
} as const;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === "object" && error !== null && "code" in error;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  if (await attachFilesViaInput({ page, paths })) return;
  await attachFilesViaChooser({ page, paths });
};

type OpenAttachmentFileChooserContext = {
  page: Page;
};

const openAttachmentFileChooser = async (ctx: OpenAttachmentFileChooserContext) => {
  const attachButton = await firstVisible({
    page: ctx.page,
    selectors: [
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Upload" i]',
      'button[data-testid*="attach" i]',
      'button[data-testid*="upload" i]',
    ],
  });
  if (!attachButton) throw new Error("Could not find ChatGPT attachment control.");
  const chooserPromise = ctx.page.waitForEvent("filechooser", { timeout: 5_000 });
  await attachButton.click();
  return chooserPromise;
};

type AttachFilesViaChooserContext = {
  page: Page;
  paths: string[];
};

const attachFilesViaChooser = async (ctx: AttachFilesViaChooserContext): Promise<void> => {
  const chooser = await openAttachmentFileChooser({ page: ctx.page });
  await (await chooser).setFiles(ctx.paths);
};

type AttachFilesViaInputContext = {
  page: Page;
  paths: string[];
};

const attachFilesViaInput = async (ctx: AttachFilesViaInputContext): Promise<boolean> => {
  const input = ctx.page.locator(SELECTORS.attachmentInput).first();
  if ((await input.count()) === 0) return false;
  await input.setInputFiles(ctx.paths);
  return true;
};

type PreparedRewindTurnInput = {
  page: PrepareRewindTurnContext["page"];
  replacement?: string;
  lastUserBlock: Locator;
  previousAssistantCount: number;
  previousLastAssistantText: string;
};

const preparedRewindTurn = async (ctx: PreparedRewindTurnInput): Promise<PreparedRewindTurn> => {
  const turnScope = await lastUserTurnScope({ lastUserBlock: ctx.lastUserBlock });
  const prompt = rewindPrompt({
    replacement: ctx.replacement,
    previousText: await readLastUserPromptText({ lastUserBlock: ctx.lastUserBlock }),
  });
  return {
    page: ctx.page,
    turnScope,
    prompt,
    previousAssistantCount: ctx.previousAssistantCount,
    previousLastAssistantText: ctx.previousLastAssistantText,
  };
};

type LoadLastUserBlockContext = {
  page: import("playwright").Page;
};

const loadLastUserBlock = async (ctx: LoadLastUserBlockContext) => {
  const blocks = await ctx.page.locator(SELECTORS.userBlock).all();
  const last = blocks[blocks.length - 1];
  if (last === undefined) throw new Error("No user message found to rewind.");
  return last;
};

type ClickRewindEditButtonContext = {
  prepared: PreparedRewindTurn;
};

const clickRewindEditButton = async (ctx: ClickRewindEditButtonContext): Promise<void> => {
  await ctx.prepared.turnScope.hover().catch(() => {});
  await ctx.prepared.page.waitForTimeout(300);
  const editButton = await findRewindEditButton({ turnScope: ctx.prepared.turnScope });
  if (!editButton) throw new Error("Could not find ChatGPT edit button for the last user message.");
  await editButton.click();
};

type OpenRewindEditorContext = {
  prepared: PreparedRewindTurn;
};

const openRewindEditor = async (ctx: OpenRewindEditorContext) => {
  await clickRewindEditButton({ prepared: ctx.prepared });
  return findRewindEditor({ page: ctx.prepared.page, turnScope: ctx.prepared.turnScope });
};

const prepareRewindTurn = async (ctx: PrepareRewindTurnContext): Promise<PreparedRewindTurn> => {
  const lastUserBlock = await loadLastUserBlock({ page: ctx.page });
  const previousAssistantCount = await countAssistantResponses(ctx.page);
  const previousLastAssistantText = await captureLastResponse(ctx.page);
  return preparedRewindTurn({
    page: ctx.page,
    replacement: ctx.replacement,
    lastUserBlock,
    previousAssistantCount,
    previousLastAssistantText,
  });
};

type FindRewindEditButtonContext = {
  turnScope: Locator;
};

const findRewindEditButton = async (ctx: FindRewindEditButtonContext) => {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: EDIT_BUTTON_SELECTORS });
};

type FindRewindEditorContext = {
  page: Page;
  turnScope: Locator;
};

const findRewindEditor = async (ctx: FindRewindEditorContext) => {
  const scopedEditor = await firstVisibleIn({
    parent: ctx.turnScope,
    selectors: EDITOR_SELECTORS,
  });
  if (scopedEditor !== null) return scopedEditor;
  return firstVisible({ page: ctx.page, selectors: EDITOR_SELECTORS });
};

type FindRewindSubmitButtonContext = {
  page: Page;
  turnScope: Locator;
};

const findRewindSubmitButton = async (ctx: FindRewindSubmitButtonContext) => {
  const scopedSubmit = await firstVisibleIn({
    parent: ctx.turnScope,
    selectors: SUBMIT_BUTTON_SELECTORS,
  });
  if (scopedSubmit !== null) return scopedSubmit;
  return firstVisible({ page: ctx.page, selectors: SUBMIT_BUTTON_SELECTORS });
};

type SubmitRewindEditorContext = {
  editor: Locator;
  prompt: string;
};

const submitRewindEditor = async (ctx: SubmitRewindEditorContext): Promise<void> => {
  await ctx.editor.click();
  await ctx.editor.fill(ctx.prompt);
  await ctx.editor.dispatchEvent("input").catch(() => {});
};

type LastUserTurnScopeInput = {
  lastUserBlock: Locator;
};

const lastUserTurnScope = async (ctx: LastUserTurnScopeInput): Promise<Locator> => {
  const turn = ctx.lastUserBlock.locator(
    'xpath=ancestor::section[starts-with(@data-testid, "conversation-turn-")][1]',
  );
  return (await turn.count()) > 0 ? turn : ctx.lastUserBlock;
};

type ReadLastUserPromptTextContext = {
  lastUserBlock: Locator;
};

const readLastUserPromptText = async (ctx: ReadLastUserPromptTextContext): Promise<string> => {
  return normalizeDisplayText({ value: await ctx.lastUserBlock.innerText() });
};

type RewindPromptInput = {
  replacement?: string;
  previousText: string;
};

const rewindPrompt = (ctx: RewindPromptInput): string => {
  const replacement = ctx.replacement?.trim();
  const prompt = replacement === undefined || replacement === "" ? ctx.previousText : replacement;
  if (!prompt) throw new Error("Last user message is empty.");
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

type PrepareRewindTurnContext = {
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

type SubmitEditedRewindTurnContext = {
  prepared: PreparedRewindTurn;
};

const submitEditedRewindTurn = async (ctx: SubmitEditedRewindTurnContext): Promise<void> => {
  const submitButton = await findRewindSubmitButton({
    page: ctx.prepared.page,
    turnScope: ctx.prepared.turnScope,
  });
  if (!submitButton) throw new Error("Could not find submit button for edited prompt.");
  await submitButton.click();
  await waitForResponse(ctx.prepared.page, {
    previousAssistantCount: ctx.prepared.previousAssistantCount,
    previousLastAssistantText: ctx.prepared.previousLastAssistantText,
  });
};

type SubmitRewindTurnContext = {
  prepared: PreparedRewindTurn;
};

const submitRewindTurn = async (ctx: SubmitRewindTurnContext): Promise<void> => {
  const editor = await openRewindEditor({ prepared: ctx.prepared });
  if (!editor) throw new Error("Could not find editable prompt field after clicking edit.");
  await submitRewindEditor({ editor, prompt: ctx.prepared.prompt });
  await submitEditedRewindTurn({ prepared: ctx.prepared });
};

const registeredAttachment = (ctx: {
  item: ExtractedContent["attachments"][number];
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
  const existing = findExistingAttachment(ctx);
  if (existing) return reuseExisting({ ctx, existing });
  return createAttachment(ctx);
};

const reuseExisting = (params: {
  ctx: { usedExistingIds: Set<string> };
  existing: Attachment;
}): Attachment => {
  params.ctx.usedExistingIds.add(params.existing.id);
  return params.existing;
};

const createAttachment = (ctx: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment => {
  ctx.params.counters[ctx.params.role][ctx.item.kind] += 1;
  const attachment = newAttachment(ctx);
  ctx.newAttachments.push(attachment);
  return attachment;
};

const findExistingAttachment = (ctx: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | undefined => {
  return ctx.params.existing.find(
    (attachment) =>
      !ctx.usedExistingIds.has(attachment.id) &&
      attachment.role === ctx.params.role &&
      attachment.messageIndex === ctx.params.messageIndex &&
      attachment.kind === ctx.item.kind &&
      attachment.url === ctx.item.url,
  );
};

const newAttachment = (ctx: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
}): Attachment => {
  const suffix = ctx.params.counters[ctx.params.role][ctx.item.kind];
  return {
    ...ctx.item,
    id: attachmentId({ role: ctx.params.role, kind: ctx.item.kind, suffix }),
    role: ctx.params.role,
    messageIndex: ctx.params.messageIndex,
    createdAt: ctx.params.createdAt,
  };
};

const attachmentId = (params: {
  role: AttachmentRole;
  kind: AttachmentKind;
  suffix: number;
}): string => {
  return params.role === "user"
    ? `user-${params.kind}-${params.suffix}`
    : `${params.kind}-${params.suffix}`;
};

const registerExtractedContent = async (params: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedContent;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  const manifest = await loadManifest(params.conversationId, {
    manifestRoot: params.manifestRoot,
  });
  const registered = assignAttachmentIds({
    extracted: params.extracted,
    role: "assistant",
    messageIndex: params.messageIndex,
    counters: countersFromManifest(manifest),
    createdAt: new Date().toISOString(),
    existing: manifest.attachments,
  });
  return finalizeRegistration({ manifest, registered, manifestRoot: params.manifestRoot });
};

const assignAttachmentIds = (params: {
  extracted: ExtractedContent;
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
  const attachments = params.extracted.attachments.map((item) =>
    registeredAttachment({ item, params, usedExistingIds, newAttachments }),
  );
  return {
    text: replaceMarkers({ text: params.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: params.counters,
  };
};

const finalizeRegistration = async (params: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
  manifestRoot?: string | undefined;
}): Promise<{ text: string; attachments: Attachment[] }> => {
  params.manifest.attachments.push(...params.registered.newAttachments);
  params.manifest.counters = params.registered.counters;
  await saveManifest(params.manifest, { manifestRoot: params.manifestRoot });
  return { text: params.registered.text, attachments: params.registered.attachments };
};

const replaceMarkers = (params: { text: string; attachments: Attachment[] }): string => {
  let content = params.text;
  for (let index = 0; index < params.attachments.length; index += 1) {
    const attachmentId = params.attachments[index]?.id;
    const markerId = attachmentId === undefined ? "" : attachmentId;
    content = content.replace(markerFor(index), `[${markerId}]`);
  }
  return content;
};

const markerFor = (index: number): string => {
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

type ExtractMessagesOptions = {
  conversationId: string;
  includeUserAttachments?: boolean;
  manifestRoot?: string | undefined;
};

type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

type ManifestStoreOptions = {
  manifestRoot?: string | undefined;
};

type AttachmentCandidate = {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
};

type ExtractedContent = {
  text: string;
  attachments: AttachmentCandidate[];
};

type SerializedMessage = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};

export const downloadAttachment = async (
  page: Page,
  conversationId: string,
  id: string,
  opts: DownloadOptions,
): Promise<DownloadResult> => {
  const manifest = await loadManifest(conversationId, { manifestRoot: opts.manifestRoot });
  const attachment = manifest.attachments.find((attachment: Attachment) => attachment.id === id);
  if (!attachment)
    throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);
  return downloadResolvedAttachment({
    page,
    conversationId,
    attachment,
    attachments: manifest.attachments,
    opts,
  });
};

export const downloadAll = async (
  page: Page,
  conversationId: string,
  opts: DownloadAllOptions,
): Promise<DownloadAllResult[]> => {
  const manifest = await loadManifest(conversationId, { manifestRoot: opts.manifestRoot });
  const ids =
    opts.ids === undefined
      ? manifest.attachments.map((attachment: Attachment) => attachment.id)
      : opts.ids;
  const downloadResults = await downloadIds({ page, conversationId, ids, opts });
  if (
    downloadResults.length > 0 &&
    downloadResults.every((downloadResult) => downloadResult.error)
  ) {
    const failedIds = opts.ids === undefined ? "*" : opts.ids.join(",");
    throw new AttachmentDownloadError(
      failedIds,
      undefined,
      `Failed to download all attachments for conversation ${conversationId}`,
      downloadResults,
    );
  }
  return downloadResults;
};

type DownloadResolvedInput = {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  opts: DownloadOptions;
};

const downloadResolvedAttachment = async (
  input: DownloadResolvedInput,
): Promise<DownloadResult> => {
  const outDir = outputDirectory({
    conversationId: input.conversationId,
    outDir: input.opts.outDir,
    repoRoot: input.opts.repoRoot,
  });
  await mkdir(outDir, { recursive: true });
  try {
    if (isHttpUrl(input.attachment.url)) {
      return await downloadHttpAttachment({
        page: input.page,
        attachment: input.attachment,
        outDir,
        attachments: input.attachments,
      });
    }
    const filePath = await availableDownloadPath({
      outDir,
      attachment: input.attachment,
      attachments: input.attachments,
    });
    const bytes = input.attachment.url.startsWith("blob:")
      ? await fetchBlobBytes({ page: input.page, attachment: input.attachment })
      : parseDataUrl({ attachment: input.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Failed to download attachment ${input.attachment.id}`,
      error,
    );
  }
};

type DownloadIdsInput = {
  page: Page;
  conversationId: string;
  ids: string[];
  opts: DownloadAllOptions;
};

const downloadIds = async (input: DownloadIdsInput): Promise<DownloadAllResult[]> => {
  const downloadResults: DownloadAllResult[] = [];
  for (const attachmentId of input.ids) {
    downloadResults.push(await downloadOneId({ input, attachmentId }));
  }
  return downloadResults;
};

const downloadOneId = async (input: {
  input: DownloadIdsInput;
  attachmentId: string;
}): Promise<DownloadAllResult> => {
  try {
    const downloaded = await downloadAttachment(
      input.input.page,
      input.input.conversationId,
      input.attachmentId,
      input.input.opts,
    );
    return { id: input.attachmentId, ...downloaded };
  } catch (error) {
    return {
      id: input.attachmentId,
      path: "",
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
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

type DownloadResult = {
  path: string;
  bytes: number;
};

type DownloadAllResult = DownloadResult & {
  id: string;
  error?: string;
};

type DownloadOptions = {
  outDir?: string;
  repoRoot: string;
  manifestRoot?: string | undefined;
};

type DownloadAllOptions = DownloadOptions & {
  ids?: string[];
};

type ParseDataUrlInput = {
  attachment: Attachment;
};

const parseDataUrl = (input: ParseDataUrlInput): Buffer => {
  // Matches data URLs like data:image/png;base64,iVBORw0KGgo=.
  // Named captures: metadata before the comma, encodedPayload after it.
  const match = /^data:(?<metadata>[^,]*),(?<encodedPayload>.*)$/s.exec(input.attachment.url);
  if (!match?.groups) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Invalid data URL for attachment ${input.attachment.id}`,
    );
  }
  const metadata = match.groups.metadata === undefined ? "" : match.groups.metadata;
  const encodedPayload =
    match.groups.encodedPayload === undefined ? "" : match.groups.encodedPayload;
  return decodeDataUrlBytes({ metadata, encodedPayload });
};

const decodeDataUrlBytes = (input: { metadata: string; encodedPayload: string }): Buffer => {
  if (input.metadata.split(";").includes("base64")) {
    return Buffer.from(input.encodedPayload, "base64");
  }
  return Buffer.from(decodeURIComponent(input.encodedPayload), "utf8");
};

type SanitizeFilenameInput = {
  value: string | undefined;
};

const sanitizeFilename = (input: SanitizeFilenameInput): string | undefined => {
  const sanitized = input.value?.replace(UNSAFE_FILENAME_CHARS, "").replace(/^\.+/, "").trim();
  return sanitized ? sanitized : undefined;
};

type FilenameFromUrlInput = {
  url: string;
};

const filenameFromUrl = (input: FilenameFromUrlInput): string | undefined => {
  try {
    const parsed = new URL(input.url);
    const basename = path.posix.basename(parsed.pathname);
    return basename && basename !== "/" ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
  }
};

type SameAttachmentInput = {
  left: Attachment;
  right: Attachment;
};

const isSameAttachment = (input: SameAttachmentInput): boolean => {
  return (
    input.left.id === input.right.id &&
    input.left.url === input.right.url &&
    input.left.filename === input.right.filename
  );
};

type ExtensionForMimeInput = {
  mime: string | undefined;
};

const extensionForMime = (input: ExtensionForMimeInput): string | undefined => {
  const normalized = input.mime?.toLowerCase().split(";")[0]?.trim();
  return normalized ? MIME_EXTENSIONS[normalized] : undefined;
};

type ExtensionForAttachmentInput = {
  attachment: Attachment;
  mimeOverride?: string;
};

const extensionForAttachment = (input: ExtensionForAttachmentInput): string => {
  const overrideExtension = extensionForMime({ mime: input.mimeOverride });
  const attachmentExtension = extensionForMime({ mime: input.attachment.mime });
  const mimeExtension = overrideExtension === undefined ? attachmentExtension : overrideExtension;
  if (mimeExtension) return mimeExtension;
  if (input.attachment.kind === "image") return ".png";
  if (input.attachment.kind === "pdf") return ".pdf";
  return "";
};

type WithMissingExtensionInput = {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
};

const withMissingExtension = (input: WithMissingExtensionInput): string => {
  if (path.extname(input.filename)) return input.filename;
  return `${input.filename}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`;
};

type FilenameForAttachmentInput = {
  attachment: Attachment;
  mimeOverride?: string;
};

const filenameForAttachment = (input: FilenameForAttachmentInput): string => {
  const preferred = preferredFilename(input);
  if (preferred) return preferred;
  const fallback = sanitizeFilename({
    value: `${input.attachment.id}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`,
  });
  if (fallback === undefined) return input.attachment.id;
  return fallback;
};

const preferredFilename = (input: FilenameForAttachmentInput): string | undefined => {
  const preferred = sanitizeFilename({ value: input.attachment.filename });
  if (preferred)
    return withMissingExtension({
      filename: preferred,
      attachment: input.attachment,
      mimeOverride: input.mimeOverride,
    });
  return sanitizeFilename({ value: filenameFromUrl({ url: input.attachment.url }) });
};

type DownloadPathInput = {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
};

const availableDownloadPath = async (input: DownloadPathInput): Promise<string> => {
  const filename = filenameForAttachment({
    attachment: input.attachment,
    mimeOverride: input.mimeOverride,
  });
  const filePath = outputPath({ outDir: input.outDir, filename });
  if ((await existingSize({ filePath })) === undefined) return filePath;
  return collisionFreeDownloadPath({ input, filename, filePath });
};

const collisionFreeDownloadPath = async (input: {
  input: DownloadPathInput;
  filename: string;
  filePath: string;
}): Promise<string> => {
  const owner = input.input.attachments.find(
    (item) =>
      filenameForAttachment({ attachment: item, mimeOverride: input.input.mimeOverride }) ===
      input.filename,
  );
  if (!owner || isSameAttachment({ left: owner, right: input.input.attachment }))
    return input.filePath;
  return outputPath({
    outDir: input.input.outDir,
    filename: disambiguateFilename({ filename: input.filename, id: input.input.attachment.id }),
  });
};

type FetchBlobInput = {
  page: Page;
  attachment: Attachment;
};

const fetchBlobBytes = async (input: FetchBlobInput): Promise<Buffer> => {
  try {
    const bytes = await input.page.evaluate(async (url: string): Promise<number[] | Uint8Array> => {
      const blobFetch = await fetch(url);
      if (!blobFetch.ok) throw new Error(`Blob fetch failed with HTTP ${blobFetch.status}`);
      return new Uint8Array(await blobFetch.arrayBuffer());
    }, input.attachment.url);
    return Buffer.from(bytes);
  } catch (error) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Failed to fetch blob attachment ${input.attachment.id}`,
      error,
    );
  }
};

type DownloadHttpInput = {
  page: Page;
  attachment: Attachment;
  outDir: string;
  attachments: Attachment[];
};

const downloadHttpAttachment = async (input: DownloadHttpInput): Promise<DownloadResult> => {
  const httpResponse = await input.page.context().request.get(input.attachment.url);
  if (!httpResponse.ok())
    throwFailedHttpAttachment({ attachment: input.attachment, status: httpResponse.status() });
  return await saveHttpAttachmentResponse({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    httpResponse,
  });
};

const saveHttpAttachmentResponse = async (input: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  httpResponse: APIResponse;
}): Promise<DownloadResult> => {
  const headers = input.httpResponse.headers();
  const filePath = await availableDownloadPath({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    mimeOverride: headers["content-type"],
  });
  const contentLength = Number(headers["content-length"]);
  if (Number.isSafeInteger(contentLength) && (await existingSize({ filePath })) === contentLength) {
    return { path: filePath, bytes: contentLength };
  }
  return writeIfChanged({ filePath, bytes: await input.httpResponse.body() });
};

const throwFailedHttpAttachment = (input: { attachment: Attachment; status: number }): void => {
  throw new AttachmentDownloadError(
    input.attachment.id,
    input.attachment.url,
    `Attachment ${input.attachment.id} request failed with HTTP ${input.status}`,
  );
};

type OutputDirectoryInput = {
  conversationId: string;
  outDir?: string;
  repoRoot: string;
};

// Default: <repo>/.bridge/downloads/<conversationId>
const outputDirectory = (input: OutputDirectoryInput): string => {
  if (input.outDir) return path.resolve(input.outDir);
  return path.resolve(input.repoRoot, REPO_DIR_NAME, "downloads", input.conversationId);
};

type OutputPathInput = {
  outDir: string;
  filename: string;
};

const outputPath = (input: OutputPathInput): string => {
  const resolvedOutDir = path.resolve(input.outDir);
  const filePath = path.resolve(resolvedOutDir, input.filename);
  const relativePath = path.relative(resolvedOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AttachmentDownloadError(
      "",
      undefined,
      `Invalid attachment output path: ${input.filename}`,
    );
  }
  return filePath;
};

const isHttpUrl = (url: string): boolean => {
  return url.startsWith("https://") || url.startsWith("http://");
};

type DisambiguateInput = {
  filename: string;
  id: string;
};

const disambiguateFilename = (input: DisambiguateInput): string => {
  const extension = path.extname(input.filename);
  if (!extension) return `${input.filename}-${input.id}`;
  return `${input.filename.slice(0, -extension.length)}-${input.id}${extension}`;
};

type ExistingSizeInput = {
  filePath: string;
};

const existingSize = async (input: ExistingSizeInput): Promise<number | undefined> => {
  try {
    return (await stat(input.filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
};

type WriteIfChangedInput = {
  filePath: string;
  bytes: Buffer;
};

const writeIfChanged = async (input: WriteIfChangedInput): Promise<DownloadResult> => {
  if ((await existingSize({ filePath: input.filePath })) === input.bytes.byteLength) {
    return { path: input.filePath, bytes: input.bytes.byteLength };
  }
  await writeFile(input.filePath, input.bytes);
  return { path: input.filePath, bytes: input.bytes.byteLength };
};

const persistAllMessages = async (params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const manifest = await loadManifest(params.opts.conversationId, {
    manifestRoot: params.opts.manifestRoot,
  });
  const state = {
    manifest,
    counters: countersFromManifest(manifest),
    now: new Date().toISOString(),
  };
  const captured = await mapCapturedMessages({ ...params, ...state });
  return saveCapturedMessages({
    captured,
    manifest: state.manifest,
    counters: state.counters,
    manifestRoot: params.opts.manifestRoot,
  });
};

const saveCapturedMessages = async (params: {
  captured: Array<{ role: string; content: string; attachments: Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  manifestRoot?: string | undefined;
}) => {
  params.manifest.counters = params.counters;
  await saveManifest(params.manifest, { manifestRoot: params.manifestRoot });
  return params.captured;
};

const mapCapturedMessages = async (params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
}) => {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];
  for (const message of params.messages) {
    captured.push(
      await captureMessage({
        message,
        opts: params.opts,
        counters: params.counters,
        now: params.now,
        manifest: params.manifest,
      }),
    );
  }
  return captured;
};

const captureMessage = async (params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  if (!shouldRegisterAttachments({ message: params.message, opts: params.opts })) {
    return { role: params.message.role, content: params.message.text, attachments: [] };
  }
  return registerMessageAttachments(params);
};

const registerMessageAttachments = async (params: {
  message: SerializedMessage;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) => {
  const role: AttachmentRole = params.message.role === "user" ? "user" : "assistant";
  const registered = assignAttachmentIds({
    extracted: extractContentFromSnapshot(params.message.root),
    role,
    messageIndex: params.message.messageIndex,
    counters: params.counters,
    createdAt: params.now,
    existing: params.manifest.attachments,
  });
  params.manifest.attachments.push(...registered.newAttachments);
  return {
    role: params.message.role,
    content: registered.text,
    attachments: registered.attachments,
  };
};

const shouldRegisterAttachments = (params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
}): boolean => {
  if (params.message.role === "assistant") return true;
  return params.message.role === "user" && params.opts.includeUserAttachments === true;
};

export const extractAssistantContent = async (
  page: Page,
  opts: { conversationId: string; manifestRoot?: string | undefined },
): Promise<{ text: string; attachments: Attachment[] }> => {
  const message = await page.evaluate<SerializedMessage | null>(
    LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE,
  );
  if (!message) return { text: "", attachments: [] };
  return registerExtractedContent({
    conversationId: opts.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractContentFromSnapshot(message.root),
    manifestRoot: opts.manifestRoot,
  });
};

export const extractAllMessages = async (
  page: Page,
  opts: ExtractMessagesOptions,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> => {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_SOURCE);
  return persistAllMessages({ messages, opts });
};

const attachmentKinds = (): AttachmentKind[] => {
  return ["image", "file", "pdf"];
};

const emptyCounters = (): AttachmentCounters => {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
};

const countersFromAttachments = (attachments: Attachment[]): AttachmentCounters => {
  const counters = emptyCounters();
  for (const attachment of attachments) {
    const suffix = Number(attachment.id.split("-").at(-1));
    if (Number.isFinite(suffix)) {
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
  if (!currentCounters) return base;
  return {
    assistant: mergeKindCounters(base.assistant, currentCounters.assistant),
    user: mergeKindCounters(base.user, currentCounters.user),
  };
};

const readCurrentCounters = (value: unknown): AttachmentCounters | null => {
  if (!isRecord(value)) return null;
  if (!isKindCounters(value.assistant) || !isKindCounters(value.user)) return null;
  return { assistant: value.assistant, user: value.user };
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isKindCounters = (value: unknown): value is Record<AttachmentKind, number> => {
  return isRecord(value) && attachmentKinds().every((kind) => typeof value[kind] === "number");
};

const defaultAttachmentManifestRoot = (): string => {
  return path.join(homedir(), BRIDGE_DIR_NAME, "attachment-manifests");
};

const manifestPath = (conversationId: string, options: ManifestStoreOptions = {}): string => {
  const downloadsRoot = options.manifestRoot
    ? path.resolve(options.manifestRoot)
    : defaultAttachmentManifestRoot();
  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }
  return filePath;
};

const normalizeAttachment = (attachment: SerializedAttachment): Attachment => {
  const role = attachment.role === undefined ? "assistant" : attachment.role;
  return { ...attachment, role };
};

const normalizeManifest = (params: {
  conversationId: string;
  manifest: Partial<AttachmentManifest>;
}): AttachmentManifest => {
  const attachments = Array.isArray(params.manifest.attachments)
    ? params.manifest.attachments.map(normalizeAttachment)
    : [];
  return {
    conversationId:
      params.manifest.conversationId === undefined
        ? params.conversationId
        : params.manifest.conversationId,
    attachments,
    counters: mergeCounters(countersFromAttachments(attachments), params.manifest.counters),
  };
};

export const loadManifest = async (
  conversationId: string,
  options: ManifestStoreOptions = {},
): Promise<AttachmentManifest> => {
  try {
    const raw = await readFile(manifestPath(conversationId, options), "utf8");
    return normalizeManifest({
      conversationId,
      manifest: JSON.parse(raw) as Partial<AttachmentManifest>,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { conversationId, attachments: [], counters: emptyCounters() };
    }
    throw error;
  }
};

export const saveManifest = async (
  manifest: AttachmentManifest,
  options: ManifestStoreOptions = {},
): Promise<void> => {
  const normalized = normalizeManifest({ conversationId: manifest.conversationId, manifest });
  const filePath = manifestPath(normalized.conversationId, options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
};

const countersFromManifest = (manifest: AttachmentManifest): AttachmentCounters => {
  return mergeCounters(countersFromAttachments(manifest.attachments), manifest.counters);
};

const inferMimeFromDataUrl = (url: string): string | undefined => {
  // Matches data URL prefixes like data:image/png;base64,... .
  // Named capture mimeType is the MIME type before ";" or ",".
  const dataMatch = /^data:(?<mimeType>[^;,]+)/.exec(url);
  return dataMatch?.groups?.mimeType;
};

const inferMimeFromExtension = (params: {
  url: string;
  fallback: AttachmentKind;
}): string | undefined => {
  const pathWithoutQuery = params.url.split("?")[0];
  const lower = pathWithoutQuery === undefined ? "" : pathWithoutQuery.toLowerCase();
  const mapped = extensionMime(lower);
  if (mapped) return mapped;
  return params.fallback === "image" ? "image/*" : undefined;
};

const extensionMime = (path: string): string | undefined => {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    if (path.endsWith(suffix)) return mime;
  }
  return undefined;
};

const inferMime = (params: { url: string; fallback: AttachmentKind }): string | undefined => {
  const fromDataUrl = inferMimeFromDataUrl(params.url);
  if (fromDataUrl !== undefined) return fromDataUrl;
  return inferMimeFromExtension(params);
};

const readAttr = (params: {
  node: Extract<DomSnapshotNode, { type: "element" }>;
  name: string;
}): string | undefined => {
  return params.node.attributes[params.name];
};

const optionalText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const textOnly = (node: DomSnapshotNode): string => {
  if (node.type === "text") return node.text;
  return node.children.map(textOnly).join("");
};

const isFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>): boolean => {
  if (readAttr({ node, name: "download" }) !== undefined) return true;
  const hrefAttr = readAttr({ node, name: "href" });
  const href = hrefAttr === undefined ? "" : hrefAttr;
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const testId = readAttr({ node, name: "data-testid" });
  const ariaPart = ariaLabel === undefined ? "" : ariaLabel;
  const testIdPart = testId === undefined ? "" : testId;
  const label = `${ariaPart} ${testIdPart}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
};

const attachmentFromImage = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const currentSrc = readAttr({ node, name: "currentSrc" });
  const src = readAttr({ node, name: "src" });
  const url = currentSrc === undefined ? src : currentSrc;
  if (url === undefined || url === "") return null;
  return {
    kind: "image" as const,
    url,
    filename: optionalText(readAttr({ node, name: "alt" })),
    mime: inferMime({ url, fallback: "image" }),
  };
};

const attachmentFromIframe = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "src" });
  if (!url) return null;
  const title = readAttr({ node, name: "title" });
  const ariaLabel = readAttr({ node, name: "aria-label" });
  const filenameSource = title === undefined ? ariaLabel : title;
  return {
    kind: "pdf" as const,
    url,
    filename: optionalText(filenameSource),
    mime: "application/pdf",
  };
};

const attachmentFromFileLink = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  const url = readAttr({ node, name: "href" });
  if (!url) return null;
  return {
    kind: "file" as const,
    url,
    filename: (() => {
      const downloadName = optionalText(readAttr({ node, name: "download" }));
      if (downloadName !== undefined) return downloadName;
      return optionalText(textOnly(node));
    })(),
    mime: inferMime({ url, fallback: "file" }),
  };
};

const attachmentFromElement = (node: Extract<DomSnapshotNode, { type: "element" }>) => {
  if (node.tagName === "img") return attachmentFromImage(node);
  if (node.tagName === "iframe") return attachmentFromIframe(node);
  if (node.tagName === "a" && isFileLink(node)) return attachmentFromFileLink(node);
  return null;
};

const extractContentFromSnapshot = (root: DomSnapshotNode): ExtractedContent => {
  const attachments: AttachmentCandidate[] = [];
  const text = walkSnapshot({ node: root, attachments });
  return { text, attachments };
};

const walkSnapshot = (params: {
  node: DomSnapshotNode;
  attachments: AttachmentCandidate[];
}): string => {
  if (params.node.type === "text") {
    return typeof params.node.text === "string" ? params.node.text : "";
  }
  const attachment = attachmentFromElement(params.node);
  if (attachment) {
    params.attachments.push(attachment);
    return markerFor(params.attachments.length - 1);
  }
  if (params.node.tagName === "br") return "\n";
  return params.node.children
    .map((child) => walkSnapshot({ node: child, attachments: params.attachments }))
    .join("");
};

type IsRiskCheckboxVisibleContext = {
  setup: ConnectorSetupContext;
};

const isRiskCheckboxVisible = async (ctx: IsRiskCheckboxVisibleContext): Promise<boolean> => {
  const checkbox = ctx.setup.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  if ((await checkbox.count()) === 0) return false;
  return checkbox.isVisible().catch(() => false);
};

const acceptCustomMcpRiskIfPresent = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (!(await isRiskCheckboxVisible({ setup: ctx }))) return false;
  const checkbox = ctx.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  if (await checkbox.isChecked().catch(() => false)) return true;
  await checkbox.check({ force: true });
  return true;
};

type AppendUniqueSummaryContext = {
  summaries: ConnectorAppSummary[];
  seen: Set<string>;
  summary: ConnectorAppSummary | null;
};

const appendUniqueSummary = (ctx: AppendUniqueSummaryContext): void => {
  if (!ctx.summary) return;
  const key = connectorSummaryKey({ summary: ctx.summary });
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.summaries.push(ctx.summary);
};

type ChatGptReturnUrlContext = {
  url: string;
};

const chatGptReturnUrl = (ctx: ChatGptReturnUrlContext): string | null => {
  try {
    const parsed = new URL(ctx.url);
    if (!parsed.hostname.endsWith("chatgpt.com")) return null;
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname.startsWith("/c/")) return parsed.toString();
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
};

type FindDeleteTargetsContext = {
  summaries: ConnectorAppSummary[];
  connectorName: string;
  connectorUrl: string;
};

const findDeleteTargets = (ctx: FindDeleteTargetsContext): ConnectorAppSummary[] => {
  const current = ctx.summaries.find(
    (summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl,
  );
  return ctx.summaries.filter((summary) => {
    if (summary.name !== ctx.connectorName) return true;
    if (summary.url !== ctx.connectorUrl) return true;
    if (current === undefined) return true;
    return !sameConnectorApp({ a: summary, b: current });
  });
};

const cleanupDuplicateConnectorApps = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  const summaries = await listBridgeConnectorSummaries({ page: ctx.page });
  const current = summaries.find(
    (summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl,
  );
  await deleteDuplicateTargets({
    setup: ctx,
    deleteTargets: findDeleteTargets({
      summaries,
      connectorName: ctx.connectorName,
      connectorUrl: ctx.connectorUrl,
    }),
  });
  await openConnectorList({ page: ctx.page });
  return current !== undefined;
};

type ClickConnectorDetailsButtonContext = {
  button: Locator;
  setup: ConnectorSetupContext;
};

const clickConnectorDetailsButton = async (
  ctx: ClickConnectorDetailsButtonContext,
): Promise<void> => {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.setup.page.waitForTimeout(1_000);
  ctx.setup.result.steps.push(`Opened existing connector: ${ctx.setup.connectorName}.`);
};

type ClickConnectorEntryButtonContext = {
  button: Locator;
  page: Page;
};

const clickConnectorEntryButton = async (ctx: ClickConnectorEntryButtonContext): Promise<void> => {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(1_000);
};

const clickConnectorFromMoreMenu = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (!(await hoverAndClickMoreMenuItem({ setup: ctx }))) return false;
  return clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName });
};

type ClickConnectorListEntryContext = {
  page: Page;
  index: number;
};

const clickConnectorListEntry = async (ctx: ClickConnectorListEntryContext): Promise<boolean> => {
  await openConnectorList({ page: ctx.page });
  const entry = (await findBridgeConnectorButtons({ page: ctx.page }))[ctx.index];
  if (!entry) return false;
  await clickConnectorEntryButton({ button: entry.button, page: ctx.page });
  return true;
};

type ClickConnectorMenuItemContext = {
  page: ConnectorSetupContext["page"];
  connectorName: string;
};

const clickConnectorMenuItem = async (ctx: ClickConnectorMenuItemContext): Promise<boolean> => {
  const item = ctx.page
    .locator(
      `[role="menu"] [role="menuitem"]:has-text("${ctx.connectorName}"), [role="menu"] button:has-text("${ctx.connectorName}"), [role="menu"] :text-is("${ctx.connectorName}")`,
    )
    .last();
  if (!(await item.isVisible().catch(() => false))) return false;
  await item.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(500);
  return true;
};

type ClickDeleteConfirmationContext = {
  page: Page;
};

const clickDeleteConfirmation = async (ctx: ClickDeleteConfirmationContext): Promise<void> => {
  await clickFirstVisible({
    page: ctx.page,
    selectors: [
      '[role="alertdialog"] button:has-text("Delete")',
      '[role="dialog"] button:has-text("Delete")',
      'button:has-text("Delete app")',
      'button:has-text("Delete App")',
    ],
    timeout: 1_000,
  });
  await ctx.page.waitForTimeout(2_000);
};

type ClickDeleteMenuItemContext = {
  page: Page;
};

const clickDeleteMenuItem = async (ctx: ClickDeleteMenuItemContext) => {
  return firstVisible({
    page: ctx.page,
    selectors: [
      '[role="menu"] [role="menuitem"]:has-text("Delete")',
      '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
    ],
  });
};

type ClickMoreMenuItemContext = {
  moreItem: Locator;
  setup: ConnectorSetupContext;
};

const clickMoreMenuItem = async (ctx: ClickMoreMenuItemContext): Promise<void> => {
  await ctx.moreItem.hover().catch(() => {});
  await ctx.moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await ctx.setup.page.waitForTimeout(750);
};

type ClickSettingsEntryContext = {
  setup: ConnectorSetupContext;
};

const clickSettingsEntry = async (ctx: ClickSettingsEntryContext): Promise<void> => {
  const openedSettings = await clickFirstVisible({
    page: ctx.setup.page,
    selectors: SELECTORS.settingsEntrypoint,
    timeout: 2_000,
  });
  if (openedSettings) {
    ctx.setup.result.steps.push("Opened ChatGPT settings.");
    await ctx.setup.page.waitForTimeout(1_000);
  } else {
    ctx.setup.result.warnings.push("Could not find Settings in the account menu.");
  }
};

const closeSettingsDialogIfPresent = async (ctx: ConnectorSetupContext): Promise<void> => {
  const closeButton = await firstVisible({
    page: ctx.page,
    selectors: [
      '[role="dialog"] button[aria-label="Close"]',
      '[role="dialog"] [data-testid="close-button"]',
    ],
  });
  if (closeButton) {
    await closeButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(500);
  }
};

type ClickDeleteMenuEntryContext = {
  deleteItem: Locator;
  page: import("playwright").Page;
};

const clickDeleteMenuEntry = async (ctx: ClickDeleteMenuEntryContext): Promise<void> => {
  await ctx.deleteItem.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  await clickDeleteConfirmation({ page: ctx.page });
};

type ConfirmOpenConnectorDeletionContext = {
  page: import("playwright").Page;
};

const confirmOpenConnectorDeletion = async (
  ctx: ConfirmOpenConnectorDeletionContext,
): Promise<boolean> => {
  const deleteItem = await clickDeleteMenuItem({ page: ctx.page });
  if (!deleteItem) return false;
  await clickDeleteMenuEntry({ deleteItem, page: ctx.page });
  return true;
};

type FindSelectedConnectorPillContext = {
  page: ConnectorSetupContext["page"];
  connectorName: string;
};

const findSelectedConnectorPill = async (
  ctx: FindSelectedConnectorPillContext,
): Promise<Locator | null> => {
  const buttons = await ctx.page.locator('button[aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (aria === `${ctx.connectorName}, click to remove`) return button;
  }
  return null;
};

type IsConnectorSelectedInComposerContext = {
  setup: ConnectorSetupContext;
};

const isConnectorSelectedInComposer = async (
  ctx: IsConnectorSelectedInComposerContext,
): Promise<boolean> => {
  return !!(await findSelectedConnectorPill({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
  }));
};

const removeStaleBridgeConnectorPills = async (ctx: ConnectorSetupContext): Promise<void> => {
  const buttons = await ctx.page
    .locator('button[aria-label*="ai-browser-bridge"][aria-label*="click to remove"]')
    .all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (!aria || aria === `${ctx.connectorName}, click to remove`) continue;
    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(250);
  }
};

type NormalizeConnectorListLabelContext = {
  value: string;
};

const normalizeConnectorListLabel = (ctx: NormalizeConnectorListLabelContext): string => {
  return normalizeDisplayText({ value: ctx.value }).replace(/\s+/g, "").replace(/DEV$/i, "");
};

type ValueAfterLineContext = {
  lines: string[];
  label: string;
};

const valueAfterLine = (ctx: ValueAfterLineContext): string | null => {
  const index = ctx.lines.indexOf(ctx.label);
  const value = index >= 0 ? ctx.lines[index + 1] : null;
  return value?.trim() || null;
};

type ConnectorSummaryKeyContext = {
  summary: { name: string; appId: string | null; url: string | null };
};

const connectorSummaryKey = (ctx: ConnectorSummaryKeyContext): string => {
  const appId = ctx.summary.appId === undefined ? "" : ctx.summary.appId;
  const summaryUrl = ctx.summary.url === undefined ? "" : ctx.summary.url;
  return `${ctx.summary.name}\u0000${appId}\u0000${summaryUrl}`;
};

type SameConnectorAppContext = {
  a: { appId: string | null; name: string; url: string | null };
  b: { appId: string | null; name: string; url: string | null };
};

const sameConnectorApp = (ctx: SameConnectorAppContext): boolean => {
  if (ctx.a.appId && ctx.b.appId) return ctx.a.appId === ctx.b.appId;
  return ctx.a.name === ctx.b.name && ctx.a.url === ctx.b.url;
};

type ConnectorSetupContext = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupOptions;
  connectorName: string;
  returnUrl: string | null;
  result: ConnectorSetupResult;
};

type ExistingConnectorState = "missing" | "current" | "stale" | "unknown";

type ConnectorAppSummary = {
  name: string;
  appId: string | null;
  url: string | null;
};

type WarnMissingConnectorUrlFieldContext = {
  setup: ConnectorSetupContext;
};

const warnMissingConnectorUrlField = async (
  ctx: WarnMissingConnectorUrlFieldContext,
): Promise<void> => {
  ctx.setup.result.warnings.push(
    "Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.",
  );
  if (ctx.setup.options.automatic) await restoreAfterConnectorSetup(ctx.setup);
};

const createNewConnector = async (ctx: ConnectorSetupContext): Promise<void> => {
  await openAdvancedSettingsIfPresent(ctx);
  await enableDeveloperModeIfPresent(ctx);
  await openCreateConnectorForm(ctx);
  if (!(await fillConnectorFormFields(ctx))) {
    await warnMissingConnectorUrlField({ setup: ctx });
    return;
  }
  await finishConnectorCreation({ setup: ctx });
};

type DeleteConnectorAppBySummaryContext = {
  page: ConnectorSetupContext["page"];
  target: ConnectorAppSummary;
};

const deleteConnectorAppBySummary = async (
  ctx: DeleteConnectorAppBySummaryContext,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openConnectorList({ page: ctx.page });
    const entries = await findBridgeConnectorButtons({ page: ctx.page });
    for (const entry of entries) {
      if (entry.name !== ctx.target.name) continue;
      await entry.button.click({ timeout: 3_000, force: true });
      await ctx.page.waitForTimeout(1_000);
      const open = await readOpenConnectorSummary({ page: ctx.page });
      if (!open || !sameConnectorApp({ a: open, b: ctx.target })) continue;
      return deleteOpenConnectorIfPresent({ page: ctx.page });
    }
  }
  return false;
};

type DeleteDuplicateTargetsContext = {
  setup: ConnectorSetupContext;
  deleteTargets: ConnectorAppSummary[];
};

const deleteDuplicateTargets = async (ctx: DeleteDuplicateTargetsContext): Promise<void> => {
  for (const target of ctx.deleteTargets) {
    const deleted = await deleteConnectorAppBySummary({ page: ctx.setup.page, target });
    if (deleted) {
      ctx.setup.result.steps.push(
        `Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`,
      );
    } else {
      ctx.setup.result.warnings.push(`Could not delete duplicate connector app: ${target.name}.`);
    }
  }
};

type DeleteOpenConnectorIfPresentContext = {
  page: Page;
};

const deleteOpenConnectorIfPresent = async (
  ctx: DeleteOpenConnectorIfPresentContext,
): Promise<boolean> => {
  const manage = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Manage")'],
  });
  if (!manage) return false;
  await manage.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  return confirmOpenConnectorDeletion({ page: ctx.page });
};

const enableDeveloperModeIfPresent = async (ctx: ConnectorSetupContext): Promise<void> => {
  const outcome = await ctx.page.evaluate(ENABLE_DEVELOPER_MODE_SNIPPET);
  if (outcome === "enabled") {
    ctx.result.steps.push("Enabled Developer mode.");
    await ctx.page.waitForTimeout(750);
    return;
  }
  if (outcome === "already-enabled") {
    ctx.result.steps.push("Developer mode was already enabled.");
    return;
  }
  ctx.result.warnings.push(
    "Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.",
  );
};

const ensureComposerConnectorSelected = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  await removeStaleBridgeConnectorPills(ctx);
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  return openComposerConnectorMenu(ctx);
};

type RunConnectorSetupStepsContext = {
  setup: ConnectorSetupContext;
  hasCurrentConnector: boolean;
};

const runConnectorSetupSteps = async (
  ctx: RunConnectorSetupStepsContext,
): Promise<ConnectorSetupContext["result"]> => {
  if (
    await tryFinalizeExistingConnector({
      setup: ctx.setup,
      hasCurrentConnector: ctx.hasCurrentConnector,
    })
  ) {
    return ctx.setup.result;
  }
  if (!(await handleStaleExistingConnector(ctx.setup))) return ctx.setup.result;
  await createNewConnector(ctx.setup);
  return ctx.setup.result;
};

const executeConnectorSetup = async (
  ctx: ConnectorSetupContext,
): Promise<ConnectorSetupContext["result"]> => {
  await openChatGptSettings(ctx);
  await openAppsOrConnectorsPanel(ctx);
  const hasCurrentConnector = await cleanupDuplicateConnectorApps(ctx);
  return runConnectorSetupSteps({ setup: ctx, hasCurrentConnector });
};

type FillConnectorUrlFieldContext = {
  setup: ConnectorSetupContext;
};

const fillConnectorUrlField = async (ctx: FillConnectorUrlFieldContext): Promise<boolean> => {
  const filledUrl = await fillFirstVisible({
    page: ctx.setup.page,
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
    value: ctx.setup.connectorUrl,
  });
  if (filledUrl) ctx.setup.result.steps.push(`Filled connector URL: ${ctx.setup.connectorUrl}`);
  return filledUrl;
};

type FillConnectorNameFieldContext = {
  setup: ConnectorSetupContext;
};

const fillConnectorNameField = async (ctx: FillConnectorNameFieldContext): Promise<void> => {
  const filledName = await fillFirstVisible({
    page: ctx.setup.page,
    selectors: [
      'input[name="custom-connector-name"]',
      "#custom-connector-name",
      'input[name*="name" i]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
    ],
    value: ctx.setup.connectorName,
  });
  if (filledName) ctx.setup.result.steps.push(`Filled connector name: ${ctx.setup.connectorName}`);
};

const fillConnectorFormFields = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (!(await fillConnectorUrlField({ setup: ctx }))) return false;
  await fillConnectorNameField({ setup: ctx });
  return true;
};

const finalizeCurrentConnector = async (ctx: ConnectorSetupContext): Promise<void> => {
  ctx.result.completed = true;
  ctx.result.steps.push("Existing connector already uses the current URL.");
  if (await refreshOpenConnectorIfPresent(ctx)) {
    ctx.result.steps.push("Refreshed the connector tool schema.");
  }
  await selectConnectorAfterSetup(ctx);
};

type FindBridgeConnectorButtonsContext = {
  page: Page;
};

const findBridgeConnectorButtons = async (
  ctx: FindBridgeConnectorButtonsContext,
): Promise<Array<{ button: Locator; name: string }>> => {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  const entries: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label.startsWith(BRIDGE_CONNECTOR_PREFIX)) {
      entries.push({ button, name: label });
    }
  }
  return entries;
};

type FindConnectorButtonContext = {
  page: Page;
  connectorName: string;
};

const findConnectorButton = async (ctx: FindConnectorButtonContext): Promise<Locator | null> => {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label === ctx.connectorName) return button;
  }
  return null;
};

type WaitForConnectorButtonContext = {
  page: Page;
  connectorName: string;
  timeoutMs: number;
};

const waitForConnectorButton = async (ctx: WaitForConnectorButtonContext): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeoutMs) {
    const button = await findConnectorButton({ page: ctx.page, connectorName: ctx.connectorName });
    if (button && (await button.isVisible().catch(() => false))) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
};

type RecordConnectorFormOptionsContext = {
  setup: ConnectorSetupContext;
};

const recordConnectorFormOptions = async (
  ctx: RecordConnectorFormOptionsContext,
): Promise<void> => {
  if (await selectNoAuthenticationIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Selected no-authentication option when visible.");
  }
  if (await acceptCustomMcpRiskIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Accepted custom MCP server risk notice.");
  }
};

type FinishConnectorCreationContext = {
  setup: ConnectorSetupContext;
};

const finishConnectorCreation = async (ctx: FinishConnectorCreationContext): Promise<void> => {
  await recordConnectorFormOptions({ setup: ctx.setup });
  await submitConnectorForm(ctx.setup);
  if (ctx.setup.options.automatic && !ctx.setup.result.completed) {
    await restoreAfterConnectorSetup(ctx.setup);
  }
};

const handleStaleExistingConnector = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(ctx);
  if (existing === "stale") return deleteStaleConnector(ctx);
  if (existing === "unknown") {
    ctx.result.warnings.push(
      "Existing connector was found, but its URL could not be read from the settings panel.",
    );
  }
  return true;
};

const deleteStaleConnector = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (await deleteOpenConnectorIfPresent({ page: ctx.page })) {
    ctx.result.steps.push(
      "Deleted stale connector app before recreating it with the new tunnel URL.",
    );
    await returnToConnectorListIfNeeded(ctx);
    await openAppsOrConnectorsPanel(ctx);
    await openAdvancedSettingsIfPresent(ctx);
    return true;
  }
  ctx.result.warnings.push(
    "Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.",
  );
  if (ctx.options.automatic) await restoreAfterConnectorSetup(ctx);
  return false;
};

type HoverAndClickMoreMenuItemContext = {
  setup: ConnectorSetupContext;
};

const hoverAndClickMoreMenuItem = async (
  ctx: HoverAndClickMoreMenuItemContext,
): Promise<boolean> => {
  const moreItem = await firstVisible({
    page: ctx.setup.page,
    selectors: [
      '[role="menuitem"][aria-haspopup="menu"]:has-text("More")',
      '[role="menuitem"]:has-text("More")',
    ],
  });
  if (!moreItem) return false;
  await clickMoreMenuItem({ moreItem, setup: ctx.setup });
  return true;
};

type InitConnectorSetupContextInput = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupOptions;
};

const initConnectorSetupContext = (
  input: InitConnectorSetupContextInput,
): ConnectorSetupContext => {
  const connectorName =
    input.options.connectorName === undefined
      ? DEFAULT_CONNECTOR_NAME
      : input.options.connectorName;
  const returnUrl = chatGptReturnUrl({ url: input.page.url() });
  return {
    page: input.page,
    connectorUrl: input.connectorUrl,
    options: input.options,
    connectorName,
    returnUrl,
    result: {
      connectorUrl: input.connectorUrl,
      completed: false,
      steps: [],
      warnings: [],
    },
  };
};

type CollectConnectorSummariesContext = {
  page: Page;
  entryCount: number;
};

const collectConnectorSummaries = async (
  ctx: CollectConnectorSummariesContext,
): Promise<ConnectorAppSummary[]> => {
  const summaries: ConnectorAppSummary[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < ctx.entryCount; index += 1) {
    appendUniqueSummary({
      summaries,
      seen,
      summary: await readConnectorSummaryAtIndex({ page: ctx.page, index }),
    });
  }
  return summaries;
};

type ListBridgeConnectorSummariesContext = {
  page: Page;
};

const listBridgeConnectorSummaries = async (
  ctx: ListBridgeConnectorSummariesContext,
): Promise<ConnectorAppSummary[]> => {
  await openConnectorList({ page: ctx.page });
  const entryCount = (await findBridgeConnectorButtons({ page: ctx.page })).length;
  const summaries = await collectConnectorSummaries({ page: ctx.page, entryCount });
  await openConnectorList({ page: ctx.page });
  return summaries;
};

const openAdvancedSettingsIfPresent = async (ctx: ConnectorSetupContext): Promise<void> => {
  const opened = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Advanced settings")',
      'button:has-text("Advanced Settings")',
      'a:has-text("Advanced settings")',
      '[role="tab"]:has-text("Advanced")',
      'button:has-text("Advanced")',
    ],
    timeout: 1_500,
  });
  if (opened) ctx.result.steps.push("Opened Advanced settings.");
};

const openAppsOrConnectorsPanel = async (ctx: ConnectorSetupContext): Promise<void> => {
  const opened = await clickFirstVisible({
    page: ctx.page,
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
    ctx.result.steps.push("Opened Apps/Connectors settings.");
  } else {
    ctx.result.warnings.push(
      "Could not find Apps/Connectors in settings. Use Settings -> Apps manually.",
    );
  }
};

const openChatGptSettings = async (ctx: ConnectorSetupContext): Promise<void> => {
  await ctx.page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await ctx.page.waitForTimeout(1_500);
  const settingsDialogOpen = await ctx.page
    .locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")')
    .first()
    .isVisible()
    .catch(() => false);
  if (settingsDialogOpen) {
    ctx.result.steps.push("Opened ChatGPT settings.");
    return;
  }
  await openSettingsFromAccountMenu(ctx);
};

type OpenComposerPlusMenuContext = {
  setup: ConnectorSetupContext;
};

const openComposerPlusMenu = async (ctx: OpenComposerPlusMenuContext): Promise<boolean> => {
  const plusButton = await firstVisible({
    page: ctx.setup.page,
    selectors: [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files" i]',
    ],
  });
  if (!plusButton) return false;
  await plusButton.click({ timeout: 5_000, force: true });
  await ctx.setup.page.waitForTimeout(750);
  return true;
};

const openComposerConnectorMenu = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  if (!(await openComposerPlusMenu({ setup: ctx }))) return false;
  if (await clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName }))
    return true;
  return clickConnectorFromMoreMenu(ctx);
};

type OpenConnectorDetailsPanelContext = {
  setup: ConnectorSetupContext;
};

const openConnectorDetailsPanel = async (
  ctx: OpenConnectorDetailsPanelContext,
): Promise<boolean> => {
  const button = await findConnectorButton({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
  });
  if (!button) return false;
  await clickConnectorDetailsButton({ button, setup: ctx.setup });
  return true;
};

type OpenConnectorListContext = {
  page: Page;
};

const openConnectorList = async (ctx: OpenConnectorListContext): Promise<void> => {
  await ctx.page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await ctx.page.waitForTimeout(1_000);
  const backButton = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
};

const openCreateConnectorForm = async (ctx: ConnectorSetupContext): Promise<void> => {
  const opened = await clickFirstVisible({
    page: ctx.page,
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
    ctx.result.steps.push("Opened connector/app creation form.");
  } else {
    ctx.result.warnings.push(
      "Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.",
    );
  }
};

type ReadConnectorStateContext = {
  setup: ConnectorSetupContext;
};

const readConnectorState = (ctx: ReadConnectorStateContext) => {
  return readOpenConnectorState({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    connectorUrl: ctx.setup.connectorUrl,
  });
};

const openExistingConnectorDetails = async (
  ctx: ConnectorSetupContext,
): Promise<ExistingConnectorState> => {
  const alreadyOpen = await readConnectorState({ setup: ctx });
  if (alreadyOpen !== "missing") return alreadyOpen;
  if (!(await openConnectorDetailsPanel({ setup: ctx }))) return "missing";
  return readConnectorState({ setup: ctx });
};

const openSettingsFromAccountMenu = async (ctx: ConnectorSetupContext): Promise<void> => {
  await ctx.page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
  if (
    !(await clickFirstVisible({
      page: ctx.page,
      selectors: SELECTORS.accountMenuButton,
      timeout: 2_000,
    }))
  ) {
    ctx.result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }
  ctx.result.steps.push("Opened ChatGPT account menu.");
  await clickSettingsEntry({ setup: ctx });
};

type ReadConnectorSummaryAtIndexContext = {
  page: Page;
  index: number;
};

const readConnectorSummaryAtIndex = async (ctx: ReadConnectorSummaryAtIndexContext) => {
  if (!(await clickConnectorListEntry({ page: ctx.page, index: ctx.index }))) return null;
  return readOpenConnectorSummary({ page: ctx.page });
};

type ReadOpenConnectorStateContext = {
  page: Page;
  connectorName: string;
  connectorUrl: string;
};

const readOpenConnectorState = async (
  ctx: ReadOpenConnectorStateContext,
): Promise<ExistingConnectorState> => {
  const text = await settingsDialogText({ page: ctx.page });
  if (!text.includes(ctx.connectorName) || !/\b(URL|App Id|Version Id)\b/i.test(text))
    return "missing";
  if (text.includes(ctx.connectorUrl)) return "current";
  if (/\bURL\s+https?:\/\//i.test(text)) return "stale";
  return "unknown";
};

type ParseConnectorSummaryLinesContext = {
  lines: string[];
};

const parseConnectorSummaryLines = (
  ctx: ParseConnectorSummaryLinesContext,
): ConnectorAppSummary | null => {
  const backIndex = ctx.lines.indexOf("Back");
  let name = "";
  if (backIndex >= 0) {
    const nextLine = ctx.lines[backIndex + 1];
    name = nextLine === undefined ? "" : nextLine;
  }
  if (!name.startsWith(BRIDGE_CONNECTOR_PREFIX)) return null;
  return {
    name,
    appId: valueAfterLine({ lines: ctx.lines, label: "App Id" }),
    url: valueAfterLine({ lines: ctx.lines, label: "URL" }),
  };
};

type ReadOpenConnectorSummaryContext = {
  page: Page;
};

const readOpenConnectorSummary = async (
  ctx: ReadOpenConnectorSummaryContext,
): Promise<ConnectorAppSummary | null> => {
  const text = await ctx.page
    .locator('[role="dialog"]')
    .last()
    .innerText()
    .catch(() => "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return parseConnectorSummaryLines({ lines });
};

const refreshOpenConnectorIfPresent = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  return clickFirstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: 1_000,
  });
};

const restoreAfterConnectorSetup = async (ctx: ConnectorSetupContext): Promise<void> => {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
};

const restoreReturnUrlIfNeeded = async (ctx: ConnectorSetupContext): Promise<void> => {
  if (ctx.returnUrl && chatGptReturnUrl({ url: ctx.page.url() }) !== ctx.returnUrl) {
    await ctx.page.goto(ctx.returnUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
};

const returnToConnectorListIfNeeded = async (ctx: ConnectorSetupContext): Promise<void> => {
  const back = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
};

const selectConnectorAfterSetup = async (ctx: ConnectorSetupContext): Promise<void> => {
  const selectedInComposer = await selectConnectorInComposer(ctx);
  if (selectedInComposer) {
    ctx.result.steps.push("Selected the connector in the composer.");
  } else {
    ctx.result.warnings.push(
      "Connector is configured, but the composer menu did not expose it for automatic selection.",
    );
  }
};

const selectConnectorInComposer = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
  await ctx.page.keyboard.press("Escape").catch(() => {});
  return ensureComposerConnectorSelected(ctx);
};

const selectNoAuthenticationIfPresent = async (ctx: ConnectorSetupContext): Promise<boolean> => {
  const authSelect = ctx.page.locator("select#custom-connector-auth").first();
  if ((await authSelect.count()) > 0 && (await authSelect.isVisible().catch(() => false))) {
    await authSelect.selectOption("NONE");
    await authSelect.dispatchEvent("change").catch(() => {});
    return true;
  }
  return clickFirstVisible({
    page: ctx.page,
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

type SettingsDialogTextContext = {
  page: Page;
};

const settingsDialogText = async (ctx: SettingsDialogTextContext): Promise<string> => {
  return normalizeDisplayText({
    value: await ctx.page
      .locator('[role="dialog"]')
      .last()
      .innerText()
      .catch(() => ""),
  });
};

const setupMcpConnectorInChatGpt = async (
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  return executeConnectorSetup(initConnectorSetupContext({ page, connectorUrl, options }));
};

type ConnectorFormStillOpenContext = {
  setup: ConnectorSetupContext;
};

const connectorFormStillOpen = async (ctx: ConnectorFormStillOpenContext): Promise<boolean> => {
  return ctx.setup.page
    .locator('input[name="custom-connector-url"], #custom-connector-url')
    .first()
    .isVisible()
    .catch(() => false);
};

type MarkConnectorSubmitCompletedContext = {
  setup: ConnectorSetupContext;
};

const markConnectorSubmitCompleted = async (
  ctx: MarkConnectorSubmitCompletedContext,
): Promise<void> => {
  ctx.setup.result.completed = true;
  ctx.setup.result.steps.push("Submitted the connector form.");
  await selectConnectorAfterSetup(ctx.setup);
};

type WarnConnectorSubmitIncompleteContext = {
  setup: ConnectorSetupContext;
};

const warnConnectorSubmitIncomplete = async (
  ctx: WarnConnectorSubmitIncompleteContext,
): Promise<void> => {
  const appVisible = await waitForConnectorButton({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    timeoutMs: 20_000,
  });
  const formStillOpen = await connectorFormStillOpen({ setup: ctx.setup });
  if (formStillOpen && !appVisible) {
    ctx.setup.result.warnings.push(
      "Connector form is still open after submit. Check the visible validation message in ChatGPT settings.",
    );
    return;
  }
  await markConnectorSubmitCompleted({ setup: ctx.setup });
};

const submitConnectorForm = async (ctx: ConnectorSetupContext): Promise<void> => {
  const submitted = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Create")',
      'button:has-text("Save")',
      'button:has-text("Add")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
  });
  if (!submitted) {
    ctx.result.warnings.push(
      "Connector form was filled, but no Create/Save/Add button was visible or enabled.",
    );
    return;
  }
  await warnConnectorSubmitIncomplete({ setup: ctx });
};

type FinalizeIfCurrentConnectorContext = {
  setup: ConnectorSetupContext;
};

const finalizeIfCurrentConnector = async (
  ctx: FinalizeIfCurrentConnectorContext,
): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(ctx.setup);
  if (existing !== "current") return false;
  await finalizeCurrentConnector(ctx.setup);
  return true;
};

type TryFinalizeExistingConnectorContext = {
  setup: ConnectorSetupContext;
  hasCurrentConnector: boolean;
};

const tryFinalizeExistingConnector = async (
  ctx: TryFinalizeExistingConnectorContext,
): Promise<boolean> => {
  if (ctx.hasCurrentConnector && (await finalizeIfCurrentConnector({ setup: ctx.setup })))
    return true;
  return finalizeIfCurrentConnector({ setup: ctx.setup });
};

const captureAllMessages = async (
  page: Page,
  options: CaptureMessagesOptions = {},
): Promise<Array<{ role: string; content: string }>> => {
  return extractAllMessages(page, {
    conversationId: conversationIdFromPage({ page }),
    manifestRoot: options.manifestRoot,
  });
};

const sanitizeCapturedText = (value: string): string => {
  return value
    .replace(/\s*\[object Object\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const captureLastResponse = async (
  page: Page,
  options: CaptureMessagesOptions = {},
): Promise<string> => {
  const { text } = await extractAssistantContent(page, {
    conversationId: conversationIdFromPage({ page }),
    manifestRoot: options.manifestRoot,
  });
  const cleaned = sanitizeCapturedText(text);
  if (cleaned && !/\[object Object\]/.test(text)) return cleaned;
  const fallback = await page
    .locator(SELECTORS.lastResponse)
    .last()
    .innerText()
    .catch(() => "");
  return sanitizeCapturedText(fallback) || cleaned;
};

type ConversationIdFromPageContext = {
  page: Page;
};

const conversationIdFromPage = (ctx: ConversationIdFromPageContext): string => {
  const conversationId = chatGptConversationIdFromUrl(ctx.page.url());
  if (conversationId === null) return "current";
  return conversationId;
};

const countAssistantResponses = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

const waitForGenerationIdle = async (page: Page, timeoutMs?: number): Promise<void> => {
  await waitForResponseIdle(page, SELECTORS.streamingIndicator, timeoutMs);
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  const targetUrl = chatGptConversationUrlFromIdOrUrl(url);
  if (isSameChatGptConversation(page.url(), targetUrl)) {
    await page
      .waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 })
      .catch(() => {});
    return;
  }
  await waitForGenerationIdle(page);
  await page.goto(targetUrl);
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
};

const newConversation = async (page: Page): Promise<void> => {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
};

type SidebarConversationEntry = {
  id: string;
  title: string;
  url: string;
};

type ParseSidebarLinkContext = {
  link: Locator;
  orphans: boolean;
};

type SidebarConversationLink = {
  href: string | null;
  title: string;
  ariaLabel: string | null;
};

type SidebarScanElement = HTMLElement & {
  __bridgeOrphanScan?: {
    originalScrollTop: number;
    links: Map<string, SidebarConversationLink>;
  };
};

export const parseChatGptSidebarConversationLink = (
  link: SidebarConversationLink,
  options: { readonly orphans?: boolean } = {},
): SidebarConversationEntry | null => {
  const href = link.href?.trim();
  const title = link.title.trim();
  if (!href || !title) return null;
  const sidebarLabel = link.ariaLabel ?? "";
  const outsideLooseChats =
    href.includes("/g/") ||
    /\bchat in project\b/i.test(sidebarLabel) ||
    /\bpinned conversation\b/i.test(sidebarLabel);
  if (options.orphans && outsideLooseChats) return null;
  const parsedUrl = new URL(href, "https://chatgpt.com");
  const id = parsedUrl.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!id) return null;
  return { id, title, url: parsedUrl.toString() };
};

const parseSidebarLink = async (
  ctx: ParseSidebarLinkContext,
): Promise<SidebarConversationEntry | null> => {
  const href = await ctx.link.getAttribute("href");
  const title = await ctx.link.innerText();
  const ariaLabel = await ctx.link.getAttribute("aria-label");
  return parseChatGptSidebarConversationLink({ href, title, ariaLabel }, { orphans: ctx.orphans });
};

const scanOrphanSidebarConversations = async (page: Page): Promise<SidebarConversationEntry[]> => {
  await page
    .locator(`${SELECTORS.sidebarConversation}:not([aria-label*="pinned conversation" i])`)
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => {});
  const sidebar = page.locator('nav[aria-label="Chat history"]').first();
  if ((await sidebar.count()) === 0) return [];
  const collectScrollAndReadState = (element: SidebarScanElement) => {
    const scan = element.__bridgeOrphanScan;
    if (!scan) throw new Error("ChatGPT sidebar scan was not initialized.");
    const sidebarRect = element.getBoundingClientRect();
    for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href^="/c/"]')) {
      const linkRect = link.getBoundingClientRect();
      if (linkRect.bottom < sidebarRect.top || linkRect.top > sidebarRect.bottom) continue;
      const href = link.getAttribute("href");
      if (!href) continue;
      scan.links.set(href, {
        href,
        title: link.innerText || link.textContent || "",
        ariaLabel: link.getAttribute("aria-label"),
      });
    }
    const state = {
      size: scan.links.size,
      scrollHeight: element.scrollHeight,
      atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 4,
    };
    const step = Math.max(Math.floor(element.clientHeight * 0.8), 320);
    element.scrollTop = Math.min(element.scrollTop + step, element.scrollHeight);
    return state;
  };
  await sidebar.evaluate((element: SidebarScanElement) => {
    element.__bridgeOrphanScan = {
      originalScrollTop: element.scrollTop,
      links: new Map(),
    };
    element.scrollTop = 0;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  let stableBottomPasses = 0;
  let links: SidebarConversationLink[] = [];
  try {
    let before = await sidebar.evaluate(collectScrollAndReadState);
    for (let pass = 0; pass < 240; pass += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const after = await sidebar.evaluate(collectScrollAndReadState);
      const unchanged =
        after.atBottom &&
        after.size === before.size &&
        after.scrollHeight <= before.scrollHeight + 1;
      stableBottomPasses = unchanged ? stableBottomPasses + 1 : 0;
      if (stableBottomPasses >= 8) break;
      before = after;
    }
    links = await sidebar.evaluate((element: SidebarScanElement) => {
      const scan = element.__bridgeOrphanScan;
      return scan ? [...scan.links.values()] : [];
    });
  } finally {
    await sidebar
      .evaluate((element: SidebarScanElement) => {
        const scan = element.__bridgeOrphanScan;
        if (scan) element.scrollTop = scan.originalScrollTop;
        delete element.__bridgeOrphanScan;
      })
      .catch(() => {});
  }
  const conversations = new Map<string, SidebarConversationEntry>();
  for (const link of links) {
    const conversation = parseChatGptSidebarConversationLink(link, { orphans: true });
    if (conversation) conversations.set(conversation.id, conversation);
  }
  return [...conversations.values()];
};

const readAllOrphanSidebarConversations = async (
  page: Page,
): Promise<SidebarConversationEntry[]> => {
  const scanPage = await page.context().newPage();
  try {
    await scanPage.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
    return await scanOrphanSidebarConversations(scanPage);
  } finally {
    await scanPage.close().catch(() => {});
  }
};

const readSidebarConversations = async (
  page: Page,
  options: { readonly orphans?: boolean } = {},
): Promise<Array<{ id: string; title: string; url: string }>> => {
  if (options.orphans) return readAllOrphanSidebarConversations(page);
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const entry = await parseSidebarLink({ link, orphans: Boolean(options.orphans) });
    if (entry) conversations.push(entry);
  }
  return conversations;
};

type ClickFirstVisibleContext = {
  page: Page;
  selectors: readonly string[];
  timeout?: number;
};

const clickFirstVisible = async (ctx: ClickFirstVisibleContext): Promise<boolean> => {
  const timeout = ctx.timeout === undefined ? 1_000 : ctx.timeout;
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout }).catch(() => {});
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
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

type FillFirstVisibleContext = {
  page: import("playwright").Page;
  selectors: readonly string[];
  value: string;
};

type FillVisibleFieldContext = {
  field: Locator;
  value: string;
};

const fillVisibleField = async (ctx: FillVisibleFieldContext): Promise<void> => {
  await ctx.field.fill(ctx.value);
  await ctx.field.dispatchEvent("input").catch(() => {});
  await ctx.field.dispatchEvent("change").catch(() => {});
};

const fillFirstVisible = async (ctx: FillFirstVisibleContext): Promise<boolean> => {
  const field = await firstVisible({ page: ctx.page, selectors: ctx.selectors });
  if (!field) return false;
  await fillVisibleField({ field, value: ctx.value });
  return true;
};

type FirstVisibleInContext = {
  parent: Locator;
  selectors: readonly string[];
};

const firstVisibleIn = async (ctx: FirstVisibleInContext): Promise<Locator | null> => {
  for (const selector of ctx.selectors) {
    const locator = ctx.parent.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
};

type FirstVisibleContext = {
  page: Page;
  selectors: readonly string[];
};

const firstVisible = async (ctx: FirstVisibleContext): Promise<Locator | null> => {
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
};

type NormalizeDisplayTextContext = {
  value: string;
};

const normalizeDisplayText = (ctx: NormalizeDisplayTextContext): string => {
  return ctx.value
    .replace(/\s+/g, " ")
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
};

type NormalizeModelQueryContext = {
  value: string;
};

const normalizeModelQuery = (ctx: NormalizeModelQueryContext): string => {
  return ctx.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

type ClickModelAndDetectContext = {
  page: Page;
  item: Locator;
};

const clickModelAndDetect = async (ctx: ClickModelAndDetectContext): Promise<string> => {
  await ctx.item.click();
  await ctx.page
    .locator(SELECTORS.openMenu)
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await ctx.page.waitForTimeout(500);
  return detectCurrentModel(ctx.page);
};

type CollectModelsFromItemsContext = {
  items: Locator[];
};

const collectModelsFromItems = async (
  ctx: CollectModelsFromItemsContext,
): Promise<ModelOption[]> => {
  const models: ModelOption[] = [];
  for (const item of ctx.items) {
    const option = await parseModelMenuItem({ item });
    if (option && !models.some((model) => model.id === option.id && model.label === option.label)) {
      models.push(option);
    }
  }
  return models;
};

type CloseModelMenuContext = {
  page: Page;
};

const closeModelMenu = async (ctx: CloseModelMenuContext): Promise<void> => {
  await ctx.page.keyboard.press("Escape").catch(() => {});
};

type DetectCheckedModelFromMenuOnceContext = {
  page: Page;
};

const detectCheckedModelFromMenuOnce = async (
  ctx: DetectCheckedModelFromMenuOnceContext,
): Promise<string | null> => {
  try {
    await openModelMenu({ page: ctx.page });
    const checkedModel = await readCheckedModelFromOpenMenu({ page: ctx.page });
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return checkedModel;
  } catch {
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return null;
  }
};

type DetectCheckedModelFromMenuContext = {
  page: Page;
};

const detectCheckedModelFromMenu = async (
  ctx: DetectCheckedModelFromMenuContext,
): Promise<string | null> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: ctx.page });
    if (checkedModel) return checkedModel;
    await ctx.page.waitForTimeout(750);
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
    if (fromMenu === null || fromMenu === undefined) return "ChatGPT";
    return fromMenu;
  } catch {
    return "ChatGPT";
  }
};

type FindModelMenuMatchContext = {
  page: Page;
  normalizedQuery: string;
};

const findModelMenuMatch = async (ctx: FindModelMenuMatchContext): Promise<Locator | null> => {
  const items = await modelMenuItems(ctx.page);
  let fallback: Locator | null = null;
  for (const item of items) {
    const match = await modelItemMatchesQuery({ item, normalizedQuery: ctx.normalizedQuery });
    if (match.matched) return item;
    if (!fallback && match.fallback) fallback = match.fallback;
  }
  return fallback;
};

const isLikelyModelLabel = (value: string): boolean => {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(value);
};

type IsSelectedModelItemContext = {
  item: Locator;
};

const isSelectedModelItem = async (ctx: IsSelectedModelItemContext): Promise<boolean> => {
  const ariaChecked = await ctx.item.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  const dataState = await ctx.item.getAttribute("data-state").catch(() => null);
  return dataState === "checked";
};

const listAvailableModels = async (page: Page) => {
  await openModelMenu({ page });
  const items = await modelMenuItems(page);
  const models = await collectModelsFromItems({ items });
  await closeModelMenu({ page });
  return models;
};

type ModelItemMatchesQueryContext = {
  item: Locator;
  normalizedQuery: string;
};

type ModelItemMatchResult = {
  matched: boolean;
  fallback: Locator | null;
};

type ModelItemMatchInput = {
  item: Locator;
  label: string;
  normalizedQuery: string;
  searchable: string;
};

const modelItemMatch = (ctx: ModelItemMatchInput): ModelItemMatchResult => {
  if (ctx.searchable === ctx.normalizedQuery || ctx.searchable.includes(ctx.normalizedQuery)) {
    return { matched: true, fallback: null };
  }
  const fallback = ctx.normalizedQuery.includes(normalizeModelQuery({ value: ctx.label }))
    ? ctx.item
    : null;
  return { matched: false, fallback };
};

const modelItemMatchesQuery = async (
  ctx: ModelItemMatchesQueryContext,
): Promise<ModelItemMatchResult> => {
  const label = await readModelItemLabel({ item: ctx.item });
  const id = await readModelItemId({ item: ctx.item });
  const searchable = normalizeModelQuery({ value: `${label} ${id}` });
  if (!label || !isLikelyModelLabel(label)) return { matched: false, fallback: null };
  return modelItemMatch({
    item: ctx.item,
    label,
    normalizedQuery: ctx.normalizedQuery,
    searchable,
  });
};

const modelMenuItems = async (page: Page): Promise<Locator[]> => {
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

type ClickModelTriggerContext = {
  trigger: NonNullable<Awaited<ReturnType<typeof firstVisible>>>;
};

const clickModelTrigger = async (ctx: ClickModelTriggerContext): Promise<void> => {
  try {
    await ctx.trigger.click({ timeout: 5_000 });
  } catch {
    await ctx.trigger.click({ timeout: 5_000, force: true });
  }
};

type OpenModelMenuContext = {
  page: Page;
};

const openModelMenu = async (ctx: OpenModelMenuContext): Promise<void> => {
  await ctx.page
    .locator(SELECTORS.modelTrigger.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Could not find ChatGPT model switcher button.");
  await clickModelTrigger({ trigger });
  await ctx.page.locator(SELECTORS.openMenu).first().waitFor({ state: "visible", timeout: 5_000 });
};

type ParseModelMenuItemContext = {
  item: Locator;
};

const parseModelMenuItem = async (ctx: ParseModelMenuItemContext): Promise<ModelOption | null> => {
  const label = await readModelItemLabel({ item: ctx.item });
  if (!label || !isLikelyModelLabel(label)) return null;
  const id = await readModelItemId({ item: ctx.item });
  const selected = await isSelectedModelItem({ item: ctx.item });
  return { id, label, selected };
};

type ReadCheckedModelFromDomContext = {
  page: Page;
};

const readCheckedModelFromDom = async (
  ctx: ReadCheckedModelFromDomContext,
): Promise<string | null> => {
  const checked = ctx.page.locator('[data-testid^="model-switcher-"][aria-checked="true"]').first();
  if ((await checked.count()) > 0) {
    return readModelItemLabel({ item: checked });
  }
  return null;
};

type ReadCheckedModelFromOpenMenuContext = {
  page: Page;
};

const readCheckedModelFromOpenMenu = async (
  ctx: ReadCheckedModelFromOpenMenuContext,
): Promise<string | null> => {
  const items = await modelMenuItems(ctx.page);
  for (const item of items) {
    if (await isSelectedModelItem({ item })) {
      const label = await readModelItemLabel({ item });
      if (label) return label;
    }
  }
  return null;
};

type ReadLikelyAriaModelLabelContext = {
  trigger: Locator;
};

const readLikelyAriaModelLabel = async (
  ctx: ReadLikelyAriaModelLabelContext,
): Promise<string | null> => {
  const ariaLabel = await ctx.trigger.getAttribute("aria-label").catch(() => null);
  return ariaLabel && isLikelyModelLabel(ariaLabel) ? ariaLabel.trim() : null;
};

type ReadLikelyModelLineContext = {
  text: string;
};

const readLikelyModelLine = (ctx: ReadLikelyModelLineContext): string | null => {
  const modelLine = ctx.text.split("\n").find((part) => isLikelyModelLabel(part));
  if (modelLine === undefined) return null;
  return modelLine;
};

type ReadModelFromTriggerContext = {
  page: Page;
};

const readModelFromTrigger = async (ctx: ReadModelFromTriggerContext): Promise<string | null> => {
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) return null;
  const line = readLikelyModelLine({
    text: normalizeDisplayText({ value: await trigger.innerText().catch(() => "") }),
  });
  if (line) return line;
  return readLikelyAriaModelLabel({ trigger });
};

type ReadModelItemIdContext = {
  item: Locator;
};

const readModelItemId = async (ctx: ReadModelItemIdContext): Promise<string> => {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) return testId.replace("model-switcher-", "");
  const label = await readModelItemLabel({ item: ctx.item });
  return normalizeModelQuery({ value: label }).replace(/\s+/g, "-");
};

type ReadModelItemLabelContext = {
  item: Locator;
};

const readModelItemLabel = async (ctx: ReadModelItemLabelContext): Promise<string> => {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }
  return normalizeDisplayText({ value: await ctx.item.innerText().catch(() => "") });
};

type SelectModelOrThrowContext = {
  page: Page;
  query: string;
  normalizedQuery: string;
};

const selectModelOrThrow = async (ctx: SelectModelOrThrowContext): Promise<string> => {
  await openModelMenu({ page: ctx.page });
  const match = await findModelMenuMatch({ page: ctx.page, normalizedQuery: ctx.normalizedQuery });
  if (match) return clickModelAndDetect({ page: ctx.page, item: match });
  await closeModelMenu({ page: ctx.page });
  throw new Error(`No model matched "${ctx.query}". Run /model to list available browser models.`);
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const normalizedQuery = normalizeModelQuery({ value: query });
  if (!normalizedQuery) throw new Error("Model name is required.");
  return selectModelOrThrow({ page, query, normalizedQuery });
};

type ClickSendButtonContext = {
  page: Page;
};

const clickSendButton = async (ctx: ClickSendButtonContext): Promise<void> => {
  const sendBtn = ctx.page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
    return;
  } catch {
    // Send button never surfaced within the window; fall through to the Enter fallback.
  }
  // While a response streams, the send slot is the stop button — pressing Enter there would
  // either no-op or interrupt the stream, so skip the fallback until the conversation is idle.
  if (await isStreamingVisible({ page: ctx.page })) return;
  await ctx.page.keyboard.press("Enter");
};

type ComposerClearsOnceContext = {
  page: Page;
};

const composerClearsOnce = async (ctx: ComposerClearsOnceContext): Promise<boolean> => {
  const composerText = await readComposerText({ page: ctx.page });
  return composerText === "";
};

type ComposerClearsContext = {
  page: Page;
};

const composerClears = async (ctx: ComposerClearsContext): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if (await composerClearsOnce({ page: ctx.page })) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
};

export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => {});
  await runInjectPromptAttempts({ page, text });
};

type ReadComposerTextContext = {
  page: Page;
};

export const readComposerText = async (ctx: ReadComposerTextContext): Promise<string> => {
  const text = await ctx.page.evaluate(() => {
    const prompt = document.querySelector<HTMLElement>("#prompt-textarea");
    if (prompt === null || prompt.innerText === undefined) return "";
    return prompt.innerText.trim();
  });
  if (text === null || text === undefined) return "";
  return text;
};

type RunInjectPromptAttemptsContext = {
  page: Page;
  text: string;
};

const runInjectPromptAttempts = async (ctx: RunInjectPromptAttemptsContext): Promise<void> => {
  const input = ctx.page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Never type or send into a busy conversation — wait out any in-flight response first.
    await waitForGenerationIdle(ctx.page);
    if (await submitPromptAttempt({ page: ctx.page, input, text: ctx.text })) return;
    // The attempt may have started a response even if the composer was slow to empty; an
    // active stream means the prompt landed, so stop rather than re-sending on top of it.
    if (await isStreamingVisible({ page: ctx.page })) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

type SubmitPromptAttemptContext = {
  page: Page;
  input: Locator;
  text: string;
};

const submitPromptAttempt = async (ctx: SubmitPromptAttemptContext): Promise<boolean> => {
  await ctx.input.click();
  await ctx.input.fill(ctx.text);
  await ctx.input.dispatchEvent("input");
  await clickSendButton({ page: ctx.page });
  return composerClears({ page: ctx.page });
};

type IsTransientAssistantTextContext = {
  text: string;
};

const isTransientAssistantText = (ctx: IsTransientAssistantTextContext): boolean => {
  const normalized = ctx.text.trim().toLowerCase();
  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized) ||
    /^thought for\b/.test(normalized) ||
    normalized.startsWith("thought for ")
  );
};

export const isTurnSettled = (state: TurnSettledState): boolean => {
  if (state.streaming) return false;
  if (state.pendingAssetCount > 0) return false;
  const targetImageCount = Math.max(state.expectImages, state.expectedImageMarkerCount);
  const awaitingImages = targetImageCount > 0 || state.sawImageActivity || state.assetCount > 0;

  // An image turn must also see the image network fall quiet: every tile that lands resets
  // msSinceImageActivity, so a turn streaming several images never settles between them.
  if (awaitingImages && state.msSinceImageActivity < ASSET_SETTLE_QUIET_MS) return false;

  // Fewer tiles have loaded than were requested (via --images) or announced (via [image-N]
  // markers): keep waiting, unless generation has clearly stalled — then settle with what
  // loaded so a short generation never hangs to the full timeout.
  if (targetImageCount > 0 && state.loadedAssetCount < targetImageCount) {
    return state.stableForMs >= IMAGE_STALL_QUIET_MS;
  }
  const requiredQuietMs = awaitingImages ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;
  if (state.stableForMs < requiredQuietMs) return false;
  if (state.loadedAssetCount > 0) return true;
  if (targetImageCount > 0) return false;
  return state.hasText && !state.isTransientText;
};

type RemainingTimeoutContext = {
  startedAt: number;
  timeout: number;
};

const remainingTimeout = (ctx: RemainingTimeoutContext): number => {
  return Math.max(1_000, ctx.timeout - (Date.now() - ctx.startedAt));
};

type ResponseStartedAfterBaselineContext = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

const responseStartedAfterBaseline = async (
  ctx: ResponseStartedAfterBaselineContext,
): Promise<boolean> => {
  if (await isStreamingVisible({ page: ctx.page })) return true;
  const count = await ctx.page.locator(SELECTORS.responseBlock).count();
  if (ctx.previousAssistantCount !== undefined && count > ctx.previousAssistantCount) return true;
  const lastText = await readNormalizedLastResponse({ page: ctx.page });
  return (
    !!ctx.previousLastAssistantText && !!lastText && lastText !== ctx.previousLastAssistantText
  );
};

type ResponseWaitOptions = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
};

type IsStreamingVisibleContext = {
  page: Page;
};

const isStreamingVisible = async (ctx: IsStreamingVisibleContext): Promise<boolean> => {
  return isResponseGenerating(ctx.page, SELECTORS.streamingIndicator);
};

type ReadNormalizedLastResponseContext = {
  page: Page;
};

const readNormalizedLastResponse = async (
  ctx: ReadNormalizedLastResponseContext,
): Promise<string> => {
  const text = await captureLastResponse(ctx.page).catch(() => "");
  return normalizeDisplayText({ value: text });
};

type TurnSettledState = {
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

type ReadTurnSnapshotContext = {
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

export const countExpectedImageMarkers = (text: string): number => {
  const markers = text.match(/\[image-\d+\]/g);
  if (markers === null) return 0;
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

type LastAssistantTurnState = {
  text: string;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

const readTurnSnapshot = async (ctx: ReadTurnSnapshotContext): Promise<TurnSnapshot> => {
  const turnState = (await ctx.page.evaluate(LAST_ASSISTANT_TURN_STATE_SOURCE).catch(() => ({
    text: "",
    assetCount: 0,
    loadedAssetCount: 0,
    pendingAssetCount: 0,
    expectedImageMarkerCount: 0,
  }))) as LastAssistantTurnState;
  const streaming = await isStreamingVisible({ page: ctx.page });
  const text = normalizeDisplayText({
    value: turnState.text || (await readNormalizedLastResponse({ page: ctx.page })),
  });
  const expectedImageMarkerCount = Math.max(
    turnState.expectedImageMarkerCount,
    countExpectedImageMarkers(text),
  );
  return {
    text,
    streaming,
    assetCount: turnState.assetCount,
    loadedAssetCount: turnState.loadedAssetCount,
    pendingAssetCount: turnState.pendingAssetCount,
    expectedImageMarkerCount,
  };
};

type TurnSnapshotSettledContext = {
  snapshot: TurnSnapshot;
  stableForMs: number;
  expectImages: number;
  msSinceImageActivity: number;
  sawImageActivity: boolean;
};

const turnSnapshotSettled = (ctx: TurnSnapshotSettledContext): boolean => {
  return isTurnSettled({
    hasText: !!ctx.snapshot.text,
    isTransientText: isTransientAssistantText({ text: ctx.snapshot.text }),
    assetCount: ctx.snapshot.assetCount,
    loadedAssetCount: ctx.snapshot.loadedAssetCount,
    pendingAssetCount: ctx.snapshot.pendingAssetCount,
    expectedImageMarkerCount: ctx.snapshot.expectedImageMarkerCount,
    streaming: ctx.snapshot.streaming,
    stableForMs: ctx.stableForMs,
    expectImages: ctx.expectImages,
    msSinceImageActivity: ctx.msSinceImageActivity,
    sawImageActivity: ctx.sawImageActivity,
  });
};

type WaitForLastAssistantTextStableContext = {
  page: Page;
  timeout: number;
  expectImages: number;
  imageActivity: ImageNetworkActivity;
};

const waitForComposerReady = async (page: Page): Promise<void> => {
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
};

const waitForLastAssistantTextStable = async (
  ctx: WaitForLastAssistantTextStableContext,
): Promise<void> => {
  const startedAt = Date.now();
  // Recover a render stuck against a stale DOM (lingering stop indicator, tiles that never
  // re-render): when nothing progresses for RENDER_STALL_RELOAD_MS, reload the tab to re-sync
  // with server truth. Real progress (text/asset change or a fresh image response) resets it,
  // so a genuinely-streaming long render is never interrupted.
  const watchdog = stallReloadWatchdogFor({
    waitAfterReload: waitForComposerReady,
    onReload: (count) =>
      process.stderr.write(`[bridge] ChatGPT render stalled — reloaded tab (reload ${count}).\n`),
  });
  let lastSnapshot = await readTurnSnapshot({ page: ctx.page });
  let stableSince = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    const snapshot = await readTurnSnapshot({ page: ctx.page });
    if (turnSnapshotChanged(lastSnapshot, snapshot)) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
      watchdog.noteProgress();
    } else if (
      ctx.imageActivity.sawActivity() &&
      ctx.imageActivity.msSinceLastActivity() < ASSET_SETTLE_QUIET_MS
    ) {
      // A generated-image tile just arrived over the network even if the DOM count has not
      // updated yet — count that as progress so a live image stream is never reloaded.
      watchdog.noteProgress();
    }
    if (
      turnSnapshotSettled({
        snapshot,
        stableForMs: Date.now() - stableSince,
        expectImages: ctx.expectImages,
        msSinceImageActivity: ctx.imageActivity.msSinceLastActivity(),
        sawImageActivity: ctx.imageActivity.sawActivity(),
      })
    )
      return;
    if (await watchdog.maybeReload(ctx.page)) {
      // Re-baseline after the reload so the settle timer never fires on pre-reload reads.
      lastSnapshot = await readTurnSnapshot({ page: ctx.page });
      stableSince = Date.now();
      continue;
    }
    await ctx.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
};

type WaitForResponseAfterBaselineContext = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  timeout: number;
};

const waitForResponseAfterBaseline = async (
  ctx: WaitForResponseAfterBaselineContext,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    if (await responseStartedAfterBaseline(ctx)) return;
    await ctx.page.waitForTimeout(250);
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
  const onResponse = (response: Response): void => {
    if (IMAGE_ACTIVITY_URL.test(response.url())) lastActivityAt = Date.now();
  };
  page.on("response", onResponse);
  return {
    msSinceLastActivity: () =>
      lastActivityAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastActivityAt,
    sawActivity: () => lastActivityAt !== 0,
    dispose: () => page.off("response", onResponse),
  };
};

const waitForResponse = async (
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> => {
  const parsed = parseResponseWaitOptions(options);
  const startedAt = Date.now();
  const imageActivity = trackImageNetworkActivity(page);
  try {
    if (parsed.previousAssistantCount !== undefined || parsed.previousLastAssistantText) {
      await waitForResponseAfterBaseline({ page, ...parsed });
    } else {
      await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
    }
    await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
    await waitForLastAssistantTextStable({
      page,
      timeout: remainingTimeout({ startedAt, timeout: parsed.timeout }),
      expectImages: parsed.expectImages === undefined ? 0 : parsed.expectImages,
      imageActivity,
    });
  } finally {
    imageActivity.dispose();
  }
};

type WaitForStreamingToFinishContext = {
  page: Page;
  startedAt: number;
  timeout: number;
};

const waitForStreamingToFinish = async (ctx: WaitForStreamingToFinishContext): Promise<void> => {
  try {
    await ctx.page
      .locator(SELECTORS.streamingIndicator)
      .waitFor({ state: "visible", timeout: 10_000 });
    await ctx.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: remainingTimeout({ startedAt: ctx.startedAt, timeout: ctx.timeout }),
    });
  } catch {
    // Response might already be complete
  }
};

const parseResponseWaitOptions = (
  options: number | ResponseWaitOptions,
): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
} => {
  if (typeof options === "number") {
    return { timeout: options };
  }
  return {
    timeout: options.timeout === undefined ? 300_000 : options.timeout,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText({
      value:
        options.previousLastAssistantText === undefined ? "" : options.previousLastAssistantText,
    }),
    expectImages: options.expectImages,
  };
};

const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "chatgpt",
      reason:
        "Run `bridge chrome start --provider chatgpt`, click Log in if needed, complete sign-in, leave Chrome open, then run again.",
    });
  }
};

type HasGuestLoginButtonsContext = {
  page: Page;
};

const hasGuestLoginButtons = async (ctx: HasGuestLoginButtonsContext): Promise<boolean> => {
  const login = ctx.page.locator('[data-testid="login-button"]');
  if (await login.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  const signup = ctx.page.locator('[data-testid="signup-button"]');
  return signup.isVisible({ timeout: 500 }).catch(() => false);
};

type HasVisibleAccountMenuContext = {
  page: Page;
};

const hasVisibleAccountMenu = async (ctx: HasVisibleAccountMenuContext): Promise<boolean> => {
  const account = ctx.page.locator(SELECTORS.accountMenuButton.join(", "));
  return account
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);
};

type HasVisibleComposerContext = {
  page: Page;
};

const hasVisibleComposer = async (ctx: HasVisibleComposerContext): Promise<boolean> => {
  const prompt = ctx.page.locator(SELECTORS.promptInput);
  return prompt
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  if (await hasVisibleAccountMenu({ page })) return false;
  if (await hasGuestLoginButtons({ page })) return true;
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
