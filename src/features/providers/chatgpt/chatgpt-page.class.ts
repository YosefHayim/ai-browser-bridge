import type { Locator, Page, APIResponse } from "playwright";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type {
  Attachment,
  AttachmentManifest,
  AttachmentRole,
  ConnectorSetupOptions,
  ConnectorSetupResult,
  ModelOption,
} from "../../domain/types.ts";
import type { BrowserProvider } from "../browser-provider.types.ts";

/** True when an unknown error is a Node.js ErrnoException with a code field. */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

/** Thrown when ChatGPT shows the unauthenticated guest shell. */
export class GuestSessionError extends Error {
  constructor() {
    super(
      "ChatGPT is not signed in. "
        + "This is the bridge's isolated Chrome — not your daily browser. "
        + "Click Log in in that window, complete sign-in, leave it open, then run again.",
    );
    this.name = "GuestSessionError";
  }
}

// --- actions/attach-files-to-prompt.ts ---



/** Attach local files to the ChatGPT composer when the browser UI exposes file upload. */
async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (await attachFilesViaInput({ page, paths })) return;
  await attachFilesViaChooser({ page, paths });
}


// --- actions/attach-files-via-chooser.ts ---


/** Context for {@link openAttachmentFileChooser}. */
interface OpenAttachmentFileChooserContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Open the attachment file chooser via the composer attach button. */
async function openAttachmentFileChooser(ctx: OpenAttachmentFileChooserContext) {
  const attachButton = await firstVisible({ page: ctx.page, selectors: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ] });
  if (!attachButton) throw new Error("Could not find ChatGPT attachment control.");
  const chooserPromise = ctx.page.waitForEvent("filechooser", { timeout: 5_000 });
  await attachButton.click();
  return chooserPromise;
}

/** Context for {@link attachFilesViaChooser}. */
interface AttachFilesViaChooserContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Local file paths to attach. */
  paths: string[];
}

/** Attach files by clicking the attachment button and using the file chooser. */
async function attachFilesViaChooser(ctx: AttachFilesViaChooserContext): Promise<void> {
  const chooser = await openAttachmentFileChooser({ page: ctx.page });
  await (await chooser).setFiles(ctx.paths);
}


// --- actions/attach-files-via-input.ts ---


/** Context for {@link attachFilesViaInput}. */
interface AttachFilesViaInputContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Local file paths to attach. */
  paths: string[];
}

/** Attach files through a visible file input when one exists. */
async function attachFilesViaInput(ctx: AttachFilesViaInputContext): Promise<boolean> {
  const input = ctx.page.locator(SELECTORS.attachmentInput).first();
  if (await input.count() === 0) return false;
  await input.setInputFiles(ctx.paths);
  return true;
}


// --- actions/build-prepared-rewind-turn.ts ---


/** Context for {@link buildPreparedRewindTurn}. */
interface BuildPreparedRewindTurnContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: PrepareRewindTurnContext["page"];
  /** Optional replacement text for the last user message. */
  replacement?: string;
  /** Last user message block locator. */
  lastUserBlock: Locator;
  /** Assistant block count before rewind. */
  previousAssistantCount: number;
  /** Last assistant text before rewind. */
  previousLastAssistantText: string;
}

/** Build prepared rewind state from loaded baseline values. */
async function buildPreparedRewindTurn(ctx: BuildPreparedRewindTurnContext): Promise<PreparedRewindTurn> {
  const turnScope = await resolveLastUserTurnScope({ lastUserBlock: ctx.lastUserBlock });
  const prompt = resolveRewindPrompt({
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
}


// --- actions/load-last-user-block.ts ---

/** Context for {@link loadLastUserBlock}. */
interface LoadLastUserBlockContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Load the last user message block or throw when none exist. */
async function loadLastUserBlock(ctx: LoadLastUserBlockContext) {
  const blocks = await ctx.page.locator(SELECTORS.userBlock).all();
  if (blocks.length === 0) throw new Error("No user message found to rewind.");
  return blocks[blocks.length - 1];
}


// --- actions/open-rewind-editor.ts ---


/** Context for {@link clickRewindEditButton}. */
interface ClickRewindEditButtonContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover the turn and click its edit button. */
async function clickRewindEditButton(ctx: ClickRewindEditButtonContext): Promise<void> {
  await ctx.prepared.turnScope.hover().catch(() => {});
  await ctx.prepared.page.waitForTimeout(300);
  const editButton = await findRewindEditButton({ turnScope: ctx.prepared.turnScope });
  if (!editButton) throw new Error("Could not find ChatGPT edit button for the last user message.");
  await editButton.click();
}

/** Context for {@link openRewindEditor}. */
interface OpenRewindEditorContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover the turn, click edit, and locate the editable prompt field. */
async function openRewindEditor(ctx: OpenRewindEditorContext) {
  await clickRewindEditButton({ prepared: ctx.prepared });
  return findRewindEditor({ page: ctx.prepared.page, turnScope: ctx.prepared.turnScope });
}


// --- actions/prepare-rewind-turn.ts ---






/** Load the last user block and baseline counts for a rewind operation. */
async function prepareRewindTurn(ctx: PrepareRewindTurnContext): Promise<PreparedRewindTurn> {
  const lastUserBlock = await loadLastUserBlock({ page: ctx.page });
  const previousAssistantCount = await countAssistantResponses(ctx.page);
  const previousLastAssistantText = await captureLastResponse(ctx.page);
  return buildPreparedRewindTurn({
    page: ctx.page,
    replacement: ctx.replacement,
    lastUserBlock,
    previousAssistantCount,
    previousLastAssistantText,
  });
}


// --- actions/rewind-controls.ts ---




/** Context for {@link findRewindEditButton}. */
interface FindRewindEditButtonContext {
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the edit button for the last user message within a turn scope. */
async function findRewindEditButton(ctx: FindRewindEditButtonContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: EDIT_BUTTON_SELECTORS });
}

/** Context for {@link findRewindEditor}. */
interface FindRewindEditorContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the editable prompt field after clicking edit. */
async function findRewindEditor(ctx: FindRewindEditorContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: EDITOR_SELECTORS })
    ?? firstVisible({ page: ctx.page, selectors: EDITOR_SELECTORS });
}

/** Context for {@link findRewindSubmitButton}. */
interface FindRewindSubmitButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
}

/** Find the submit button for an edited prompt. */
async function findRewindSubmitButton(ctx: FindRewindSubmitButtonContext) {
  return firstVisibleIn({ parent: ctx.turnScope, selectors: SUBMIT_BUTTON_SELECTORS })
    ?? firstVisible({ page: ctx.page, selectors: SUBMIT_BUTTON_SELECTORS });
}

/** Context for {@link submitRewindEditor}. */
interface SubmitRewindEditorContext {
  /** Editable prompt field locator. */
  editor: Locator;
  /** Prompt text to write before submitting. */
  prompt: string;
}

/** Fill the rewind editor with the replacement prompt. */
async function submitRewindEditor(ctx: SubmitRewindEditorContext): Promise<void> {
  await ctx.editor.click();
  await ctx.editor.fill(ctx.prompt);
  await ctx.editor.dispatchEvent("input").catch(() => {});
}


// --- actions/rewind-helpers.ts ---




/** Context for {@link resolveLastUserTurnScope}. */
interface ResolveLastUserTurnScopeContext {
  /** Last user message block locator. */
  lastUserBlock: Locator;
}

/** Resolve the conversation turn scope for hovering edit controls. */
async function resolveLastUserTurnScope(ctx: ResolveLastUserTurnScopeContext): Promise<Locator> {
  const turn = ctx.lastUserBlock.locator('xpath=ancestor::section[starts-with(@data-testid, "conversation-turn-")][1]');
  return (await turn.count() > 0) ? turn : ctx.lastUserBlock;
}

/** Edit-button selectors scoped to a user turn. */
const EDIT_BUTTON_SELECTORS = [
  'button[data-testid="edit-turn-button"]',
  'button[data-testid="edit-message-button"]',
  'button[aria-label="Edit message"]',
  'button[aria-label*="Edit" i]',
  'button[title="Edit message"]',
  'button:has-text("Edit")',
] as const;

/** Editor selectors scoped to a user turn or page. */
const EDITOR_SELECTORS = [
  'textarea[name="prompt-textarea"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  "textarea",
] as const;

/** Submit-button selectors for edited prompts. */
const SUBMIT_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Submit"]',
  'button[aria-label="Send"]',
  'button[aria-label="Send prompt"]',
  'button:has-text("Save & submit")',
  'button:has-text("Submit")',
  'button:has-text("Update")',
] as const;

/** Context for {@link readLastUserPromptText}. */
interface ReadLastUserPromptTextContext {
  /** Last user message block locator. */
  lastUserBlock: Locator;
}

/** Read normalized text from the last user message block. */
async function readLastUserPromptText(ctx: ReadLastUserPromptTextContext): Promise<string> {
  return normalizeDisplayText({ value: await ctx.lastUserBlock.innerText() });
}

/** Context for {@link resolveRewindPrompt}. */
interface ResolveRewindPromptContext {
  /** Optional replacement prompt text. */
  replacement?: string;
  /** Previous text from the last user message. */
  previousText: string;
}

/** Resolve the prompt text to submit when rewinding the last user message. */
function resolveRewindPrompt(ctx: ResolveRewindPromptContext): string {
  const prompt = ctx.replacement?.trim() || ctx.previousText;
  if (!prompt) throw new Error("Last user message is empty.");
  return prompt;
}


// --- actions/rewind-last-user-prompt.ts ---



/** Edit the last user message and submit it again, optionally replacing its content. */
async function rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
  const prepared = await prepareRewindTurn({ page, replacement });
  await submitRewindTurn({ prepared });
}


// --- actions/rewind.types.ts ---

/** Prepared rewind turn state before editing and submitting. */
interface PreparedRewindTurn {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Conversation turn scope locator. */
  turnScope: Locator;
  /** Prompt text to submit. */
  prompt: string;
  /** Assistant block count before rewind. */
  previousAssistantCount: number;
  /** Last assistant text before rewind. */
  previousLastAssistantText: string;
}

/** Context for {@link prepareRewindTurn}. */
interface PrepareRewindTurnContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Optional replacement text for the last user message. */
  replacement?: string;
}


// --- actions/stop-generating.ts ---


/** Stop the active streaming response when ChatGPT exposes the stop button. */
async function stopGenerating(page: Page, timeout = 5_000): Promise<boolean> {
  const stop = page.locator(SELECTORS.streamingIndicator).first();
  try {
    await stop.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await stop.click();
  return true;
}


// --- actions/submit-edited-rewind-turn.ts ---



/** Context for {@link submitEditedRewindTurn}. */
interface SubmitEditedRewindTurnContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Submit the edited rewind turn and wait for the new response. */
async function submitEditedRewindTurn(ctx: SubmitEditedRewindTurnContext): Promise<void> {
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
}


// --- actions/submit-rewind-turn.ts ---

/** Context for {@link submitRewindTurn}. */
interface SubmitRewindTurnContext {
  /** Prepared rewind turn state. */
  prepared: PreparedRewindTurn;
}

/** Hover, edit, and resubmit the last user turn. */
async function submitRewindTurn(ctx: SubmitRewindTurnContext): Promise<void> {
  const editor = await openRewindEditor({ prepared: ctx.prepared });
  if (!editor) throw new Error("Could not find editable prompt field after clicking edit.");
  await submitRewindEditor({ editor, prompt: ctx.prepared.prompt });
  await submitEditedRewindTurn({ prepared: ctx.prepared });
}


// --- attachments/assign-attachments-resolve.ts ---


/** Resolve one attachment candidate to a stable id, reusing existing records when possible. */
function resolveAttachment(ctx: {
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
}): Attachment {
  const existing = findExistingAttachment(ctx);
  if (existing) return reuseExisting({ ctx, existing });
  return createAttachment(ctx);
}

function reuseExisting(params: { ctx: { usedExistingIds: Set<string> }; existing: Attachment }): Attachment {
  params.ctx.usedExistingIds.add(params.existing.id);
  return params.existing;
}

function createAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: {
    role: AttachmentRole;
    messageIndex: number;
    counters: AttachmentCounters;
    createdAt: string;
  };
  newAttachments: Attachment[];
}): Attachment {
  ctx.params.counters[ctx.params.role][ctx.item.kind] += 1;
  const attachment = buildAttachment(ctx);
  ctx.newAttachments.push(attachment);
  return attachment;
}

function findExistingAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; existing: Attachment[] };
  usedExistingIds: Set<string>;
}): Attachment | undefined {
  return ctx.params.existing.find((attachment) =>
    !ctx.usedExistingIds.has(attachment.id)
    && attachment.role === ctx.params.role
    && attachment.messageIndex === ctx.params.messageIndex
    && attachment.kind === ctx.item.kind
    && attachment.url === ctx.item.url,
  );
}

function buildAttachment(ctx: {
  item: ExtractedContent["attachments"][number];
  params: { role: AttachmentRole; messageIndex: number; counters: AttachmentCounters; createdAt: string };
}): Attachment {
  const suffix = ctx.params.counters[ctx.params.role][ctx.item.kind];
  return {
    ...ctx.item,
    id: attachmentId({ role: ctx.params.role, kind: ctx.item.kind, suffix }),
    role: ctx.params.role,
    messageIndex: ctx.params.messageIndex,
    createdAt: ctx.params.createdAt,
  };
}

function attachmentId(params: { role: AttachmentRole; kind: AttachmentKind; suffix: number }): string {
  return params.role === "user" ? `user-${params.kind}-${params.suffix}` : `${params.kind}-${params.suffix}`;
}


// --- attachments/assign-attachments.ts ---





/** Register extracted assistant content and persist new attachment ids. */
async function registerExtractedContent(params: {
  conversationId: string;
  messageIndex: number;
  extracted: ExtractedContent;
}): Promise<{ text: string; attachments: Attachment[] }> {
  const manifest = await loadManifest(params.conversationId);
  const registered = assignAttachmentIds({
    extracted: params.extracted,
    role: "assistant",
    messageIndex: params.messageIndex,
    counters: countersFromManifest(manifest),
    createdAt: new Date().toISOString(),
    existing: manifest.attachments,
  });
  return finalizeRegistration({ manifest, registered });
}

