import type { Locator, Page } from "playwright";
import { FORM_CONTROL_TAG } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  captureLastReply,
  countAssistantReplies,
} from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { cleanDisplayString, readFirstVisible } from "@/providers/chatgpt/page/model-detection.ts";
import { waitForReply } from "@/providers/chatgpt/page/wait-for-reply.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";

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

type PreparedRewindTurnDetails = {
  page: PrepareRewindTurnDetails["page"];
  replacement?: string;
  lastUserBlock: Locator;
  previousAssistantCount: number;
  previousLastAssistantText: string;
};

async function readPreparedRewindTurn(
  details: PreparedRewindTurnDetails,
): Promise<PreparedRewindTurn> {
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
}

type LoadLastUserBlockDetails = {
  page: import("playwright").Page;
};

async function loadLastUserBlock(details: LoadLastUserBlockDetails) {
  const blocks = await details.page.locator(SELECTORS.userBlock).all();
  const last = blocks[blocks.length - 1];

  const isLastMissing = last == null;
  if (isLastMissing) throw new Error("No user message found to rewind.");

  return last;
}

type ClickRewindEditButtonDetails = {
  prepared: PreparedRewindTurn;
};

async function clickRewindEditButton(details: ClickRewindEditButtonDetails): Promise<void> {
  await probeOrFallback(null, () => details.prepared.turnScope.hover());
  const settlePauseMilliseconds = 300;

  await details.prepared.page.waitForTimeout(settlePauseMilliseconds);

  const editButton = await findRewindEditButton({ turnScope: details.prepared.turnScope });

  const isEditButtonMissing = editButton == null;
  if (isEditButtonMissing)
    throw new Error("Could not find ChatGPT edit button for the last user message.");

  await editButton.click();
}

type OpenRewindEditorDetails = {
  prepared: PreparedRewindTurn;
};

async function openRewindEditor(details: OpenRewindEditorDetails) {
  await clickRewindEditButton({ prepared: details.prepared });
  return findRewindEditor({ page: details.prepared.page, turnScope: details.prepared.turnScope });
}

async function prepareRewindTurn(details: PrepareRewindTurnDetails): Promise<PreparedRewindTurn> {
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
}

type FindRewindEditButtonDetails = {
  turnScope: Locator;
};

async function findRewindEditButton(details: FindRewindEditButtonDetails) {
  return readFirstVisible({
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
}

type FindRewindEditorDetails = {
  page: Page;
  turnScope: Locator;
};

async function findRewindEditor(details: FindRewindEditorDetails) {
  const scopedEditor = await readFirstVisible({
    parent: details.turnScope,
    selectors: EDITOR_SELECTORS,
  });

  const hasScopedEditor = scopedEditor != null;
  if (hasScopedEditor) return scopedEditor;

  return readFirstVisible({ parent: details.page, selectors: EDITOR_SELECTORS });
}

type FindRewindSubmitButtonDetails = {
  page: Page;
  turnScope: Locator;
};

async function findRewindSubmitButton(details: FindRewindSubmitButtonDetails) {
  const scopedSubmit = await readFirstVisible({
    parent: details.turnScope,
    selectors: SUBMIT_BUTTON_SELECTORS,
  });

  const hasScopedSubmit = scopedSubmit != null;
  if (hasScopedSubmit) return scopedSubmit;

  return readFirstVisible({ parent: details.page, selectors: SUBMIT_BUTTON_SELECTORS });
}

type SubmitRewindEditorDetails = {
  editor: Locator;
  prompt: string;
};

async function submitRewindEditor(details: SubmitRewindEditorDetails): Promise<void> {
  await details.editor.click();
  await details.editor.fill(details.prompt);
  await probeOrFallback(null, () => details.editor.dispatchEvent(FORM_CONTROL_TAG));
}

type LastUserTurnDetailsDetails = {
  lastUserBlock: Locator;
};

async function readLastUserTurnScope(details: LastUserTurnDetailsDetails): Promise<Locator> {
  const turn = details.lastUserBlock.locator(
    'xpath=ancestor::*[starts-with(@data-testid, "conversation-turn-") or @data-turn-key][1]',
  );
  const turnCount = await turn.count();
  const hasTurn = turnCount > 0;

  return hasTurn ? turn : details.lastUserBlock;
}

type ReadLastUserPromptStringDetails = {
  lastUserBlock: Locator;
};

async function readLastUserPromptString(details: ReadLastUserPromptStringDetails): Promise<string> {
  const lastUserBlockString = await readVisibleCopy(details.lastUserBlock);
  return cleanDisplayString({ value: lastUserBlockString });
}

type RewindPromptDetails = {
  replacement?: string;
  previousText: string;
};

function readRewindPrompt(details: RewindPromptDetails): string {
  const replacement = details.replacement?.trim();

  const isReplacementBlank = replacement == null || replacement === "";
  const prompt = isReplacementBlank ? details.previousText : replacement;

  const isPromptEmpty = !prompt;
  if (isPromptEmpty) throw new Error("Last user message is empty.");

  return prompt;
}

export async function rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
  const prepared = await prepareRewindTurn({ page, replacement });
  await submitRewindTurn({ prepared });
}

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

type SubmitEditedRewindTurnDetails = {
  prepared: PreparedRewindTurn;
};

async function submitEditedRewindTurn(details: SubmitEditedRewindTurnDetails): Promise<void> {
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
}

type SubmitRewindTurnDetails = {
  prepared: PreparedRewindTurn;
};

async function submitRewindTurn(details: SubmitRewindTurnDetails): Promise<void> {
  const editor = await openRewindEditor({ prepared: details.prepared });

  const isEditorMissing = editor == null;
  if (isEditorMissing) throw new Error("Could not find editable prompt field after clicking edit.");

  await submitRewindEditor({ editor, prompt: details.prepared.prompt });
  await submitEditedRewindTurn({ prepared: details.prepared });
}
