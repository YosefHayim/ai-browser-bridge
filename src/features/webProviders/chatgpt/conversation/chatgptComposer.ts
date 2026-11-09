import type { Locator, Page } from "playwright";
import { captureLastResponse } from "../content/chatgptAttachments.ts";
import {
  countAssistantResponses,
  firstVisible,
  firstVisibleIn,
  normalizeDisplayText,
  SELECTORS,
  waitForGenerationIdle,
} from "./chatgptControls.ts";
import { isStreamingVisible, waitForResponse } from "./chatgptResponse.ts";

type AttachFilesViaChooserContext = {
  page: Page;
  paths: string[];
};

type AttachFilesViaInputContext = {
  page: Page;
  paths: string[];
};

type PreparedRewindTurnInput = {
  page: PrepareRewindTurnContext["page"];
  replacement?: string;
  lastUserBlock: Locator;
  previousAssistantCount: number;
  previousLastAssistantText: string;
};

type FindRewindEditorContext = {
  page: Page;
  turnScope: Locator;
};

type FindRewindSubmitButtonContext = {
  page: Page;
  turnScope: Locator;
};

type SubmitRewindEditorContext = {
  editor: Locator;
  prompt: string;
};

type RewindPromptInput = {
  replacement?: string;
  previousText: string;
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

type RunInjectPromptAttemptsContext = {
  page: Page;
  text: string;
};

type SubmitPromptAttemptContext = {
  page: Page;
  input: Locator;
  text: string;
};

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

export const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  if (await attachFilesViaInput({ page, paths })) return;
  await attachFilesViaChooser({ page, paths });
};

const openAttachmentFileChooser = async (page: Page) => {
  const attachButton = await firstVisible({
    page: page,
    selectors: [
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Upload" i]',
      'button[data-testid*="attach" i]',
      'button[data-testid*="upload" i]',
    ],
  });
  if (!attachButton) throw new Error("Could not find ChatGPT attachment control.");
  const chooserPromise = page.waitForEvent("filechooser", {
    timeout: 5_000,
  });
  await attachButton.click();
  return chooserPromise;
};

const attachFilesViaChooser = async (
  attachFilesViaChooserContext: AttachFilesViaChooserContext,
): Promise<void> => {
  const chooser = await openAttachmentFileChooser(attachFilesViaChooserContext.page);
  await (await chooser).setFiles(attachFilesViaChooserContext.paths);
};

const attachFilesViaInput = async (
  attachFilesViaRequest: AttachFilesViaInputContext,
): Promise<boolean> => {
  const input = attachFilesViaRequest.page.locator(SELECTORS.attachmentInput).first();
  if ((await input.count()) === 0) return false;
  await input.setInputFiles(attachFilesViaRequest.paths);
  return true;
};

const preparedRewindTurn = async (
  preparedRewindTurnRequest: PreparedRewindTurnInput,
): Promise<PreparedRewindTurn> => {
  const turnScope = await lastUserTurnScope(preparedRewindTurnRequest.lastUserBlock);
  const prompt = rewindPrompt({
    replacement: preparedRewindTurnRequest.replacement,
    previousText: await readLastUserPromptText(preparedRewindTurnRequest.lastUserBlock),
  });
  return {
    page: preparedRewindTurnRequest.page,
    turnScope,
    prompt,
    previousAssistantCount: preparedRewindTurnRequest.previousAssistantCount,
    previousLastAssistantText: preparedRewindTurnRequest.previousLastAssistantText,
  };
};

const loadLastUserBlock = async (page: import("playwright").Page) => {
  const blocks = await page.locator(SELECTORS.userBlock).all();
  const last = blocks[blocks.length - 1];
  if (last === undefined) throw new Error("No user message found to rewind.");
  return last;
};

const clickRewindEditButton = async (prepared: PreparedRewindTurn): Promise<void> => {
  await prepared.turnScope.hover().catch(() => {});
  await prepared.page.waitForTimeout(300);
  const editButton = await findRewindEditButton(prepared.turnScope);
  if (!editButton) throw new Error("Could not find ChatGPT edit button for the last user message.");
  await editButton.click();
};

const openRewindEditor = async (prepared: PreparedRewindTurn) => {
  await clickRewindEditButton(prepared);
  return findRewindEditor({
    page: prepared.page,
    turnScope: prepared.turnScope,
  });
};

const prepareRewindTurn = async (
  prepareRewindTurnContext: PrepareRewindTurnContext,
): Promise<PreparedRewindTurn> => {
  const lastUserBlock = await loadLastUserBlock(prepareRewindTurnContext.page);
  const previousAssistantCount = await countAssistantResponses(prepareRewindTurnContext.page);
  const previousLastAssistantText = await captureLastResponse(prepareRewindTurnContext.page);
  return preparedRewindTurn({
    page: prepareRewindTurnContext.page,
    replacement: prepareRewindTurnContext.replacement,
    lastUserBlock,
    previousAssistantCount,
    previousLastAssistantText,
  });
};

const findRewindEditButton = async (turnScope: Locator) => {
  return firstVisibleIn({
    parent: turnScope,
    selectors: EDIT_BUTTON_SELECTORS,
  });
};