/** Assign stable attachment ids and replace temporary markers in text. */
function assignAttachmentIds(params: {
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
} {
  const usedExistingIds = new Set<string>();
  const newAttachments: Attachment[] = [];
  const attachments = params.extracted.attachments.map((item) =>
    resolveAttachment({ item, params, usedExistingIds, newAttachments }),
  );
  return {
    text: replaceMarkers({ text: params.extracted.text, attachments }),
    attachments,
    newAttachments,
    counters: params.counters,
  };
}

async function finalizeRegistration(params: {
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  registered: ReturnType<typeof assignAttachmentIds>;
}): Promise<{ text: string; attachments: Attachment[] }> {
  params.manifest.attachments.push(...params.registered.newAttachments);
  params.manifest.counters = params.registered.counters;
  await saveManifest(params.manifest);
  return { text: params.registered.text, attachments: params.registered.attachments };
}

function replaceMarkers(params: { text: string; attachments: Attachment[] }): string {
  let content = params.text;
  for (let index = 0; index < params.attachments.length; index += 1) {
    content = content.replace(markerFor(index), `[${params.attachments[index]?.id ?? ""}]`);
  }
  return content;
}

function markerFor(index: number): string {
  return `${MARKER_PREFIX}${index}${MARKER_SUFFIX}`;
}


// --- attachments/attachment-types.ts ---

/** Minimal DOM snapshot used by the attachment walker. */
type DomSnapshotNode =
  | { type: "text"; text: string }
  | {
    type: "element";
    tagName: string;
    attributes: Record<string, string>;
    children: DomSnapshotNode[];
  };

/** Attachment kind inferred from a DOM element. */
type AttachmentKind = Attachment["kind"];

/** Per-role attachment id counters stored in the manifest. */
type AttachmentCounters = Record<AttachmentRole, Record<AttachmentKind, number>>;

/** Legacy flat counter shape accepted when normalizing manifests. */
type LegacyAttachmentCounters = Partial<Record<AttachmentKind, number>>;

/** Options for extracting all conversation messages with attachments. */
type ExtractMessagesOptions = { conversationId: string; includeUserAttachments?: boolean };

/** Attachment record shape before role normalization. */
type SerializedAttachment = Omit<Attachment, "role"> & { role?: AttachmentRole };

/** Candidate attachment discovered while walking a DOM snapshot. */
interface AttachmentCandidate {
  kind: AttachmentKind;
  url: string;
  filename?: string;
  mime?: string;
}

/** Text and attachment candidates extracted from one message snapshot. */
interface ExtractedContent {
  text: string;
  attachments: AttachmentCandidate[];
}

/** Serialized conversation message produced by the in-page snapshot script. */
interface SerializedMessage {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
}

/** Marker prefix used while walking snapshots before ids are assigned. */
const MARKER_PREFIX = "\u0000attachment:";

/** Marker suffix used while walking snapshots before ids are assigned. */
const MARKER_SUFFIX = "\u0000";


// --- attachments/dom-snapshot.dom-snippet.ts ---
const DOM_SNAPSHOT_HELPERS_SOURCE = String.raw`
const GENERATED_IMAGE_SELECTOR = 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image"]';

function serializeMessage(element, messageIndex) {
  return {
    role: element.getAttribute("data-message-author-role") ?? "unknown",
    messageIndex,
    text: element instanceof HTMLElement ? element.innerText : element.textContent ?? "",
    root: snapshotNode(element),
  };
}

// Serialize one conversation turn. Resolves role from an inner role block when present;
// otherwise a turn that only holds a generated image is treated as an assistant message.
// Generated images that render outside the role block (but inside the turn) are appended
// as extra children so the walker still visits them.
function serializeTurn(turn, messageIndex) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  const generatedImages = Array.from(turn.querySelectorAll(GENERATED_IMAGE_SELECTOR));

  if (!roleBlock) {
    if (generatedImages.length === 0) return null;
    return {
      role: "assistant",
      messageIndex,
      text: turn instanceof HTMLElement ? turn.innerText : turn.textContent ?? "",
      root: { type: "element", tagName: "div", attributes: {}, children: generatedImages.map(snapshotNode) },
    };
  }

  const message = serializeMessage(roleBlock, messageIndex);
  const outsideBlock = generatedImages.filter((image) => !roleBlock.contains(image));
  if (outsideBlock.length > 0) {
    message.root.children.push(...outsideBlock.map(snapshotNode));
  }
  return message;
}

function turnRole(turn) {
  const roleBlock = turn.querySelector("[data-message-author-role]");
  if (roleBlock) return roleBlock.getAttribute("data-message-author-role") ?? "unknown";
  if (turn.querySelector(GENERATED_IMAGE_SELECTOR)) return "assistant";
  return null;
}

function snapshotNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", text: node.textContent ?? "" };
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
}
`;

const LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE = String.raw`
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

const ALL_MESSAGES_SNAPSHOT_SOURCE = String.raw`
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
    const message = serializeTurn(turn, role === "assistant" ? assistantIndex : role === "user" ? userIndex : -1);
    if (message) messages.push(message);
  }
  return messages;
})()
`;


// --- attachments/download-attachment.ts ---




/** Download one attachment from a conversation manifest. */
async function downloadAttachment(
  page: Page,
  conversationId: string,
  id: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const manifest = await loadManifest(conversationId);
  const attachment = manifest.attachments.find((item: Attachment) => item.id === id);
  if (!attachment) throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);
  return downloadResolvedAttachment({ page, conversationId, attachment, attachments: manifest.attachments, opts });
}

/** Download all or selected attachments sequentially. */
async function downloadAll(
  page: Page,
  conversationId: string,
  opts: DownloadAllOptions = {},
): Promise<DownloadAllResult[]> {
  const manifest = await loadManifest(conversationId);
  const ids = opts.ids ?? manifest.attachments.map((attachment: Attachment) => attachment.id);
  const results = await downloadIds({ page, conversationId, ids, opts });
  if (results.length > 0 && results.every((result) => result.error)) {
    throw new AttachmentDownloadError(opts.ids?.join(",") ?? "*", undefined, `Failed to download all attachments for conversation ${conversationId}`, results);
  }
  return results;
}

interface DownloadResolvedInput {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  opts: DownloadOptions;
}

async function downloadResolvedAttachment(input: DownloadResolvedInput): Promise<DownloadResult> {
  const outDir = outputDirectory({ conversationId: input.conversationId, outDir: input.opts.outDir });
  await mkdir(outDir, { recursive: true });
  try {
    if (isHttpUrl(input.attachment.url)) {
      return await downloadHttpAttachment({ page: input.page, attachment: input.attachment, outDir, attachments: input.attachments });
    }
    const filePath = await resolveDownloadPath({ outDir, attachment: input.attachment, attachments: input.attachments });
    const bytes = input.attachment.url.startsWith("blob:")
      ? await fetchBlobBytes({ page: input.page, attachment: input.attachment })
      : parseDataUrl({ attachment: input.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw new AttachmentDownloadError(input.attachment.id, input.attachment.url, `Failed to download attachment ${input.attachment.id}`, error);
  }
}

interface DownloadIdsInput {
  page: Page;
  conversationId: string;
  ids: string[];
  opts: DownloadAllOptions;
}

async function downloadIds(input: DownloadIdsInput): Promise<DownloadAllResult[]> {
  const results: DownloadAllResult[] = [];
  for (const attachmentId of input.ids) results.push(await downloadOneId({ input, attachmentId }));
  return results;
}

async function downloadOneId(input: { input: DownloadIdsInput; attachmentId: string }): Promise<DownloadAllResult> {
  try {
    const result = await downloadAttachment(input.input.page, input.input.conversationId, input.attachmentId, input.input.opts);
    return { id: input.attachmentId, ...result };
  } catch (error) {
    return { id: input.attachmentId, path: "", bytes: 0, error: error instanceof Error ? error.message : String(error) };
  }
}


// --- attachments/download-attachment.types.ts ---
/** Error raised when an attachment cannot be resolved or downloaded. */
class AttachmentDownloadError extends Error {
  /** Attachment id that failed to download. */
  readonly id: string;
  /** Source URL when known. */
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

/** Result of downloading a single attachment. */
interface DownloadResult {
  /** Absolute path to the saved file. */
  path: string;
  /** Number of bytes written or skipped. */
  bytes: number;
}

/** Per-item result when downloading multiple attachments. */
interface DownloadAllResult extends DownloadResult {
  /** Attachment id from the manifest. */
  id: string;
  /** Error message when the download failed. */
  error?: string;
}

/** Options for downloading one attachment. */
interface DownloadOptions {
  /** Optional output directory override. */
  outDir?: string;
}

/** Options for downloading many attachments. */
interface DownloadAllOptions extends DownloadOptions {
  /** Optional subset of attachment ids to download. */
  ids?: string[];
}


// --- attachments/download-filename.core.ts ---



interface ParseDataUrlInput {
  /** Attachment whose url is a data: URI. */
  attachment: Attachment;
}

/** Decode a data: URL attachment into bytes. */
function parseDataUrl(input: ParseDataUrlInput): Buffer {
  const match = /^data:([^,]*),(.*)$/s.exec(input.attachment.url);
  if (!match) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Invalid data URL for attachment ${input.attachment.id}`,
    );
  }
  return decodeDataUrlPayload({ metadata: match[1] ?? "", payload: match[2] ?? "" });
}

function decodeDataUrlPayload(input: { metadata: string; payload: string }): Buffer {
  if (input.metadata.split(";").includes("base64")) return Buffer.from(input.payload, "base64");
  return Buffer.from(decodeURIComponent(input.payload), "utf8");
}

interface SanitizeFilenameInput {
  /** Raw filename candidate. */
  value: string | undefined;
}

/** Remove unsafe characters from a filename candidate. */
function sanitizeFilename(input: SanitizeFilenameInput): string | undefined {
  const sanitized = input.value
    ?.replace(/[\\/\0-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return sanitized ? sanitized : undefined;
}

interface FilenameFromUrlInput {
  /** URL whose pathname basename becomes the filename. */
  url: string;
}

/** Extract a filename from a URL pathname. */
function filenameFromUrl(input: FilenameFromUrlInput): string | undefined {
  try {
    const parsed = new URL(input.url);
    const basename = path.posix.basename(parsed.pathname);
    return basename && basename !== "/" ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
  }
}

interface SameAttachmentInput {
  /** First attachment to compare. */
  left: Attachment;
  /** Second attachment to compare. */
  right: Attachment;
}

/** Whether two attachments refer to the same artifact. */
function isSameAttachment(input: SameAttachmentInput): boolean {
  return input.left.id === input.right.id
    && input.left.url === input.right.url
    && input.left.filename === input.right.filename;
}


// --- attachments/download-filename.helpers.ts ---



const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

interface ExtensionForMimeInput {
  /** MIME type used to infer a file extension. */
  mime: string | undefined;
}

/** Map a MIME type to a file extension when known. */
function extensionForMime(input: ExtensionForMimeInput): string | undefined {
  const normalized = input.mime?.toLowerCase().split(";")[0]?.trim();
  return normalized ? MIME_EXTENSIONS[normalized] : undefined;
}

interface ExtensionForAttachmentInput {
  /** Attachment whose kind and mime infer the extension. */
  attachment: Attachment;
  /** Optional MIME override from response headers. */
  mimeOverride?: string;
}

/** Infer a file extension for an attachment. */
function extensionForAttachment(input: ExtensionForAttachmentInput): string {
  const mimeExtension = extensionForMime({ mime: input.mimeOverride })
    ?? extensionForMime({ mime: input.attachment.mime });
  if (mimeExtension) return mimeExtension;
  if (input.attachment.kind === "image") return ".png";
  if (input.attachment.kind === "pdf") return ".pdf";
  return "";
}

interface WithMissingExtensionInput {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
}

/** Append an inferred extension when the filename has none. */
function withMissingExtension(input: WithMissingExtensionInput): string {
  if (path.extname(input.filename)) return input.filename;
  return `${input.filename}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`;
}

interface FilenameForAttachmentInput {
  attachment: Attachment;
  mimeOverride?: string;
}

/** Resolve the on-disk filename for an attachment. */
function filenameForAttachment(input: FilenameForAttachmentInput): string {
  const preferred = resolvePreferredFilename(input);
  if (preferred) return preferred;
  const fallback = sanitizeFilename({
    value: `${input.attachment.id}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`,
  });
  return fallback ?? input.attachment.id;
}

function resolvePreferredFilename(input: FilenameForAttachmentInput): string | undefined {
  const preferred = sanitizeFilename({ value: input.attachment.filename });
  if (preferred) return withMissingExtension({ filename: preferred, attachment: input.attachment, mimeOverride: input.mimeOverride });
  return sanitizeFilename({ value: filenameFromUrl({ url: input.attachment.url }) });
}

// --- attachments/download-http.helpers.ts ---




interface ResolveDownloadPathInput {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
}

/** Resolve a unique download path, disambiguating filename collisions. */
async function resolveDownloadPath(input: ResolveDownloadPathInput): Promise<string> {
  const filename = filenameForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride });
  const filePath = outputPath({ outDir: input.outDir, filename });
  if (await existingSize({ filePath }) === undefined) return filePath;
  return resolveCollidingDownloadPath({ input, filename, filePath });
}

async function resolveCollidingDownloadPath(input: {
  input: ResolveDownloadPathInput;
  filename: string;
  filePath: string;
}): Promise<string> {
  const owner = input.input.attachments.find((item) =>
    filenameForAttachment({ attachment: item, mimeOverride: input.input.mimeOverride }) === input.filename,
  );
  if (!owner || isSameAttachment({ left: owner, right: input.input.attachment })) return input.filePath;
  return outputPath({
    outDir: input.input.outDir,
    filename: disambiguateFilename({ filename: input.filename, id: input.input.attachment.id }),
  });
}

interface FetchBlobInput {
  page: Page;
  attachment: Attachment;
}

/** Fetch blob attachment bytes through the browser context. */
async function fetchBlobBytes(input: FetchBlobInput): Promise<Buffer> {
  try {
    const bytes = await input.page.evaluate(async (url: string): Promise<number[] | Uint8Array> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Blob fetch failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
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
}

interface DownloadHttpInput {
  page: Page;
  attachment: Attachment;
  outDir: string;
  attachments: Attachment[];
}

/** Download an https attachment through the browser request context. */
async function downloadHttpAttachment(input: DownloadHttpInput): Promise<DownloadResult> {
  const response = await input.page.context().request.get(input.attachment.url);
  if (!response.ok()) throwFailedHttpAttachment({ attachment: input.attachment, status: response.status() });
  return await saveHttpAttachmentResponse({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    response,
  });
}


// --- attachments/download-http.save.ts ---





/** Save an HTTP attachment response body when content changed. */
async function saveHttpAttachmentResponse(input: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  response: APIResponse;
}): Promise<DownloadResult> {
  const headers = input.response.headers();
  const filePath = await resolveDownloadPath({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    mimeOverride: headers["content-type"],
  });
  const contentLength = Number(headers["content-length"]);
  if (Number.isSafeInteger(contentLength) && await existingSize({ filePath }) === contentLength) {
    return { path: filePath, bytes: contentLength };
  }
  return writeIfChanged({ filePath, bytes: await input.response.body() });
}

/** Throw when an HTTP attachment response is not successful. */
function throwFailedHttpAttachment(input: {
  attachment: Attachment;
  status: number;
}): void {
  throw new AttachmentDownloadError(
    input.attachment.id,
    input.attachment.url,
    `Attachment ${input.attachment.id} request failed with HTTP ${input.status}`,
  );
}


// --- attachments/download-path.helpers.ts ---


interface OutputDirectoryInput {
  /** Conversation id used for the default downloads folder. */
  conversationId: string;
  /** Optional explicit output directory. */
  outDir?: string;
}

/** Resolve the output directory for attachment downloads. */
function outputDirectory(input: OutputDirectoryInput): string {
  if (input.outDir) return path.resolve(input.outDir);
  return path.resolve(process.cwd(), "downloads", input.conversationId);
}

interface OutputPathInput {
  /** Resolved output directory. */
  outDir: string;
  /** Filename relative to the output directory. */
  filename: string;
}

/** Build a safe absolute output path inside the output directory. */
function outputPath(input: OutputPathInput): string {
  const resolvedOutDir = path.resolve(input.outDir);
  const filePath = path.resolve(resolvedOutDir, input.filename);
  const relativePath = path.relative(resolvedOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AttachmentDownloadError("", undefined, `Invalid attachment output path: ${input.filename}`);
  }
  return filePath;
}

/** Whether a URL uses HTTP or HTTPS. */
function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

interface DisambiguateInput {
  /** Original filename that collided. */
  filename: string;
  /** Attachment id appended to disambiguate. */
  id: string;
}

/** Append an attachment id before the extension to avoid filename collisions. */
function disambiguateFilename(input: DisambiguateInput): string {
  const extension = path.extname(input.filename);
  if (!extension) return `${input.filename}-${input.id}`;
  return `${input.filename.slice(0, -extension.length)}-${input.id}${extension}`;
}


// --- attachments/download-write.helpers.ts ---



interface ExistingSizeInput {
  /** Absolute file path to stat. */
  filePath: string;
}

/** Return file size when the path exists. */
async function existingSize(input: ExistingSizeInput): Promise<number | undefined> {
  try {
    return (await stat(input.filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

interface WriteIfChangedInput {
  /** Absolute destination path. */
  filePath: string;
  /** File contents to write when size differs. */
  bytes: Buffer;
}

/** Write bytes only when the destination size changed. */
async function writeIfChanged(input: WriteIfChangedInput): Promise<DownloadResult> {
  if (await existingSize({ filePath: input.filePath }) === input.bytes.byteLength) {
    return { path: input.filePath, bytes: input.bytes.byteLength };
  }
  await writeFile(input.filePath, input.bytes);
  return { path: input.filePath, bytes: input.bytes.byteLength };
}


// --- attachments/extract-messages.helpers.ts ---





async function persistAllMessages(params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
}): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const manifest = await loadManifest(params.opts.conversationId);
  const state = { manifest, counters: countersFromManifest(manifest), now: new Date().toISOString() };
  const captured = await mapCapturedMessages({ ...params, ...state });
  return saveCapturedMessages({ captured, manifest: state.manifest, counters: state.counters });
}

async function saveCapturedMessages(params: {
  captured: Array<{ role: string; content: string; attachments: Attachment[] }>;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
}) {
  params.manifest.counters = params.counters;
  await saveManifest(params.manifest);
  return params.captured;
}

async function mapCapturedMessages(params: {
  messages: SerializedMessage[];
  opts: ExtractMessagesOptions;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
}) {
  const captured: Array<{ role: string; content: string; attachments: Attachment[] }> = [];
  for (const message of params.messages) {
    captured.push(await captureMessage({ message, opts: params.opts, counters: params.counters, now: params.now, manifest: params.manifest }));
  }
  return captured;
}

async function captureMessage(params: {
  message: SerializedMessage;
  opts: ExtractMessagesOptions;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
  if (!shouldRegisterAttachments({ message: params.message, opts: params.opts })) {
    return { role: params.message.role, content: params.message.text, attachments: [] };
  }
  return registerMessageAttachments(params);
}

async function registerMessageAttachments(params: {
  message: SerializedMessage;
  counters: ReturnType<typeof countersFromManifest>;
  now: string;
  manifest: Awaited<ReturnType<typeof loadManifest>>;
}) {
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
  return { role: params.message.role, content: registered.text, attachments: registered.attachments };
}

function shouldRegisterAttachments(params: { message: SerializedMessage; opts: ExtractMessagesOptions }): boolean {
  if (params.message.role === "assistant") return true;
  return params.message.role === "user" && params.opts.includeUserAttachments === true;
}


// --- attachments/extract-messages.ts ---

/** Extract text and assistant attachments from the last assistant message. */
async function extractAssistantContent(
  page: Page,
  opts: { conversationId: string },
): Promise<{ text: string; attachments: Attachment[] }> {
  const message = await page.evaluate<SerializedMessage | null>(LAST_ASSISTANT_MESSAGE_SNAPSHOT_SOURCE);
  if (!message) return { text: "", attachments: [] };
  return registerExtractedContent({
    conversationId: opts.conversationId,
    messageIndex: message.messageIndex,
    extracted: extractContentFromSnapshot(message.root),
  });
}

/** Extract all rendered messages while registering assistant attachments and, optionally, user attachments. */
async function extractAllMessages(
  page: Page,
  opts: ExtractMessagesOptions,
): Promise<Array<{ role: string; content: string; attachments: Attachment[] }>> {
  const messages = await page.evaluate<SerializedMessage[]>(ALL_MESSAGES_SNAPSHOT_SOURCE);
  return persistAllMessages({ messages, opts });
}


// --- attachments/manifest-counters.ts ---


/** Supported attachment kinds tracked in manifests. */
function attachmentKinds(): AttachmentKind[] {
  return ["image", "file", "pdf"];
}

/** Empty per-role attachment counters. */
function emptyCounters(): AttachmentCounters {
  return {
    assistant: { image: 0, file: 0, pdf: 0 },
    user: { image: 0, file: 0, pdf: 0 },
  };
}

/** Build counters from existing attachment ids in a manifest. */
function countersFromAttachments(attachments: Attachment[]): AttachmentCounters {
  const counters = emptyCounters();
  for (const attachment of attachments) {
    const suffix = Number(attachment.id.split("-").at(-1));
    if (Number.isFinite(suffix)) {
      counters[attachment.role][attachment.kind] = Math.max(counters[attachment.role][attachment.kind], suffix);
    }
  }
  return counters;
}

/** Merge stored counters with legacy or partial overrides. */
function mergeCounters(base: AttachmentCounters, overrides: unknown): AttachmentCounters {
  const normalizedOverrides = normalizeCounters(overrides);
  return {
    assistant: {
      image: Math.max(base.assistant.image, normalizedOverrides.assistant.image),
      file: Math.max(base.assistant.file, normalizedOverrides.assistant.file),
      pdf: Math.max(base.assistant.pdf, normalizedOverrides.assistant.pdf),
    },
    user: {
      image: Math.max(base.user.image, normalizedOverrides.user.image),
      file: Math.max(base.user.file, normalizedOverrides.user.file),
      pdf: Math.max(base.user.pdf, normalizedOverrides.user.pdf),
    },
  };
}

/** Normalize unknown counter payloads into the current per-role shape. */
function normalizeCounters(value: unknown): AttachmentCounters {
  const counters = emptyCounters();
  if (!isRecord(value)) return counters;
  return applyLegacyCounters({ counters, value });
}

function applyLegacyCounters(params: { counters: AttachmentCounters; value: Record<string, unknown> }): AttachmentCounters {
  applyRoleCounters({ counters: params.counters, role: "assistant", source: params.value.assistant });
  applyRoleCounters({ counters: params.counters, role: "user", source: params.value.user });
  if (isKindCounters(params.value)) applyRoleCounters({ counters: params.counters, role: "assistant", source: params.value });
  return params.counters;
}

/** Merge one role's kind counters with optional legacy overrides. */
function mergeKindCounters(
  base: Record<AttachmentKind, number>,
  overrides: LegacyAttachmentCounters,
): Record<AttachmentKind, number> {
  return {
    image: Math.max(base.image, overrides.image ?? 0),
    file: Math.max(base.file, overrides.file ?? 0),
    pdf: Math.max(base.pdf, overrides.pdf ?? 0),
  };
}

function applyRoleCounters(params: {
  counters: AttachmentCounters;
  role: "assistant" | "user";
  source: unknown;
}): void {
  if (!isKindCounters(params.source)) return;
  params.counters[params.role] = mergeKindCounters(params.counters[params.role], params.source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKindCounters(value: unknown): value is LegacyAttachmentCounters {
  const kinds = attachmentKinds();
  return isRecord(value)
    && kinds.some((kind) => value[kind] !== undefined)
    && kinds.every((kind) => value[kind] === undefined || typeof value[kind] === "number");
}


// --- attachments/manifest-store.ts ---






function manifestPath(conversationId: string): string {
  const downloadsRoot = path.resolve(process.cwd(), "downloads");
  const filePath = path.resolve(downloadsRoot, conversationId, "manifest.json");
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw new Error(`Invalid conversation id for attachment manifest: ${conversationId}`);
  }
  return filePath;
}

function normalizeAttachment(attachment: SerializedAttachment): Attachment {
  return { ...attachment, role: attachment.role ?? "assistant" };
}

function normalizeManifest(params: { conversationId: string; manifest: Partial<AttachmentManifest> }): AttachmentManifest {
  const attachments = Array.isArray(params.manifest.attachments)
    ? params.manifest.attachments.map(normalizeAttachment)
    : [];
  return {
    conversationId: params.manifest.conversationId ?? params.conversationId,
    attachments,
    counters: mergeCounters(countersFromAttachments(attachments), params.manifest.counters),
  };
}

/** Load a conversation attachment manifest, creating an empty one if needed. */
async function loadManifest(conversationId: string): Promise<AttachmentManifest> {
  try {
    const raw = await readFile(manifestPath(conversationId), "utf8");
    return normalizeManifest({ conversationId, manifest: JSON.parse(raw) as Partial<AttachmentManifest> });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { conversationId, attachments: [], counters: emptyCounters() };
    }
    throw error;
  }
}

/** Persist a conversation attachment manifest. */
async function saveManifest(manifest: AttachmentManifest): Promise<void> {
  const normalized = normalizeManifest({ conversationId: manifest.conversationId, manifest });
  const filePath = manifestPath(normalized.conversationId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

/** Append already registered attachments to a conversation manifest. */
async function appendAttachments(conversationId: string, items: Attachment[]): Promise<AttachmentManifest> {
  const manifest = await loadManifest(conversationId);
  manifest.attachments.push(...items);
  manifest.counters = countersFromManifest(manifest);
  await saveManifest(manifest);
  return manifest;
}

/** Derive attachment counters from a manifest's stored attachments and overrides. */
function countersFromManifest(manifest: AttachmentManifest): AttachmentCounters {
  return mergeCounters(countersFromAttachments(manifest.attachments), manifest.counters);
}


// --- attachments/snapshot-mime.ts ---

const EXTENSION_MIMES = [
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
] as const;

function inferMimeFromDataUrl(url: string): string | undefined {
  const dataMatch = /^data:([^;,]+)/.exec(url);
  return dataMatch?.[1];
}

function inferMimeFromExtension(params: { url: string; fallback: AttachmentKind }): string | undefined {
  const lower = params.url.split("?")[0]?.toLowerCase() ?? "";
  const mapped = extensionMime(lower);
  if (mapped) return mapped;
  return params.fallback === "image" ? "image/*" : undefined;
}

function extensionMime(path: string): string | undefined {
  for (const [suffix, mime] of EXTENSION_MIMES) {
    if (path.endsWith(suffix)) return mime;
  }
  return undefined;
}

function inferMime(params: { url: string; fallback: AttachmentKind }): string | undefined {
  return inferMimeFromDataUrl(params.url) ?? inferMimeFromExtension(params);
}



// --- attachments/snapshot-walk.helpers.ts ---


function readAttr(params: { node: Extract<DomSnapshotNode, { type: "element" }>; name: string }): string | undefined {
  return params.node.attributes[params.name];
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function textOnly(node: DomSnapshotNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textOnly).join("");
}

function isFileLink(node: Extract<DomSnapshotNode, { type: "element" }>): boolean {
  if (readAttr({ node, name: "download" }) !== undefined) return true;
  const href = readAttr({ node, name: "href" }) ?? "";
  const label = `${readAttr({ node, name: "aria-label" }) ?? ""} ${readAttr({ node, name: "data-testid" }) ?? ""}`.toLowerCase();
  return href.startsWith("blob:") || label.includes("download") || label.includes("file");
}

function attachmentFromImage(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "currentSrc" }) || readAttr({ node, name: "src" });
  if (!url) return null;
  return { kind: "image" as const, url, filename: optionalText(readAttr({ node, name: "alt" })), mime: inferMime({ url, fallback: "image" }) };
}

function attachmentFromIframe(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "src" });
  if (!url) return null;
  return {
    kind: "pdf" as const,
    url,
    filename: optionalText(readAttr({ node, name: "title" }) || readAttr({ node, name: "aria-label" })),
    mime: "application/pdf",
  };
}

function attachmentFromFileLink(node: Extract<DomSnapshotNode, { type: "element" }>) {
  const url = readAttr({ node, name: "href" });
  if (!url) return null;
  return {
    kind: "file" as const,
    url,
    filename: optionalText(readAttr({ node, name: "download" })) ?? optionalText(textOnly(node)),
    mime: inferMime({ url, fallback: "file" }),
  };
}

function attachmentFromElement(node: Extract<DomSnapshotNode, { type: "element" }>) {
  if (node.tagName === "img") return attachmentFromImage(node);
  if (node.tagName === "iframe") return attachmentFromIframe(node);
  if (node.tagName === "a" && isFileLink(node)) return attachmentFromFileLink(node);
  return null;
}



// --- attachments/snapshot-walk.ts ---



/** Convert a DOM snapshot into text with temporary attachment markers. */
function extractContentFromSnapshot(root: DomSnapshotNode): ExtractedContent {
  const attachments: AttachmentCandidate[] = [];
  const text = walkSnapshot({ node: root, attachments });
  return { text, attachments };
}

function walkSnapshot(params: { node: DomSnapshotNode; attachments: AttachmentCandidate[] }): string {
  if (params.node.type === "text") {
    return typeof params.node.text === "string" ? params.node.text : "";
  }
  const attachment = attachmentFromElement(params.node);
  if (attachment) {
    params.attachments.push(attachment);
    return markerFor(params.attachments.length - 1);
  }
  if (params.node.tagName === "br") return "\n";
  return params.node.children.map((child) => walkSnapshot({ node: child, attachments: params.attachments })).join("");
}

// --- connector.constants.ts ---
/** Default connector display name used when none is provided in setup options. */
const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

/** Prefix identifying bridge-owned connector apps in ChatGPT settings. */
const BRIDGE_CONNECTOR_PREFIX = "ai-browser-bridge";


// --- connector/accept-custom-mcp-risk.ts ---

/** Context for {@link isRiskCheckboxVisible}. */
interface IsRiskCheckboxVisibleContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** True when the custom MCP risk checkbox is visible in the form. */
async function isRiskCheckboxVisible(ctx: IsRiskCheckboxVisibleContext): Promise<boolean> {
  const checkbox = ctx.setup.page.locator('input[data-testid="trust-checkbox"], input[type="checkbox"]').first();
  if (await checkbox.count() === 0) return false;
  return checkbox.isVisible().catch(() => false);
}

/** Accept the custom MCP risk checkbox when ChatGPT shows it in the form. */
async function acceptCustomMcpRiskIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await isRiskCheckboxVisible({ setup: ctx })) return false;
  const checkbox = ctx.page.locator('input[data-testid="trust-checkbox"], input[type="checkbox"]').first();
  if (await checkbox.isChecked().catch(() => false)) return true;
  await checkbox.check({ force: true });
  return true;
}