const findRewindEditor = async (findRewindEditorContext: FindRewindEditorContext) => {
  const scopedEditor = await firstVisibleIn({
    parent: findRewindEditorContext.turnScope,
    selectors: EDITOR_SELECTORS,
  });
  if (scopedEditor !== null) return scopedEditor;
  return firstVisible({ page: findRewindEditorContext.page, selectors: EDITOR_SELECTORS });
};

const findRewindSubmitButton = async (
  findRewindSubmitButtonContext: FindRewindSubmitButtonContext,
) => {
  const scopedSubmit = await firstVisibleIn({
    parent: findRewindSubmitButtonContext.turnScope,
    selectors: SUBMIT_BUTTON_SELECTORS,
  });
  if (scopedSubmit !== null) return scopedSubmit;
  return firstVisible({
    page: findRewindSubmitButtonContext.page,
    selectors: SUBMIT_BUTTON_SELECTORS,
  });
};

const submitRewindEditor = async (
  submitRewindEditorContext: SubmitRewindEditorContext,
): Promise<void> => {
  await submitRewindEditorContext.editor.click();
  await submitRewindEditorContext.editor.fill(submitRewindEditorContext.prompt);
  await submitRewindEditorContext.editor.dispatchEvent("input").catch(() => {});
};

const lastUserTurnScope = async (lastUserBlock: Locator): Promise<Locator> => {
  const turn = lastUserBlock.locator(
    'xpath=ancestor::section[starts-with(@data-testid, "conversation-turn-")][1]',
  );
  return (await turn.count()) > 0 ? turn : lastUserBlock;
};

const readLastUserPromptText = async (lastUserBlock: Locator): Promise<string> => {
  return normalizeDisplayText(await lastUserBlock.innerText());
};

const rewindPrompt = (rewindPromptRequest: RewindPromptInput): string => {
  const replacement = rewindPromptRequest.replacement?.trim();
  const prompt =
    replacement === undefined || replacement === ""
      ? rewindPromptRequest.previousText
      : replacement;
  if (!prompt) throw new Error("Last user message is empty.");
  return prompt;
};

export const rewindLastUserPrompt = async (page: Page, replacement?: string): Promise<void> => {
  const prepared = await prepareRewindTurn({ page, replacement });
  await submitRewindTurn(prepared);
};

export const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator(SELECTORS.streamingIndicator).first();
  try {
    await stop.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await stop.click();
  return true;
};

const submitEditedRewindTurn = async (prepared: PreparedRewindTurn): Promise<void> => {
  const submitButton = await findRewindSubmitButton({
    page: prepared.page,
    turnScope: prepared.turnScope,
  });
  if (!submitButton) throw new Error("Could not find submit button for edited prompt.");
  await submitButton.click();
  await waitForResponse(prepared.page, {
    previousAssistantCount: prepared.previousAssistantCount,
    previousLastAssistantText: prepared.previousLastAssistantText,
  });
};

const submitRewindTurn = async (prepared: PreparedRewindTurn): Promise<void> => {
  const editor = await openRewindEditor(prepared);
  if (!editor) throw new Error("Could not find editable prompt field after clicking edit.");
  await submitRewindEditor({ editor, prompt: prepared.prompt });
  await submitEditedRewindTurn(prepared);
};

const clickSendButton = async (page: Page): Promise<void> => {
  const sendBtn = page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
    return;
  } catch {
    // Send button never surfaced within the window; fall through to the Enter fallback.
  }
  // While a response streams, the send slot is the stop button — pressing Enter there would
  // either no-op or interrupt the stream, so skip the fallback until the conversation is idle.
  if (await isStreamingVisible(page)) return;
  await page.keyboard.press("Enter");
};

const composerClearsOnce = async (page: Page): Promise<boolean> => {
  const composerText = await readComposerText(page);
  return composerText === "";
};

const composerClears = async (page: Page): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if (await composerClearsOnce(page)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => {});
  await runInjectPromptAttempts({ page, text });
};

export const readComposerText = async (page: Page): Promise<string> => {
  const text = await page.evaluate(() => {
    const prompt = document.querySelector<HTMLElement>("#prompt-textarea");
    if (prompt === null || prompt.innerText === undefined) return "";
    return prompt.innerText.trim();
  });
  if (text === null || text === undefined) return "";
  return text;
};

const runInjectPromptAttempts = async (
  runInjectPromptAttemptsContext: RunInjectPromptAttemptsContext,
): Promise<void> => {
  const input = runInjectPromptAttemptsContext.page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Never type or send into a busy conversation — wait out any in-flight response first.
    await waitForGenerationIdle(runInjectPromptAttemptsContext.page);
    if (
      await submitPromptAttempt({
        page: runInjectPromptAttemptsContext.page,
        input,
        text: runInjectPromptAttemptsContext.text,
      })
    )
      return;
    // The attempt may have started a response even if the composer was slow to empty; an
    // active stream means the prompt landed, so stop rather than re-sending on top of it.
    if (await isStreamingVisible(runInjectPromptAttemptsContext.page)) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const submitPromptAttempt = async (
  submitPromptAttemptContext: SubmitPromptAttemptContext,
): Promise<boolean> => {
  await submitPromptAttemptContext.input.click();
  await submitPromptAttemptContext.input.fill(submitPromptAttemptContext.text);
  await submitPromptAttemptContext.input.dispatchEvent("input");
  await clickSendButton(submitPromptAttemptContext.page);
  return composerClears(submitPromptAttemptContext.page);
};