// --- connector/append-unique-summary.ts ---


/** Context for {@link appendUniqueSummary}. */
interface AppendUniqueSummaryContext {
  /** Accumulated connector summaries. */
  summaries: ConnectorAppSummary[];
  /** Keys already collected while enumerating connectors. */
  seen: Set<string>;
  /** Candidate summary to append when unique. */
  summary: ConnectorAppSummary | null;
}

/** Append a summary when its deduplication key has not been seen. */
function appendUniqueSummary(ctx: AppendUniqueSummaryContext): void {
  if (!ctx.summary) return;
  const key = connectorSummaryKey({ summary: ctx.summary });
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.summaries.push(ctx.summary);
}


// --- connector/chatgpt-return-url.ts ---
/** Context for {@link chatGptReturnUrl}. */
interface ChatGptReturnUrlContext {
  /** Current browser URL to normalize into a restorable ChatGPT location. */
  url: string;
}

/** Normalize a ChatGPT URL into a conversation or home URL suitable for restoration. */
function chatGptReturnUrl(ctx: ChatGptReturnUrlContext): string | null {
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
}


// --- connector/cleanup-duplicate-connector-apps.ts ---





/** Context for {@link findDeleteTargets}. */
interface FindDeleteTargetsContext {
  /** Connector summaries currently listed in settings. */
  summaries: ConnectorAppSummary[];
  /** Desired connector display name. */
  connectorName: string;
  /** Desired connector MCP URL. */
  connectorUrl: string;
}

/** Select connector summaries that should be deleted as duplicates or stale entries. */
function findDeleteTargets(ctx: FindDeleteTargetsContext): ConnectorAppSummary[] {
  const current = ctx.summaries.find((summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl) ?? null;
  return ctx.summaries.filter((summary) => {
    if (summary.name !== ctx.connectorName) return true;
    if (summary.url !== ctx.connectorUrl) return true;
    return !!current && !sameConnectorApp({ a: summary, b: current });
  });
}

/** Remove duplicate bridge connector apps and return whether the desired connector exists. */
async function cleanupDuplicateConnectorApps(ctx: ConnectorSetupContext): Promise<boolean> {
  const summaries = await listBridgeConnectorSummaries({ page: ctx.page });
  const current = summaries.find((summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl) ?? null;
  await deleteDuplicateTargets({ setup: ctx, deleteTargets: findDeleteTargets({ summaries, connectorName: ctx.connectorName, connectorUrl: ctx.connectorUrl }) });
  await openConnectorList({ page: ctx.page });
  return !!current;
}


// --- connector/click-connector-details-button.ts ---


/** Context for {@link clickConnectorDetailsButton}. */
interface ClickConnectorDetailsButtonContext {
  /** Connector list button locator. */
  button: Locator;
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click a connector list button and record the opened step. */
async function clickConnectorDetailsButton(ctx: ClickConnectorDetailsButtonContext): Promise<void> {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.setup.page.waitForTimeout(1_000);
  ctx.setup.result.steps.push(`Opened existing connector: ${ctx.setup.connectorName}.`);
}


// --- connector/click-connector-entry-button.ts ---

/** Context for {@link clickConnectorEntryButton}. */
interface ClickConnectorEntryButtonContext {
  /** Connector list button locator. */
  button: Locator;
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click a connector list entry and wait for its detail panel. */
async function clickConnectorEntryButton(ctx: ClickConnectorEntryButtonContext): Promise<void> {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(1_000);
}


// --- connector/click-connector-from-more-menu.ts ---



/** Click the connector entry from the composer More submenu when needed. */
async function clickConnectorFromMoreMenu(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await hoverAndClickMoreMenuItem({ setup: ctx })) return false;
  return clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName });
}


// --- connector/click-connector-list-entry.ts ---




/** Context for {@link clickConnectorListEntry}. */
interface ClickConnectorListEntryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Zero-based connector button index in the list. */
  index: number;
}

/** Open one connector list entry by index. */
async function clickConnectorListEntry(ctx: ClickConnectorListEntryContext): Promise<boolean> {
  await openConnectorList({ page: ctx.page });
  const entry = (await findBridgeConnectorButtons({ page: ctx.page }))[ctx.index];
  if (!entry) return false;
  await clickConnectorEntryButton({ button: entry.button, page: ctx.page });
  return true;
}


// --- connector/click-connector-menu-item.ts ---

/** Context for {@link clickConnectorMenuItem}. */
interface ClickConnectorMenuItemContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector display name to click in the menu. */
  connectorName: string;
}

/** Click a connector entry in the composer plus-menu. */
async function clickConnectorMenuItem(ctx: ClickConnectorMenuItemContext): Promise<boolean> {
  const item = ctx.page.locator(`[role="menu"] [role="menuitem"]:has-text("${ctx.connectorName}"), [role="menu"] button:has-text("${ctx.connectorName}"), [role="menu"] :text-is("${ctx.connectorName}")`).last();
  if (!await item.isVisible().catch(() => false)) return false;
  await item.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(500);
  return true;
}


// --- connector/click-delete-confirmation.ts ---


/** Context for {@link clickDeleteConfirmation}. */
interface ClickDeleteConfirmationContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Confirm connector deletion in the alert or dialog that appears. */
async function clickDeleteConfirmation(ctx: ClickDeleteConfirmationContext): Promise<void> {
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
}


// --- connector/click-delete-menu-item.ts ---


/** Context for {@link clickDeleteMenuItem}. */
interface ClickDeleteMenuItemContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click Delete in the connector manage menu when visible. */
async function clickDeleteMenuItem(ctx: ClickDeleteMenuItemContext) {
  return firstVisible({
    page: ctx.page,
    selectors: [
      '[role="menu"] [role="menuitem"]:has-text("Delete")',
      '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
    ],
  });
}


// --- connector/click-more-menu-item.ts ---


/** Context for {@link clickMoreMenuItem}. */
interface ClickMoreMenuItemContext {
  /** More submenu item locator. */
  moreItem: Locator;
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Hover and click the More submenu entry in the composer menu. */
async function clickMoreMenuItem(ctx: ClickMoreMenuItemContext): Promise<void> {
  await ctx.moreItem.hover().catch(() => {});
  await ctx.moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await ctx.setup.page.waitForTimeout(750);
}


// --- connector/click-settings-entry.ts ---



/** Context for {@link clickSettingsEntry}. */
interface ClickSettingsEntryContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click Settings in the account menu and record the outcome. */
async function clickSettingsEntry(ctx: ClickSettingsEntryContext): Promise<void> {
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
}


// --- connector/close-settings-dialog.ts ---


/** Close the settings dialog when a close button is visible. */
async function closeSettingsDialogIfPresent(ctx: ConnectorSetupContext): Promise<void> {
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
}


// --- connector/confirm-open-connector-deletion.ts ---



/** Context for {@link clickDeleteMenuEntry}. */
interface ClickDeleteMenuEntryContext {
  /** Delete menu item locator. */
  deleteItem: Locator;
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Click the delete menu entry and confirm deletion. */
async function clickDeleteMenuEntry(ctx: ClickDeleteMenuEntryContext): Promise<void> {
  await ctx.deleteItem.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  await clickDeleteConfirmation({ page: ctx.page });
}

/** Context for {@link confirmOpenConnectorDeletion}. */
interface ConfirmOpenConnectorDeletionContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Confirm deletion for the currently open connector detail panel. */
async function confirmOpenConnectorDeletion(ctx: ConfirmOpenConnectorDeletionContext): Promise<boolean> {
  const deleteItem = await clickDeleteMenuItem({ page: ctx.page });
  if (!deleteItem) return false;
  await clickDeleteMenuEntry({ deleteItem, page: ctx.page });
  return true;
}


// --- connector/connector-composer-helpers.ts ---


/** Context for {@link findSelectedConnectorPill}. */
interface FindSelectedConnectorPillContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector display name to match in pill aria-labels. */
  connectorName: string;
}

/** Find the selected connector pill in the composer by aria-label. */
async function findSelectedConnectorPill(ctx: FindSelectedConnectorPillContext): Promise<Locator | null> {
  const buttons = await ctx.page.locator('button[aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (aria === `${ctx.connectorName}, click to remove`) return button;
  }
  return null;
}

/** Context for {@link isConnectorSelectedInComposer}. */
interface IsConnectorSelectedInComposerContext {
  /** Connector setup context with page and connector name. */
  setup: ConnectorSetupContext;
}

/** True when the desired connector pill is already selected in the composer. */
async function isConnectorSelectedInComposer(ctx: IsConnectorSelectedInComposerContext): Promise<boolean> {
  return !!await findSelectedConnectorPill({ page: ctx.setup.page, connectorName: ctx.setup.connectorName });
}

/** Remove stale bridge connector pills that are not the desired connector. */
async function removeStaleBridgeConnectorPills(ctx: ConnectorSetupContext): Promise<void> {
  const buttons = await ctx.page.locator('button[aria-label*="ai-browser-bridge"][aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (!aria || aria === `${ctx.connectorName}, click to remove`) continue;
    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(250);
  }
}


// --- connector/connector-summary-helpers.ts ---

/** Context for {@link normalizeConnectorListLabel}. */
interface NormalizeConnectorListLabelContext {
  /** Raw connector list button label text. */
  value: string;
}

/** Normalize connector list button labels for comparison. */
function normalizeConnectorListLabel(ctx: NormalizeConnectorListLabelContext): string {
  return normalizeDisplayText({ value: ctx.value })
    .replace(/\s+/g, "")
    .replace(/DEV$/i, "");
}

/** Context for {@link valueAfterLine}. */
interface ValueAfterLineContext {
  /** Dialog text split into trimmed lines. */
  lines: string[];
  /** Label line whose following value should be read. */
  label: string;
}

/** Read the line immediately following a label in dialog text. */
function valueAfterLine(ctx: ValueAfterLineContext): string | null {
  const index = ctx.lines.indexOf(ctx.label);
  const value = index >= 0 ? ctx.lines[index + 1] : null;
  return value?.trim() || null;
}

/** Context for {@link connectorSummaryKey}. */
interface ConnectorSummaryKeyContext {
  /** Connector app summary to key. */
  summary: { name: string; appId: string | null; url: string | null };
}

/** Build a deduplication key for connector summaries. */
function connectorSummaryKey(ctx: ConnectorSummaryKeyContext): string {
  return `${ctx.summary.name}\u0000${ctx.summary.appId ?? ""}\u0000${ctx.summary.url ?? ""}`;
}

/** Context for {@link sameConnectorApp}. */
interface SameConnectorAppContext {
  /** First connector summary. */
  a: { appId: string | null; name: string; url: string | null };
  /** Second connector summary. */
  b: { appId: string | null; name: string; url: string | null };
}

/** True when two connector summaries refer to the same app. */
function sameConnectorApp(ctx: SameConnectorAppContext): boolean {
  if (ctx.a.appId && ctx.b.appId) return ctx.a.appId === ctx.b.appId;
  return ctx.a.name === ctx.b.name && ctx.a.url === ctx.b.url;
}


// --- connector/connector.types.ts ---


/** Mutable context passed through connector setup steps. */
interface ConnectorSetupContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** MCP connector URL to register in ChatGPT settings. */
  connectorUrl: string;
  /** Connector setup options from the caller. */
  options: ConnectorSetupOptions;
  /** Connector display name resolved from options or defaults. */
  connectorName: string;
  /** URL to restore after automatic setup attempts. */
  returnUrl: string | null;
  /** Accumulated setup result returned to the caller. */
  result: ConnectorSetupResult;
}

/** State of an existing connector relative to the desired URL. */
type ExistingConnectorState = "missing" | "current" | "stale" | "unknown";

/** Summary of a bridge connector app listed in ChatGPT settings. */
interface ConnectorAppSummary {
  /** Connector display name shown in settings. */
  name: string;
  /** ChatGPT-assigned app id, when readable from the panel. */
  appId: string | null;
  /** Registered MCP endpoint URL, when readable from the panel. */
  url: string | null;
}


// --- connector/create-new-connector.ts ---







/** Context for {@link warnMissingConnectorUrlField}. */
interface WarnMissingConnectorUrlFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Record a warning and optionally restore the page when the URL field is missing. */
async function warnMissingConnectorUrlField(ctx: WarnMissingConnectorUrlFieldContext): Promise<void> {
  ctx.setup.result.warnings.push("Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.");
  if (ctx.setup.options.automatic) await restoreAfterConnectorSetup(ctx.setup);
}

/** Create a new connector through the settings UI form. */
async function createNewConnector(ctx: ConnectorSetupContext): Promise<void> {
  await openAdvancedSettingsIfPresent(ctx);
  await enableDeveloperModeIfPresent(ctx);
  await openCreateConnectorForm(ctx);
  if (!await fillConnectorFormFields(ctx)) {
    await warnMissingConnectorUrlField({ setup: ctx });
    return;
  }
  await finishConnectorCreation({ setup: ctx });
}


// --- connector/delete-connector-app-by-summary.ts ---






/** Context for {@link deleteConnectorAppBySummary}. */
interface DeleteConnectorAppBySummaryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector summary identifying the app to delete. */
  target: ConnectorAppSummary;
}

/** Delete one connector app by locating and opening its summary panel. */
async function deleteConnectorAppBySummary(ctx: DeleteConnectorAppBySummaryContext): Promise<boolean> {
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
}


// --- connector/delete-duplicate-targets.ts ---


/** Context for {@link deleteDuplicateTargets}. */
interface DeleteDuplicateTargetsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Connector summaries that should be deleted. */
  deleteTargets: ConnectorAppSummary[];
}

/** Delete duplicate connector apps and record steps or warnings. */
async function deleteDuplicateTargets(ctx: DeleteDuplicateTargetsContext): Promise<void> {
  for (const target of ctx.deleteTargets) {
    const deleted = await deleteConnectorAppBySummary({ page: ctx.setup.page, target });
    if (deleted) {
      ctx.setup.result.steps.push(`Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`);
    } else {
      ctx.setup.result.warnings.push(`Could not delete duplicate connector app: ${target.name}.`);
    }
  }
}


// --- connector/delete-open-connector.ts ---



/** Context for {@link deleteOpenConnectorIfPresent}. */
interface DeleteOpenConnectorIfPresentContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Delete the currently open connector via Manage -> Delete when available. */
async function deleteOpenConnectorIfPresent(ctx: DeleteOpenConnectorIfPresentContext): Promise<boolean> {
  const manage = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Manage")'],
  });
  if (!manage) return false;
  await manage.click({ timeout: 2_000, force: true });
  await ctx.page.waitForTimeout(500);
  return confirmOpenConnectorDeletion({ page: ctx.page });
}


// --- connector/enable-developer-mode.dom-snippet.ts ---
/** In-page script that toggles Developer mode when present in settings. */
const ENABLE_DEVELOPER_MODE_SNIPPET = `() => {
  const labels = Array.from(document.querySelectorAll("body *"))
    .filter((node) => /Developer mode/i.test(node.textContent ?? ""));

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


// --- connector/enable-developer-mode.ts ---


/** Enable Developer mode via in-page toggle discovery when available. */
async function enableDeveloperModeIfPresent(ctx: ConnectorSetupContext): Promise<void> {
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
  ctx.result.warnings.push("Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.");
}


// --- connector/ensure-composer-connector-selected.ts ---


/** Ensure the desired connector is selected in the composer, opening the menu if needed. */
async function ensureComposerConnectorSelected(ctx: ConnectorSetupContext): Promise<boolean> {
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  await removeStaleBridgeConnectorPills(ctx);
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  return openComposerConnectorMenu(ctx);
}


// --- connector/execute-connector-setup.ts ---







/** Context for {@link runConnectorSetupSteps}. */
interface RunConnectorSetupStepsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Whether duplicate cleanup already found the current connector. */
  hasCurrentConnector: boolean;
}

/** Run post-settings connector setup steps after the settings panels are open. */
async function runConnectorSetupSteps(ctx: RunConnectorSetupStepsContext): Promise<ConnectorSetupContext["result"]> {
  if (await tryFinalizeExistingConnector({ setup: ctx.setup, hasCurrentConnector: ctx.hasCurrentConnector })) {
    return ctx.setup.result;
  }
  if (!await handleStaleExistingConnector(ctx.setup)) return ctx.setup.result;
  await createNewConnector(ctx.setup);
  return ctx.setup.result;
}

/** Run the full ChatGPT connector setup workflow. */
async function executeConnectorSetup(ctx: ConnectorSetupContext): Promise<ConnectorSetupContext["result"]> {
  await openChatGptSettings(ctx);
  await openAppsOrConnectorsPanel(ctx);
  const hasCurrentConnector = await cleanupDuplicateConnectorApps(ctx);
  return runConnectorSetupSteps({ setup: ctx, hasCurrentConnector });
}


// --- connector/fill-connector-form-fields.ts ---


/** Context for {@link fillConnectorUrlField}. */
interface FillConnectorUrlFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Fill the connector URL field and record a setup step when successful. */
async function fillConnectorUrlField(ctx: FillConnectorUrlFieldContext): Promise<boolean> {
  const filledUrl = await fillFirstVisible({
    page: ctx.setup.page,
    selectors: [
      'input[name="custom-connector-url"]',
      '#custom-connector-url',
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
}

/** Context for {@link fillConnectorNameField}. */
interface FillConnectorNameFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Fill the connector name field and record a setup step when successful. */
async function fillConnectorNameField(ctx: FillConnectorNameFieldContext): Promise<void> {
  const filledName = await fillFirstVisible({
    page: ctx.setup.page,
    selectors: [
      'input[name="custom-connector-name"]',
      '#custom-connector-name',
      'input[name*="name" i]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
    ],
    value: ctx.setup.connectorName,
  });
  if (filledName) ctx.setup.result.steps.push(`Filled connector name: ${ctx.setup.connectorName}`);
}

/** Fill connector URL and name fields in the creation form. */
async function fillConnectorFormFields(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await fillConnectorUrlField({ setup: ctx })) return false;
  await fillConnectorNameField({ setup: ctx });
  return true;
}


// --- connector/finalize-current-connector.ts ---



/** Finalize setup when an existing connector already uses the current URL. */
async function finalizeCurrentConnector(ctx: ConnectorSetupContext): Promise<void> {
  ctx.result.completed = true;
  ctx.result.steps.push("Existing connector already uses the current URL.");
  if (await refreshOpenConnectorIfPresent(ctx)) {
    ctx.result.steps.push("Refreshed the connector tool schema.");
  }
  await selectConnectorAfterSetup(ctx);
}


// --- connector/find-bridge-connector-buttons.ts ---




/** Context for {@link findBridgeConnectorButtons}. */
interface FindBridgeConnectorButtonsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Find bridge connector buttons in the open settings dialog. */
async function findBridgeConnectorButtons(ctx: FindBridgeConnectorButtonsContext): Promise<Array<{ button: Locator; name: string }>> {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  const entries: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label.startsWith(BRIDGE_CONNECTOR_PREFIX)) {
      entries.push({ button, name: label });
    }
  }
  return entries;
}


// --- connector/find-connector-button.ts ---



/** Context for {@link findConnectorButton}. */
interface FindConnectorButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Connector display name to locate in the list. */
  connectorName: string;
}

/** Find a connector list button by exact normalized label. */
async function findConnectorButton(ctx: FindConnectorButtonContext): Promise<Locator | null> {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label === ctx.connectorName) return button;
  }
  return null;
}

/** Context for {@link waitForConnectorButton}. */
interface WaitForConnectorButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Connector display name to wait for. */
  connectorName: string;
  /** Maximum wait time in milliseconds. */
  timeoutMs: number;
}

/** Poll until a connector button becomes visible in settings. */
async function waitForConnectorButton(ctx: WaitForConnectorButtonContext): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeoutMs) {
    const button = await findConnectorButton({ page: ctx.page, connectorName: ctx.connectorName });
    if (button && await button.isVisible().catch(() => false)) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
}


// --- connector/finish-connector-creation.ts ---





/** Context for {@link recordConnectorFormOptions}. */
interface RecordConnectorFormOptionsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Record optional auth and risk acceptance steps before submit. */
async function recordConnectorFormOptions(ctx: RecordConnectorFormOptionsContext): Promise<void> {
  if (await selectNoAuthenticationIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Selected no-authentication option when visible.");
  }
  if (await acceptCustomMcpRiskIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Accepted custom MCP server risk notice.");
  }
}

/** Context for {@link finishConnectorCreation}. */
interface FinishConnectorCreationContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Submit the connector form and restore the page on automatic failure. */
async function finishConnectorCreation(ctx: FinishConnectorCreationContext): Promise<void> {
  await recordConnectorFormOptions({ setup: ctx.setup });
  await submitConnectorForm(ctx.setup);
  if (ctx.setup.options.automatic && !ctx.setup.result.completed) {
    await restoreAfterConnectorSetup(ctx.setup);
  }
}


// --- connector/handle-stale-existing-connector.ts ---







/** Handle stale or unknown existing connectors before creating a new one. */
async function handleStaleExistingConnector(ctx: ConnectorSetupContext): Promise<boolean> {
  const existing = await openExistingConnectorDetails(ctx);
  if (existing === "stale") return deleteStaleConnector(ctx);
  if (existing === "unknown") {
    ctx.result.warnings.push("Existing connector was found, but its URL could not be read from the settings panel.");
  }
  return true;
}

/** Delete a stale connector and reopen the connectors panel for recreation. */
async function deleteStaleConnector(ctx: ConnectorSetupContext): Promise<boolean> {
  if (await deleteOpenConnectorIfPresent({ page: ctx.page })) {
    ctx.result.steps.push("Deleted stale connector app before recreating it with the new tunnel URL.");
    await returnToConnectorListIfNeeded(ctx);
    await openAppsOrConnectorsPanel(ctx);
    await openAdvancedSettingsIfPresent(ctx);
    return true;
  }
  ctx.result.warnings.push("Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.");
  if (ctx.options.automatic) await restoreAfterConnectorSetup(ctx);
  return false;
}


// --- connector/hover-and-click-more-menu-item.ts ---



/** Context for {@link hoverAndClickMoreMenuItem}. */
interface HoverAndClickMoreMenuItemContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Hover and click the More submenu entry in the composer menu. */
async function hoverAndClickMoreMenuItem(ctx: HoverAndClickMoreMenuItemContext): Promise<boolean> {
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
}


// --- connector/init-connector-setup-context.ts ---





/** Input for initializing a connector setup context. */
interface InitConnectorSetupContextInput {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** MCP connector URL to register in ChatGPT settings. */
  connectorUrl: string;
  /** Connector setup options from the caller. */
  options: ConnectorSetupOptions;
}

/** Build a fully initialized connector setup context. */
function initConnectorSetupContext(input: InitConnectorSetupContextInput): ConnectorSetupContext {
  const connectorName = input.options.connectorName ?? DEFAULT_CONNECTOR_NAME;
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
}


// --- connector/list-bridge-connector-summaries.ts ---






/** Context for {@link collectConnectorSummaries}. */
interface CollectConnectorSummariesContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Number of connector buttons currently listed. */
  entryCount: number;
}

/** Collect unique connector summaries by opening each listed connector. */
async function collectConnectorSummaries(ctx: CollectConnectorSummariesContext): Promise<ConnectorAppSummary[]> {
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
}

/** Context for {@link listBridgeConnectorSummaries}. */
interface ListBridgeConnectorSummariesContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Enumerate all bridge connector apps listed in ChatGPT settings. */
async function listBridgeConnectorSummaries(ctx: ListBridgeConnectorSummariesContext): Promise<ConnectorAppSummary[]> {
  await openConnectorList({ page: ctx.page });
  const entryCount = (await findBridgeConnectorButtons({ page: ctx.page })).length;
  const summaries = await collectConnectorSummaries({ page: ctx.page, entryCount });
  await openConnectorList({ page: ctx.page });
  return summaries;
}


// --- connector/open-advanced-settings.ts ---


/** Open Advanced settings when the control is visible in the connectors panel. */
async function openAdvancedSettingsIfPresent(ctx: ConnectorSetupContext): Promise<void> {
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
}


// --- connector/open-apps-or-connectors-panel.ts ---


/** Open the Apps or Connectors panel inside ChatGPT settings. */
async function openAppsOrConnectorsPanel(ctx: ConnectorSetupContext): Promise<void> {
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
    ctx.result.warnings.push("Could not find Apps/Connectors in settings. Use Settings -> Apps manually.");
  }
}


// --- connector/open-chatgpt-settings.ts ---


/** Open ChatGPT settings, preferring the Connectors deep link. */
async function openChatGptSettings(ctx: ConnectorSetupContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForTimeout(1_500);
  const settingsDialogOpen = await ctx.page.locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")').first()
    .isVisible()
    .catch(() => false);
  if (settingsDialogOpen) {
    ctx.result.steps.push("Opened ChatGPT settings.");
    return;
  }
  await openSettingsFromAccountMenu(ctx);
}


// --- connector/open-composer-connector-menu.ts ---




/** Context for {@link openComposerPlusMenu}. */
interface OpenComposerPlusMenuContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Open the composer plus-menu for connector selection. */
async function openComposerPlusMenu(ctx: OpenComposerPlusMenuContext): Promise<boolean> {
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
}

/** Open the composer plus-menu and choose the connector, including More submenu. */
async function openComposerConnectorMenu(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await openComposerPlusMenu({ setup: ctx })) return false;
  if (await clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName })) return true;
  return clickConnectorFromMoreMenu(ctx);
}


// --- connector/open-connector-details-panel.ts ---



/** Context for {@link openConnectorDetailsPanel}. */
interface OpenConnectorDetailsPanelContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click an existing connector in the list and open its detail panel. */
async function openConnectorDetailsPanel(ctx: OpenConnectorDetailsPanelContext): Promise<boolean> {
  const button = await findConnectorButton({ page: ctx.setup.page, connectorName: ctx.setup.connectorName });
  if (!button) return false;
  await clickConnectorDetailsButton({ button, setup: ctx.setup });
  return true;
}


// --- connector/open-connector-list.ts ---


/** Context for {@link openConnectorList}. */
interface OpenConnectorListContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Navigate to the connector list and back out of any open detail panel. */
async function openConnectorList(ctx: OpenConnectorListContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForTimeout(1_000);
  const backButton = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
}


// --- connector/open-create-connector-form.ts ---


/** Open the connector/app creation form from settings. */
async function openCreateConnectorForm(ctx: ConnectorSetupContext): Promise<void> {
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
    ctx.result.warnings.push("Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.");
  }
}


// --- connector/open-existing-connector-details.ts ---



/** Context for {@link readConnectorState}. */
interface ReadConnectorStateContext {
  /** Connector setup context with page and connector identifiers. */
  setup: ConnectorSetupContext;
}

/** Read the current open connector state for the desired connector. */
function readConnectorState(ctx: ReadConnectorStateContext) {
  return readOpenConnectorState({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    connectorUrl: ctx.setup.connectorUrl,
  });
}

/** Open an existing connector's detail panel and classify its URL state. */
async function openExistingConnectorDetails(ctx: ConnectorSetupContext): Promise<ExistingConnectorState> {
  const alreadyOpen = await readConnectorState({ setup: ctx });
  if (alreadyOpen !== "missing") return alreadyOpen;
  if (!await openConnectorDetailsPanel({ setup: ctx })) return "missing";
  return readConnectorState({ setup: ctx });
}


// --- connector/open-settings-from-account-menu.ts ---




/** Open ChatGPT settings through the account menu when the deep link fails. */
async function openSettingsFromAccountMenu(ctx: ConnectorSetupContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
  if (!await clickFirstVisible({ page: ctx.page, selectors: SELECTORS.accountMenuButton, timeout: 2_000 })) {
    ctx.result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }
  ctx.result.steps.push("Opened ChatGPT account menu.");
  await clickSettingsEntry({ setup: ctx });
}


// --- connector/read-connector-summary-at-index.ts ---



/** Context for {@link readConnectorSummaryAtIndex}. */
interface ReadConnectorSummaryAtIndexContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Zero-based connector button index in the list. */
  index: number;
}

/** Open one connector by index and read its summary panel. */
async function readConnectorSummaryAtIndex(ctx: ReadConnectorSummaryAtIndexContext) {
  if (!await clickConnectorListEntry({ page: ctx.page, index: ctx.index })) return null;
  return readOpenConnectorSummary({ page: ctx.page });
}


// --- connector/read-open-connector-state.ts ---



/** Context for {@link readOpenConnectorState}. */
interface ReadOpenConnectorStateContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Expected connector display name. */
  connectorName: string;
  /** Desired connector MCP URL. */
  connectorUrl: string;
}

/** Classify the open connector panel relative to the desired connector URL. */
async function readOpenConnectorState(ctx: ReadOpenConnectorStateContext): Promise<ExistingConnectorState> {
  const text = await settingsDialogText({ page: ctx.page });
  if (!text.includes(ctx.connectorName) || !/\b(URL|App Id|Version Id)\b/i.test(text)) return "missing";
  if (text.includes(ctx.connectorUrl)) return "current";
  if (/\bURL\s+https?:\/\//i.test(text)) return "stale";
  return "unknown";
}


// --- connector/read-open-connector-summary.ts ---




/** Context for {@link parseConnectorSummaryLines}. */
interface ParseConnectorSummaryLinesContext {
  /** Dialog text split into trimmed lines. */
  lines: string[];
}

/** Parse connector name and metadata lines from an open settings dialog. */
function parseConnectorSummaryLines(ctx: ParseConnectorSummaryLinesContext): ConnectorAppSummary | null {
  const backIndex = ctx.lines.indexOf("Back");
  const name = backIndex >= 0 ? ctx.lines[backIndex + 1] ?? "" : "";
  if (!name.startsWith(BRIDGE_CONNECTOR_PREFIX)) return null;
  return {
    name,
    appId: valueAfterLine({ lines: ctx.lines, label: "App Id" }),
    url: valueAfterLine({ lines: ctx.lines, label: "URL" }),
  };
}

/** Context for {@link readOpenConnectorSummary}. */
interface ReadOpenConnectorSummaryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read connector details from the currently open settings dialog. */
async function readOpenConnectorSummary(ctx: ReadOpenConnectorSummaryContext): Promise<ConnectorAppSummary | null> {
  const text = await ctx.page.locator('[role="dialog"]').last().innerText().catch(() => "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return parseConnectorSummaryLines({ lines });
}


// --- connector/refresh-open-connector.ts ---


/** Refresh the currently open connector tool schema when the button is visible. */
async function refreshOpenConnectorIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  return clickFirstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: 1_000,
  });
}


// --- connector/restore-after-connector-setup.ts ---



/** Close settings and restore the pre-setup URL after a failed automatic setup. */
async function restoreAfterConnectorSetup(ctx: ConnectorSetupContext): Promise<void> {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
}


// --- connector/restore-return-url.ts ---



/** Restore the pre-setup ChatGPT URL and wait for the composer when needed. */
async function restoreReturnUrlIfNeeded(ctx: ConnectorSetupContext): Promise<void> {
  if (ctx.returnUrl && chatGptReturnUrl({ url: ctx.page.url() }) !== ctx.returnUrl) {
    await ctx.page.goto(ctx.returnUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
}


// --- connector/return-to-connector-list.ts ---


/** Navigate back to the connector list from a detail panel when Back is visible. */
async function returnToConnectorListIfNeeded(ctx: ConnectorSetupContext): Promise<void> {
  const back = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
}


// --- connector/select-connector-after-setup.ts ---


/** Select the connector in the composer after settings setup completes. */
async function selectConnectorAfterSetup(ctx: ConnectorSetupContext): Promise<void> {
  const selectedInComposer = await selectConnectorInComposer(ctx);
  if (selectedInComposer) {
    ctx.result.steps.push("Selected the connector in the composer.");
  } else {
    ctx.result.warnings.push("Connector is configured, but the composer menu did not expose it for automatic selection.");
  }
}


// --- connector/select-connector-in-composer.ts ---




/** Select the configured connector in the ChatGPT composer plus-menu. */
async function selectConnectorInComposer(ctx: ConnectorSetupContext): Promise<boolean> {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
  await ctx.page.keyboard.press("Escape").catch(() => {});
  return ensureComposerConnectorSelected(ctx);
}


// --- connector/select-no-authentication.ts ---


/** Select the no-authentication option in the connector form when present. */
async function selectNoAuthenticationIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  const authSelect = ctx.page.locator("select#custom-connector-auth").first();
  if (await authSelect.count() > 0 && await authSelect.isVisible().catch(() => false)) {
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
}


// --- connector/settings-dialog-text.ts ---


/** Context for {@link settingsDialogText}. */
interface SettingsDialogTextContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read normalized text from the last open settings dialog. */
async function settingsDialogText(ctx: SettingsDialogTextContext): Promise<string> {
  return normalizeDisplayText({
    value: await ctx.page.locator('[role="dialog"]').last().innerText().catch(() => ""),
  });
}


// --- connector/setup-connector.ts ---




/** Best-effort ChatGPT Developer Mode connector setup through the browser UI. */
async function setupMcpConnectorInChatGpt(
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> {
  return executeConnectorSetup(initConnectorSetupContext({ page, connectorUrl, options }));
}


// --- connector/submit-connector-form.ts ---




/** Context for {@link connectorFormStillOpen}. */
interface ConnectorFormStillOpenContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** True when the connector URL field is still visible after submit. */
async function connectorFormStillOpen(ctx: ConnectorFormStillOpenContext): Promise<boolean> {
  return ctx.setup.page.locator('input[name="custom-connector-url"], #custom-connector-url').first()
    .isVisible()
    .catch(() => false);
}

/** Context for {@link markConnectorSubmitCompleted}. */
interface MarkConnectorSubmitCompletedContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Mark connector setup complete and select the connector in the composer. */
async function markConnectorSubmitCompleted(ctx: MarkConnectorSubmitCompletedContext): Promise<void> {
  ctx.setup.result.completed = true;
  ctx.setup.result.steps.push("Submitted the connector form.");
  await selectConnectorAfterSetup(ctx.setup);
}

/** Context for {@link warnConnectorSubmitIncomplete}. */
interface WarnConnectorSubmitIncompleteContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Warn when the connector form remains open after submit. */
async function warnConnectorSubmitIncomplete(ctx: WarnConnectorSubmitIncompleteContext): Promise<void> {
  const appVisible = await waitForConnectorButton({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    timeoutMs: 20_000,
  });
  const formStillOpen = await connectorFormStillOpen({ setup: ctx.setup });
  if (formStillOpen && !appVisible) {
    ctx.setup.result.warnings.push("Connector form is still open after submit. Check the visible validation message in ChatGPT settings.");
    return;
  }
  await markConnectorSubmitCompleted({ setup: ctx.setup });
}

/** Submit the connector creation form and finalize the setup result. */
async function submitConnectorForm(ctx: ConnectorSetupContext): Promise<void> {
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
    ctx.result.warnings.push("Connector form was filled, but no Create/Save/Add button was visible or enabled.");
    return;
  }
  await warnConnectorSubmitIncomplete({ setup: ctx });
}


// --- connector/try-finalize-existing-connector.ts ---



/** Context for {@link finalizeIfCurrentConnector}. */
interface FinalizeIfCurrentConnectorContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Open existing connector details and finalize when the URL already matches. */
async function finalizeIfCurrentConnector(ctx: FinalizeIfCurrentConnectorContext): Promise<boolean> {
  const existing = await openExistingConnectorDetails(ctx.setup);
  if (existing !== "current") return false;
  await finalizeCurrentConnector(ctx.setup);
  return true;
}

/** Context for {@link tryFinalizeExistingConnector}. */
interface TryFinalizeExistingConnectorContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Whether duplicate cleanup already found the current connector. */
  hasCurrentConnector: boolean;
}

/** Attempt to finalize when an existing connector already matches the desired URL. */
async function tryFinalizeExistingConnector(ctx: TryFinalizeExistingConnectorContext): Promise<boolean> {
  if (ctx.hasCurrentConnector && await finalizeIfCurrentConnector({ setup: ctx.setup })) return true;
  return finalizeIfCurrentConnector({ setup: ctx.setup });
}


// --- conversation/capture-all-messages.ts ---



/** Extract all messages from the current conversation in DOM order. */
async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
  return extractAllMessages(page, { conversationId: conversationIdFromPage({ page }) });
}


// --- conversation/capture-last-response.ts ---




function sanitizeCapturedText(value: string): string {
  return value.replace(/\s*\[object Object\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract the text content of the last assistant response. */
async function captureLastResponse(page: Page): Promise<string> {
  const { text } = await extractAssistantContent(page, {
    conversationId: conversationIdFromPage({ page }),
  });
  const cleaned = sanitizeCapturedText(text);
  if (cleaned && !/\[object Object\]/.test(text)) return cleaned;

  const fallback = await page
    .locator(SELECTORS.lastResponse)
    .last()
    .innerText()
    .catch(() => "");
  return sanitizeCapturedText(fallback) || cleaned;
}


// --- conversation/conversation-id-from-page.ts ---

/** Context for {@link conversationIdFromPage}. */
interface ConversationIdFromPageContext {
  /** Playwright page handle whose URL may contain a conversation id. */
  page: Page;
}

/** Extract the `/c/{id}` segment from the current page URL, or `"current"`. */
function conversationIdFromPage(ctx: ConversationIdFromPageContext): string {
  const match = /\/c\/([^/?#]+)/.exec(ctx.page.url());
  return match?.[1] ?? "current";
}


// --- conversation/count-assistant-responses.ts ---


/** Count assistant responses currently rendered in the conversation. */
async function countAssistantResponses(page: Page): Promise<number> {
  return page.locator(SELECTORS.responseBlock).count();
}


// --- conversation/navigate-to-conversation.ts ---

/** Navigate to a specific conversation by URL. */
async function navigateToConversation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}


// --- conversation/new-conversation.ts ---

/** Start a new ChatGPT conversation. */
async function newConversation(page: Page): Promise<void> {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}


// --- conversation/parse-sidebar-link.ts ---

/** A sidebar conversation entry parsed from a nav link. */
interface SidebarConversationEntry {
  /** Conversation id from the URL path segment. */
  id: string;
  /** Visible title text from the sidebar link. */
  title: string;
  /** Absolute ChatGPT URL for the conversation. */
  url: string;
}

/** Context for {@link parseSidebarLink}. */
interface ParseSidebarLinkContext {
  /** Sidebar conversation link locator. */
  link: Locator;
}

/** Parse one sidebar link into a conversation entry, or null when incomplete. */
async function parseSidebarLink(ctx: ParseSidebarLinkContext): Promise<SidebarConversationEntry | null> {
  const href = await ctx.link.getAttribute("href");
  const title = await ctx.link.innerText();
  if (!href || !title) return null;
  const id = href.split("/").pop() ?? "";
  return { id, title: title.trim(), url: `https://chatgpt.com${href}` };
}


// --- conversation/read-sidebar-conversations.ts ---



/** Read the conversation list from the sidebar. */
async function readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const entry = await parseSidebarLink({ link });
    if (entry) conversations.push(entry);
  }
  return conversations;
}


// --- dom/click-first-visible.ts ---


/** Context for {@link clickFirstVisible}. */
interface ClickFirstVisibleContext {
  /** Playwright page handle to search within. */
  page: Page;
  /** Candidate selectors to click in order. */
  selectors: readonly string[];
  /** Per-selector visibility wait timeout in milliseconds. */
  timeout?: number;
}

/** Click the first visible element matching any selector; return whether a click succeeded. */
async function clickFirstVisible(ctx: ClickFirstVisibleContext): Promise<boolean> {
  const timeout = ctx.timeout ?? 1_000;
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout }).catch(() => {});
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {
        try {
          await locator.click({ timeout, force: true });
          return true;
        } catch {
          continue;
        }
      }
    }
  }
  return false;
}


// --- dom/fill-first-visible.ts ---


/** Context for {@link fillFirstVisible}. */
interface FillFirstVisibleContext {
  /** Playwright page handle to search within. */
  page: import("playwright").Page;
  /** Candidate field selectors to fill in order. */
  selectors: readonly string[];
  /** Value to write into the first visible field. */
  value: string;
}

/** Context for {@link fillVisibleField}. */
interface FillVisibleFieldContext {
  /** Visible input locator to fill. */
  field: Locator;
  /** Value to write into the field. */
  value: string;
}

/** Fill one visible field and dispatch input/change events. */
async function fillVisibleField(ctx: FillVisibleFieldContext): Promise<void> {
  await ctx.field.fill(ctx.value);
  await ctx.field.dispatchEvent("input").catch(() => {});
  await ctx.field.dispatchEvent("change").catch(() => {});
}

/** Fill the first visible input matching any selector; return whether a field was filled. */
async function fillFirstVisible(ctx: FillFirstVisibleContext): Promise<boolean> {
  const field = await firstVisible({ page: ctx.page, selectors: ctx.selectors });
  if (!field) return false;
  await fillVisibleField({ field, value: ctx.value });
  return true;
}


// --- dom/first-visible-in.ts ---

/** Context for {@link firstVisibleIn}. */
interface FirstVisibleInContext {
  /** Parent locator to search within. */
  parent: Locator;
  /** Candidate selectors to probe in order. */
  selectors: readonly string[];
}

/** Return the first visible child locator matching any selector, or null. */
async function firstVisibleIn(ctx: FirstVisibleInContext): Promise<Locator | null> {
  for (const selector of ctx.selectors) {
    const locator = ctx.parent.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}


// --- dom/first-visible.ts ---


/** Context for {@link firstVisible}. */
interface FirstVisibleContext {
  /** Playwright page handle to search within. */
  page: Page;
  /** Candidate selectors to probe in order. */
  selectors: readonly string[];
}

/** Return the first visible locator matching any selector, or null. */
async function firstVisible(ctx: FirstVisibleContext): Promise<Locator | null> {
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}


// --- dom/normalize-display-text.ts ---
/** Context for {@link normalizeDisplayText}. */
interface NormalizeDisplayTextContext {
  /** Raw text pulled from the ChatGPT DOM. */
  value: string;
}

/** Collapse whitespace and strip "(current|selected)" markers from UI labels. */
function normalizeDisplayText(ctx: NormalizeDisplayTextContext): string {
  return ctx.value
    .replace(/\s+/g, " ")
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
}


// --- dom/normalize-model-query.ts ---
/** Context for {@link normalizeModelQuery}. */
interface NormalizeModelQueryContext {
  /** User-supplied or DOM-derived model label or id. */
  value: string;
}

/** Normalize a model query string for fuzzy matching against menu items. */
function normalizeModelQuery(ctx: NormalizeModelQueryContext): string {
  return ctx.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// --- guest-session-error.ts ---
// GuestSessionError exported at top of file.


// --- model/click-model-and-detect.ts ---




/** Context for {@link clickModelAndDetect}. */
interface ClickModelAndDetectContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Model menu item to click. */
  item: Locator;
}

/** Click a model item, wait for the menu to close, and return the detected model. */
async function clickModelAndDetect(ctx: ClickModelAndDetectContext): Promise<string> {
  await ctx.item.click();
  await ctx.page.locator(SELECTORS.openMenu).waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  await ctx.page.waitForTimeout(500);
  return detectCurrentModel(ctx.page);
}


// --- model/collect-models-from-items.ts ---




/** Context for {@link collectModelsFromItems}. */
interface CollectModelsFromItemsContext {
  /** Model menu item locators to parse. */
  items: Locator[];
}

/** Parse menu items into a deduplicated model option list. */
async function collectModelsFromItems(ctx: CollectModelsFromItemsContext): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  for (const item of ctx.items) {
    const option = await parseModelMenuItem({ item });
    if (option && !models.some((model) => model.id === option.id && model.label === option.label)) {
      models.push(option);
    }
  }
  return models;
}

/** Context for {@link closeModelMenu}. */
interface CloseModelMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Dismiss the open model menu with Escape. */
async function closeModelMenu(ctx: CloseModelMenuContext): Promise<void> {
  await ctx.page.keyboard.press("Escape").catch(() => {});
}


// --- model/detect-checked-model-from-menu.ts ---



/** Context for {@link detectCheckedModelFromMenuOnce}. */
interface DetectCheckedModelFromMenuOnceContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Try once to read the checked model from the model menu. */
async function detectCheckedModelFromMenuOnce(ctx: DetectCheckedModelFromMenuOnceContext): Promise<string | null> {
  try {
    await openModelMenu({ page: ctx.page });
    const checkedModel = await readCheckedModelFromOpenMenu({ page: ctx.page });
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return checkedModel;
  } catch {
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return null;
  }
}

/** Context for {@link detectCheckedModelFromMenu}. */
interface DetectCheckedModelFromMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Retry opening the model menu until a checked model label is found. */
async function detectCheckedModelFromMenu(ctx: DetectCheckedModelFromMenuContext): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: ctx.page });
    if (checkedModel) return checkedModel;
    await ctx.page.waitForTimeout(750);
  }
  return null;
}


// --- model/detect-current-model.ts ---




/** Detect the currently selected ChatGPT model from the page DOM. */
async function detectCurrentModel(page: Page): Promise<string> {
  try {
    const fromDom = await readCheckedModelFromDom({ page });
    if (fromDom) return fromDom;
    const fromTrigger = await readModelFromTrigger({ page });
    if (fromTrigger) return fromTrigger;
    const fromMenu = await detectCheckedModelFromMenu({ page });
    return fromMenu ?? "ChatGPT";
  } catch {
    return "ChatGPT";
  }
}


// --- model/find-model-menu-match.ts ---




/** Context for {@link findModelMenuMatch}. */
interface FindModelMenuMatchContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Find the first matching model menu item, tracking a fuzzy fallback. */
async function findModelMenuMatch(ctx: FindModelMenuMatchContext): Promise<Locator | null> {
  const items = await modelMenuItems(ctx.page);
  let fallback: Locator | null = null;
  for (const item of items) {
    const result = await modelItemMatchesQuery({ item, normalizedQuery: ctx.normalizedQuery });
    if (result.matched) return item;
    if (!fallback && result.fallback) fallback = result.fallback;
  }
  return fallback;
}


// --- model/is-likely-model-label.ts ---
/** True when a string looks like a real ChatGPT model name (vs. arbitrary UI text). */
function isLikelyModelLabel(value: string): boolean {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(value);
}


// --- model/is-selected-model-item.ts ---

/** Context for {@link isSelectedModelItem}. */
interface IsSelectedModelItemContext {
  /** Model menu item locator. */
  item: Locator;
}

/** True when the menu item represents the currently selected model. */
async function isSelectedModelItem(ctx: IsSelectedModelItemContext): Promise<boolean> {
  const ariaChecked = await ctx.item.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  const dataState = await ctx.item.getAttribute("data-state").catch(() => null);
  return dataState === "checked";
}


// --- model/list-available-models.ts ---




/** Read available models from ChatGPT's model menu. */
async function listAvailableModels(page: Page) {
  await openModelMenu({ page });
  const items = await modelMenuItems(page);
  const models = await collectModelsFromItems({ items });
  await closeModelMenu({ page });
  return models;
}


// --- model/model-item-matches-query.ts ---





/** Context for {@link modelItemMatchesQuery}. */
interface ModelItemMatchesQueryContext {
  /** Model menu item locator. */
  item: Locator;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Result of matching a model menu item against a query. */
interface ModelItemMatchResult {
  /** Whether the item exactly or partially matches the query. */
  matched: boolean;
  /** Locator to use as a fuzzy fallback when no exact match exists. */
  fallback: Locator | null;
}

/** Context for {@link buildModelItemMatchResult}. */
interface BuildModelItemMatchResultContext {
  /** Model menu item locator. */
  item: Locator;
  /** Human-readable model label. */
  label: string;
  /** Normalized model search query. */
  normalizedQuery: string;
  /** Searchable normalized label/id string. */
  searchable: string;
}

/** Build a match result from label and searchable text. */
function buildModelItemMatchResult(ctx: BuildModelItemMatchResultContext): ModelItemMatchResult {
  if (ctx.searchable === ctx.normalizedQuery || ctx.searchable.includes(ctx.normalizedQuery)) {
    return { matched: true, fallback: null };
  }
  const fallback = ctx.normalizedQuery.includes(normalizeModelQuery({ value: ctx.label })) ? ctx.item : null;
  return { matched: false, fallback };
}

/** Test whether a menu item matches a normalized model query. */
async function modelItemMatchesQuery(ctx: ModelItemMatchesQueryContext): Promise<ModelItemMatchResult> {
  const label = await readModelItemLabel({ item: ctx.item });
  const id = await readModelItemId({ item: ctx.item });
  const searchable = normalizeModelQuery({ value: `${label} ${id}` });
  if (!label || !isLikelyModelLabel(label)) return { matched: false, fallback: null };
  return buildModelItemMatchResult({ item: ctx.item, label, normalizedQuery: ctx.normalizedQuery, searchable });
}


// --- model/model-labels.config.ts ---
/** Known model data-testid suffixes to human-readable names. */
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
  "o1": "o1",
  "o1-pro": "o1 Pro",
  "o1-mini": "o1 Mini",
  "o3-mini": "o3 Mini",
};


// --- model/model-menu-items.ts ---


/** Return all model menu item locators from the open model switcher menu. */
async function modelMenuItems(page: Page): Promise<Locator[]> {
  return page.locator(
    [
      '[role="menu"] [role="menuitem"]',
      '[role="menu"] [role="menuitemradio"]',
      '[data-radix-menu-content] [role="menuitem"]',
      '[data-radix-menu-content] [role="menuitemradio"]',
      '[role="menu"] [data-testid^="model-switcher-"]',
      '[data-radix-menu-content] [data-testid^="model-switcher-"]',
    ].join(", "),
  ).all();
}


// --- model/open-model-menu.ts ---



/** Context for {@link clickModelTrigger}. */
interface ClickModelTriggerContext {
  /** Model switcher trigger locator. */
  trigger: NonNullable<Awaited<ReturnType<typeof firstVisible>>>;
}

/** Click the model switcher trigger, forcing if needed. */
async function clickModelTrigger(ctx: ClickModelTriggerContext): Promise<void> {
  try {
    await ctx.trigger.click({ timeout: 5_000 });
  } catch {
    await ctx.trigger.click({ timeout: 5_000, force: true });
  }
}

/** Context for {@link openModelMenu}. */
interface OpenModelMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Open the ChatGPT model switcher dropdown menu. */
async function openModelMenu(ctx: OpenModelMenuContext): Promise<void> {
  await ctx.page.locator(SELECTORS.modelTrigger.join(", ")).first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Could not find ChatGPT model switcher button.");
  await clickModelTrigger({ trigger });
  await ctx.page.locator(SELECTORS.openMenu).first().waitFor({ state: "visible", timeout: 5_000 });
}


// --- model/parse-model-menu-item.ts ---






/** Context for {@link parseModelMenuItem}. */
interface ParseModelMenuItemContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Parse one model menu item into a {@link ModelOption}, or null when not a model. */
async function parseModelMenuItem(ctx: ParseModelMenuItemContext): Promise<ModelOption | null> {
  const label = await readModelItemLabel({ item: ctx.item });
  if (!label || !isLikelyModelLabel(label)) return null;
  const id = await readModelItemId({ item: ctx.item });
  const selected = await isSelectedModelItem({ item: ctx.item });
  return { id, label, selected };
}


// --- model/read-checked-model-from-dom.ts ---


/** Context for {@link readCheckedModelFromDom}. */
interface ReadCheckedModelFromDomContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the checked model from aria-checked switcher items in the DOM. */
async function readCheckedModelFromDom(ctx: ReadCheckedModelFromDomContext): Promise<string | null> {
  const checked = ctx.page.locator('[data-testid^="model-switcher-"][aria-checked="true"]').first();
  if (await checked.count() > 0) {
    return readModelItemLabel({ item: checked });
  }
  return null;
}


// --- model/read-checked-model-from-open-menu.ts ---




/** Context for {@link readCheckedModelFromOpenMenu}. */
interface ReadCheckedModelFromOpenMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the label of the checked model item from an already-open menu. */
async function readCheckedModelFromOpenMenu(ctx: ReadCheckedModelFromOpenMenuContext): Promise<string | null> {
  const items = await modelMenuItems(ctx.page);
  for (const item of items) {
    if (await isSelectedModelItem({ item })) {
      const label = await readModelItemLabel({ item });
      if (label) return label;
    }
  }
  return null;
}


// --- model/read-likely-aria-model-label.ts ---


/** Context for {@link readLikelyAriaModelLabel}. */
interface ReadLikelyAriaModelLabelContext {
  /** Model switcher trigger locator. */
  trigger: Locator;
}

/** Read a model label from the trigger aria-label when it looks valid. */
async function readLikelyAriaModelLabel(ctx: ReadLikelyAriaModelLabelContext): Promise<string | null> {
  const ariaLabel = await ctx.trigger.getAttribute("aria-label").catch(() => null);
  return ariaLabel && isLikelyModelLabel(ariaLabel) ? ariaLabel.trim() : null;
}


// --- model/read-likely-model-line.ts ---

/** Context for {@link readLikelyModelLine}. */
interface ReadLikelyModelLineContext {
  /** Normalized trigger button text. */
  text: string;
}

/** Return the first line in trigger text that looks like a model label. */
function readLikelyModelLine(ctx: ReadLikelyModelLineContext): string | null {
  return ctx.text.split("\n").find((part) => isLikelyModelLabel(part)) ?? null;
}


// --- model/read-model-from-trigger.ts ---






/** Context for {@link readModelFromTrigger}. */
interface ReadModelFromTriggerContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the current model label from the model switcher trigger button. */
async function readModelFromTrigger(ctx: ReadModelFromTriggerContext): Promise<string | null> {
  const trigger = await firstVisible({ page: ctx.page, selectors: SELECTORS.modelTrigger });
  if (!trigger) return null;
  const line = readLikelyModelLine({
    text: normalizeDisplayText({ value: await trigger.innerText().catch(() => "") }),
  });
  if (line) return line;
  return readLikelyAriaModelLabel({ trigger });
}


// --- model/read-model-item-id.ts ---



/** Context for {@link readModelItemId}. */
interface ReadModelItemIdContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Derive a stable model id from a menu item's test id or label. */
async function readModelItemId(ctx: ReadModelItemIdContext): Promise<string> {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) return testId.replace("model-switcher-", "");
  const label = await readModelItemLabel({ item: ctx.item });
  return normalizeModelQuery({ value: label }).replace(/\s+/g, "-");
}


// --- model/read-model-item-label.ts ---



/** Context for {@link readModelItemLabel}. */
interface ReadModelItemLabelContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Read the human-readable label for a model menu item. */
async function readModelItemLabel(ctx: ReadModelItemLabelContext): Promise<string> {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }
  return normalizeDisplayText({ value: await ctx.item.innerText().catch(() => "") });
}


// --- model/select-model.ts ---







/** Context for {@link selectModelOrThrow}. */
interface SelectModelOrThrowContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Original user-supplied model query for error messages. */
  query: string;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Open the model menu, click a match, or throw when none is found. */
async function selectModelOrThrow(ctx: SelectModelOrThrowContext): Promise<string> {
  await openModelMenu({ page: ctx.page });
  const match = await findModelMenuMatch({ page: ctx.page, normalizedQuery: ctx.normalizedQuery });
  if (match) return clickModelAndDetect({ page: ctx.page, item: match });
  await closeModelMenu({ page: ctx.page });
  throw new Error(`No model matched "${ctx.query}". Run /model to list available browser models.`);
}

/** Select a ChatGPT model by visible label, data-testid suffix, or fuzzy query. */
async function selectModel(page: Page, query: string): Promise<string> {
  const normalizedQuery = normalizeModelQuery({ value: query });
  if (!normalizedQuery) throw new Error("Model name is required.");
  return selectModelOrThrow({ page, query, normalizedQuery });
}


// --- prompt/click-send-button.ts ---


/** Context for {@link clickSendButton}. */
interface ClickSendButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click the send button or fall back to pressing Enter. */
async function clickSendButton(ctx: ClickSendButtonContext): Promise<void> {
  const sendBtn = ctx.page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
  } catch {
    await ctx.page.keyboard.press("Enter");
  }
}


// --- prompt/composer-clears-once.ts ---


/** Context for {@link composerClearsOnce}. */
interface ComposerClearsOnceContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Poll the composer once and return true when it has emptied. */
async function composerClearsOnce(ctx: ComposerClearsOnceContext): Promise<boolean> {
  const composerText = await readComposerText({ page: ctx.page });
  return composerText === "";
}


// --- prompt/composer-clears.ts ---


/** Context for {@link composerClears}. */
interface ComposerClearsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/**
 * Poll the composer until it empties, signalling the prompt was actually sent.
 *
 * Returns false once the poll budget is spent so the caller can re-send.
 */
async function composerClears(ctx: ComposerClearsContext): Promise<boolean> {
  for (let poll = 0; poll < 10; poll += 1) {
    if (await composerClearsOnce({ page: ctx.page })) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
}


// --- prompt/inject-prompt.ts ---


/**
 * Type a prompt into ChatGPT's input field, send it, and confirm it actually left
 * the composer before returning.
 */
async function injectPrompt(page: Page, text: string): Promise<void> {
  await page.bringToFront().catch(() => {});
  await runInjectPromptAttempts({ page, text });
}


// --- prompt/read-composer-text.ts ---

/** Context for {@link readComposerText}. */
interface ReadComposerTextContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the current trimmed text from the ChatGPT composer. */
async function readComposerText(ctx: ReadComposerTextContext): Promise<string> {
  const text = await ctx.page.evaluate(() =>
    (document.querySelector<HTMLElement>("#prompt-textarea")?.innerText ?? "").trim(),
  );
  return text ?? "";
}


// --- prompt/run-inject-prompt-attempts.ts ---



/** Context for {@link runInjectPromptAttempts}. */
interface RunInjectPromptAttemptsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Prompt text to inject into the composer. */
  text: string;
}

/** Retry sending until the composer clears or attempts are exhausted. */
async function runInjectPromptAttempts(ctx: RunInjectPromptAttemptsContext): Promise<void> {
  const input = ctx.page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await submitPromptAttempt({ page: ctx.page, input, text: ctx.text })) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
}


// --- prompt/submit-prompt-attempt.ts ---



/** Context for {@link submitPromptAttempt}. */
interface SubmitPromptAttemptContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Composer input locator to fill before sending. */
  input: Locator;
  /** Prompt text to inject into the composer. */
  text: string;
}

/** Fill the composer and attempt one send; return true when the composer clears. */
async function submitPromptAttempt(ctx: SubmitPromptAttemptContext): Promise<boolean> {
  await ctx.input.click();
  await ctx.input.fill(ctx.text);
  await ctx.input.dispatchEvent("input");
  await clickSendButton({ page: ctx.page });
  return composerClears({ page: ctx.page });
}


// --- response/is-transient-assistant-text.ts ---
/** Context for {@link isTransientAssistantText}. */
interface IsTransientAssistantTextContext {
  /** Normalized assistant response text to inspect. */
  text: string;
}

/** True when assistant text is a transient placeholder such as "Thinking…". */
function isTransientAssistantText(ctx: IsTransientAssistantTextContext): boolean {
  const normalized = ctx.text.trim().toLowerCase();
  return normalized === "thinking"
    || normalized.endsWith(" thinking")
    || normalized.endsWith(" thinking...")
    || /^thinking[.\s]*$/.test(normalized)
    || /^thought for\b/.test(normalized)
    || normalized.startsWith("thought for ");
}


// --- response/is-turn-settled.ts ---


/**
 * Decide whether the current assistant turn has finished producing output.
 *
 * Pure so the completion policy is unit-testable without a browser.
 */
function isTurnSettled(state: TurnSettledState): boolean {
  if (state.streaming) return false;
  const requiredQuietMs = state.assetCount > 0 ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;
  if (state.stableForMs < requiredQuietMs) return false;
  return state.assetCount > 0 || (state.hasText && !state.isTransientText);
}


// --- response/remaining-timeout.ts ---
/** Context for {@link remainingTimeout}. */
interface RemainingTimeoutContext {
  /** Timestamp when the wait started. */
  startedAt: number;
  /** Total timeout budget in milliseconds. */
  timeout: number;
}

/** Compute remaining timeout budget, never below one second. */
function remainingTimeout(ctx: RemainingTimeoutContext): number {
  return Math.max(1_000, ctx.timeout - (Date.now() - ctx.startedAt));
}


// --- response/response-started-after-baseline.ts ---



/** Context for {@link responseStartedAfterBaseline}. */
interface ResponseStartedAfterBaselineContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
}

/** True when a new assistant response has started relative to the baseline. */
async function responseStartedAfterBaseline(ctx: ResponseStartedAfterBaselineContext): Promise<boolean> {
  if (await isStreamingVisible({ page: ctx.page })) return true;
  const count = await ctx.page.locator(SELECTORS.responseBlock).count();
  if (ctx.previousAssistantCount !== undefined && count > ctx.previousAssistantCount) return true;
  const lastText = await readNormalizedLastResponse({ page: ctx.page });
  return !!ctx.previousLastAssistantText && !!lastText && lastText !== ctx.previousLastAssistantText;
}


// --- response/response-wait-options.ts ---
/** Options for {@link waitForResponse}. */
interface ResponseWaitOptions {
  /** Maximum wait time in milliseconds. */
  timeout?: number;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
}


// --- response/settle-constants.ts ---
/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

/** Longer quiet window required when generated assets are present in a turn. */
const ASSET_SETTLE_QUIET_MS = 2_500;


// --- response/streaming-helpers.ts ---




/** Context for {@link isStreamingVisible}. */
interface IsStreamingVisibleContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when ChatGPT's stop/streaming indicator is visible. */
async function isStreamingVisible(ctx: IsStreamingVisibleContext): Promise<boolean> {
  return ctx.page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
}

/** Context for {@link readNormalizedLastResponse}. */
interface ReadNormalizedLastResponseContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read and normalize the last assistant response text. */
async function readNormalizedLastResponse(ctx: ReadNormalizedLastResponseContext): Promise<string> {
  const text = await captureLastResponse(ctx.page).catch(() => "");
  return normalizeDisplayText({ value: text });
}


// --- response/turn-settled-state.ts ---
/** Snapshot of assistant turn state used by {@link isTurnSettled}. */
interface TurnSettledState {
  /** Whether the assistant block contains non-empty text. */
  hasText: boolean;
  /** Whether the text is a transient placeholder such as "Thinking…". */
  isTransientText: boolean;
  /** Count of generated image assets in the current turn. */
  assetCount: number;
  /** Whether ChatGPT is still streaming the response. */
  streaming: boolean;
  /** Milliseconds the visible content has been unchanged. */
  stableForMs: number;
}


// --- response/turn-snapshot.ts ---





/** Context for {@link readTurnSnapshot}. */
interface ReadTurnSnapshotContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Snapshot of the current assistant turn used for settle detection. */
interface TurnSnapshot {
  /** Normalized last assistant response text. */
  text: string;
  /** Whether streaming indicator is visible. */
  streaming: boolean;
  /** Count of generated image assets in the DOM. */
  assetCount: number;
}

/** Read current assistant turn snapshot from the page. */
async function readTurnSnapshot(ctx: ReadTurnSnapshotContext): Promise<TurnSnapshot> {
  const text = await readNormalizedLastResponse({ page: ctx.page });
  const streaming = await isStreamingVisible({ page: ctx.page });
  const assetCount = await ctx.page.locator(SELECTORS.generatedImage).count().catch(() => 0);
  return { text, streaming, assetCount };
}

/** Context for {@link turnSnapshotSettled}. */
interface TurnSnapshotSettledContext {
  /** Turn snapshot to evaluate. */
  snapshot: TurnSnapshot;
  /** Milliseconds the snapshot has been unchanged. */
  stableForMs: number;
}

/** True when the snapshot satisfies {@link isTurnSettled}. */
function turnSnapshotSettled(ctx: TurnSnapshotSettledContext): boolean {
  return isTurnSettled({
    hasText: !!ctx.snapshot.text,
    isTransientText: isTransientAssistantText({ text: ctx.snapshot.text }),
    assetCount: ctx.snapshot.assetCount,
    streaming: ctx.snapshot.streaming,
    stableForMs: ctx.stableForMs,
  });
}


// --- response/wait-for-last-assistant-text-stable.ts ---


/** Context for {@link waitForLastAssistantTextStable}. */
interface WaitForLastAssistantTextStableContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Maximum wait time in milliseconds. */
  timeout: number;
}

/** Wait until assistant text and assets hold still long enough to count as settled. */
async function waitForLastAssistantTextStable(ctx: WaitForLastAssistantTextStableContext): Promise<void> {
  const startedAt = Date.now();
  let lastSnapshot = await readTurnSnapshot({ page: ctx.page });
  let stableSince = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    const snapshot = await readTurnSnapshot({ page: ctx.page });
    if (snapshot.text !== lastSnapshot.text || snapshot.assetCount !== lastSnapshot.assetCount) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
    }
    if (turnSnapshotSettled({ snapshot, stableForMs: Date.now() - stableSince })) return;
    await ctx.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
}


// --- response/wait-for-response-after-baseline.ts ---


/** Context for {@link waitForResponseAfterBaseline}. */
interface WaitForResponseAfterBaselineContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
  /** Maximum wait time in milliseconds. */
  timeout: number;
}

/** Wait until ChatGPT begins a new response relative to a pre-send baseline. */
async function waitForResponseAfterBaseline(ctx: WaitForResponseAfterBaselineContext): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    if (await responseStartedAfterBaseline(ctx)) return;
    await ctx.page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for ChatGPT to start a new response.");
}


// --- response/wait-for-response.ts ---







/** Wait for ChatGPT to finish streaming its response. */
async function waitForResponse(
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> {
  const parsed = parseResponseWaitOptions(options);
  const startedAt = Date.now();
  if (parsed.previousAssistantCount !== undefined || parsed.previousLastAssistantText) {
    await waitForResponseAfterBaseline({ page, ...parsed });
  } else {
    await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
  }
  await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
  await waitForLastAssistantTextStable({
    page,
    timeout: remainingTimeout({ startedAt, timeout: parsed.timeout }),
  });
}


// --- response/wait-for-streaming-to-finish.ts ---







/** Context for {@link waitForStreamingToFinish}. */
interface WaitForStreamingToFinishContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Timestamp when the wait started. */
  startedAt: number;
  /** Total timeout budget in milliseconds. */
  timeout: number;
}

/** Wait for the streaming indicator to appear then disappear. */
async function waitForStreamingToFinish(ctx: WaitForStreamingToFinishContext): Promise<void> {
  try {
    await ctx.page.locator(SELECTORS.streamingIndicator).waitFor({ state: "visible", timeout: 10_000 });
    await ctx.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: remainingTimeout({ startedAt: ctx.startedAt, timeout: ctx.timeout }),
    });
  } catch {
    // Response might already be complete
  }
}

/** Parse {@link waitForResponse} options from a number or options object. */
function parseResponseWaitOptions(options: number | ResponseWaitOptions): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
} {
  if (typeof options === "number") {
    return { timeout: options };
  }
  return {
    timeout: options.timeout ?? 300_000,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText({ value: options.previousLastAssistantText ?? "" }),
  };
}


// --- selectors.config.ts ---
/** DOM selectors for ChatGPT's interface. Subject to change if ChatGPT updates UI. */
const SELECTORS = {
  /** The contenteditable prompt input field. */
  promptInput: '#prompt-textarea, [contenteditable="true"]',
  /** The send button (visible when text is entered). */
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
  /** Individual assistant response blocks. */
  responseBlock: '[data-message-author-role="assistant"]',
  /** The most recent response block. */
  lastResponse: '[data-message-author-role="assistant"]:last-of-type',
  /** Sidebar conversation links. */
  sidebarConversation: 'nav a[href^="/c/"]',
  /** Streaming indicator (the stop button appears while streaming). */
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ].join(", "),
  /** ChatGPT-generated images render outside the role block, served from the estuary content endpoint. */
  generatedImage: 'img[src*="/backend-api/estuary/content"], img[alt^="Generated image" i]',
  /** Model menu triggers in the ChatGPT shell. */
  modelTrigger: [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Switch model"]',
    'button:has-text("GPT")',
    'button:has-text("ChatGPT")',
    'button:has-text("o3")',
    'button:has-text("o4")',
  ],
  /** Open dropdown / menu content. */
  openMenu: '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]',
  /** User message blocks. */
  userBlock: '[data-message-author-role="user"]',
  /** Conversation turn wrapper. */
  conversationTurn: 'section[data-testid^="conversation-turn-"]',
  /** Composer file attachment controls. */
  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid*="upload" i]',
  ],
  /** Profile/settings controls. */
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


// --- session/assert-signed-in.ts ---



/** Fail fast before sending a prompt to an unauthenticated guest session. */
async function assertSignedIn(page: Page): Promise<void> {
  if (await isGuestSession(page)) throw new GuestSessionError();
}


// --- session/has-guest-login-buttons.ts ---


/** Context for {@link hasGuestLoginButtons}. */
interface HasGuestLoginButtonsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when ChatGPT shows login or signup CTAs for guest users. */
async function hasGuestLoginButtons(ctx: HasGuestLoginButtonsContext): Promise<boolean> {
  const login = ctx.page.locator('[data-testid="login-button"]');
  if (await login.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  const signup = ctx.page.locator('[data-testid="signup-button"]');
  return signup.isVisible({ timeout: 500 }).catch(() => false);
}


// --- session/has-visible-account-menu.ts ---


/** Context for {@link hasVisibleAccountMenu}. */
interface HasVisibleAccountMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when the signed-in account/profile menu control is visible. */
async function hasVisibleAccountMenu(ctx: HasVisibleAccountMenuContext): Promise<boolean> {
  const account = ctx.page.locator(SELECTORS.accountMenuButton.join(", "));
  return account.first().isVisible({ timeout: 2500 }).catch(() => false);
}


// --- session/has-visible-composer.ts ---


/** Context for {@link hasVisibleComposer}. */
interface HasVisibleComposerContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when the prompt composer input is visible on the page. */
async function hasVisibleComposer(ctx: HasVisibleComposerContext): Promise<boolean> {
  const prompt = ctx.page.locator(SELECTORS.promptInput);
  return prompt.first().isVisible({ timeout: 1500 }).catch(() => false);
}


// --- session/is-guest-session.ts ---




/** True when ChatGPT is showing the unauthenticated guest shell. */
async function isGuestSession(page: Page): Promise<boolean> {
  if (await hasVisibleAccountMenu({ page })) return false;
  if (await hasGuestLoginButtons({ page })) return true;
  return !(await hasVisibleComposer({ page }));
}

/** ChatGPT web UI automation — prompt, response, model, connector, attachments. */
export class ChatGptPage implements BrowserProvider {
  readonly id = "chatgpt" as const;
  readonly origin = "chatgpt.com";
  readonly defaultUrl = "https://chatgpt.com";
  readonly defaultModel = "ChatGPT";
  readonly displayName = "ChatGPT";
  readonly composerSelector = '#prompt-textarea, [contenteditable="true"]';
  readonly supportsMcpConnector = true;

  /** Fail fast when ChatGPT is not signed in. */
  async assertSignedIn(page: Page): Promise<void> {
    return assertSignedIn(page);
  }

  /** Type a prompt into the composer and send it. */
  async injectPrompt(page: Page, text: string): Promise<void> {
    return injectPrompt(page, text);
  }

  /** Wait until the assistant response finishes streaming. */
  async waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void> {
    return waitForResponse(page, options);
  }

  /** Read the last assistant response text from the page. */
  async captureLastResponse(page: Page): Promise<string> {
    return captureLastResponse(page);
  }

  /** Count rendered assistant response blocks. */
  async countAssistantResponses(page: Page): Promise<number> {
    return countAssistantResponses(page);
  }

  /** Capture all conversation messages from the DOM. */
  async captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
    return captureAllMessages(page);
  }

  /** Read conversation entries from the sidebar. */
  async readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
    return readSidebarConversations(page);
  }

  /** Navigate to a conversation URL. */
  async navigateToConversation(page: Page, url: string): Promise<void> {
    return navigateToConversation(page, url);
  }

  /** Open a new ChatGPT conversation. */
  async newConversation(page: Page): Promise<void> {
    return newConversation(page);
  }

  /** Detect the currently selected model label. */
  async detectCurrentModel(page: Page): Promise<string> {
    return detectCurrentModel(page);
  }

  /** List models exposed in the model picker. */
  async listAvailableModels(page: Page): Promise<ModelOption[]> {
    return listAvailableModels(page);
  }

  /** Switch to a model matching the query string. */
  async selectModel(page: Page, query: string): Promise<string> {
    return selectModel(page, query);
  }

  /** Rewind and optionally replace the last user prompt. */
  async rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
    return rewindLastUserPrompt(page, replacement);
  }

  /** Stop an in-progress response stream when possible. */
  async stopGenerating(page: Page, timeout?: number): Promise<boolean> {
    return stopGenerating(page, timeout);
  }

  /** Attach local files to the composer. */
  async attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
    return attachFilesToPrompt(page, paths);
  }

  /** True when a string looks like a ChatGPT model label. */
  isLikelyModelLabel(value: string): boolean {
    return isLikelyModelLabel(value);
  }

  /** Set up the ChatGPT MCP connector in Developer Mode. */
  async setupMcpConnector(page: Page, url: string, options?: ConnectorSetupOptions): Promise<ConnectorSetupResult> {
    return setupMcpConnectorInChatGpt(page, url, options);
  }
}

export {
  AttachmentDownloadError,
  downloadAll,
  downloadAttachment,
  extractAllMessages,
  extractAssistantContent,
  injectPrompt,
  isTurnSettled,
  loadManifest,
  readComposerText,
  saveManifest,
  SELECTORS,
};
