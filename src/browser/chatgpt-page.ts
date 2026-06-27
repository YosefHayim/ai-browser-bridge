import type { Locator, Page } from "playwright";
import { extractAllMessages, extractAssistantContent } from "./attachments.ts";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "../types/types.ts";

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

const DEFAULT_CONNECTOR_NAME = "chatgpt-local-bridge";
const BRIDGE_CONNECTOR_PREFIX = "chatgpt-local-bridge";

/**
 * Type a prompt into ChatGPT's input field, send it, and confirm it actually left
 * the composer before returning.
 *
 * The send click can silently no-op: right after an image-generation turn, and
 * intermittently under load, ChatGPT swallows the click (or the button is briefly
 * inert) so the prompt stays in the composer un-submitted and nothing throws. The
 * caller would then wait out the full response timeout for a reply that never
 * comes. A real send empties `#prompt-textarea`, so we poll the composer text and
 * re-send if it's still populated. Throwing fast after a few failed attempts beats
 * a multi-minute false timeout downstream.
 */
export async function injectPrompt(page: Page, text: string): Promise<void> {
  // Foreground the tab first. A backgrounded CDP-driven tab has its timers and
  // its response SSE stream throttled by Chrome, which stalls ChatGPT streaming
  // for minutes and looks like a hang. Bringing it to front keeps streaming live.
  await page.bringToFront().catch(() => {});

  const input = page.locator(SELECTORS.promptInput).first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.click();
    await input.fill(text);
    await input.dispatchEvent("input");

    // Prefer the explicit send button; fall back to Enter if its selector drifts.
    // ChatGPT's composer submits on Enter (Shift+Enter inserts a newline), so this
    // keeps sending working even when the button markup changes.
    const sendBtn = page.locator(SELECTORS.sendButton).first();
    try {
      await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
      await sendBtn.click();
    } catch {
      await page.keyboard.press("Enter");
    }

    if (await composerClears(page)) return;
  }

  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
}

/**
 * Poll the composer until it empties, signalling the prompt was actually sent.
 *
 * A successful submit clears `#prompt-textarea`; a no-op leaves the typed text in
 * place. We read `innerText` directly (rather than relying on a selector match)
 * because the contenteditable keeps its node after send and only its text drains.
 * Returns false once the poll budget is spent so the caller can re-send.
 */
async function composerClears(page: Page): Promise<boolean> {
  for (let poll = 0; poll < 10; poll += 1) {
    const composerText = await page.evaluate(
      () => (document.querySelector<HTMLElement>("#prompt-textarea")?.innerText ?? "").trim(),
    );
    if (composerText === "") return true;
    await page.waitForTimeout(500);
  }
  return false;
}

interface ResponseWaitOptions {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}

/** Wait for ChatGPT to finish streaming its response. */
export async function waitForResponse(
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> {
  const timeout = typeof options === "number" ? options : options.timeout ?? 300_000;
  const previousAssistantCount = typeof options === "number" ? undefined : options.previousAssistantCount;
  const previousLastAssistantText = typeof options === "number"
    ? undefined
    : normalizeDisplayText(options.previousLastAssistantText ?? "");
  const startedAt = Date.now();

  if (previousAssistantCount !== undefined || previousLastAssistantText) {
    await waitForResponseAfterBaseline(page, {
      previousAssistantCount,
      previousLastAssistantText,
      timeout,
    });
  } else {
    // Wait for an assistant response element to appear.
    await page.waitForSelector(SELECTORS.responseBlock, { timeout });
  }

  // Wait for streaming to complete (stop button disappears)
  try {
    await page.locator(SELECTORS.streamingIndicator).waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(SELECTORS.streamingIndicator).waitFor({ state: "hidden", timeout: remainingTimeout(startedAt, timeout) });
  } catch {
    // Response might already be complete
  }

  await waitForLastAssistantTextStable(page, remainingTimeout(startedAt, timeout));
}

/** Extract the text content of the last assistant response. */
export async function captureLastResponse(page: Page): Promise<string> {
  const { text } = await extractAssistantContent(page, { conversationId: conversationIdFromPage(page) });
  return text;
}

/** Count assistant responses currently rendered in the conversation. */
export async function countAssistantResponses(page: Page): Promise<number> {
  return page.locator(SELECTORS.responseBlock).count();
}

/** Extract all messages from the current conversation in DOM order. */
export async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
  return extractAllMessages(page, { conversationId: conversationIdFromPage(page) });
}

/** Read the conversation list from the sidebar. */
export async function readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
  const links = await page.locator(SELECTORS.sidebarConversation).all();

  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    const title = await link.innerText();
    if (href && title) {
      const id = href.split("/").pop() ?? "";
      conversations.push({ id, title: title.trim(), url: `https://chatgpt.com${href}` });
    }
  }

  return conversations;
}

/** Navigate to a specific conversation by URL. */
export async function navigateToConversation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}

/** Start a new ChatGPT conversation. */
export async function newConversation(page: Page): Promise<void> {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}

export { SELECTORS };

function conversationIdFromPage(page: Page): string {
  const url = page.url();
  const match = /\/c\/([^/?#]+)/.exec(url);
  return match?.[1] ?? "current";
}

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

/** Detect the currently selected ChatGPT model from the page DOM. */
export async function detectCurrentModel(page: Page): Promise<string> {
  try {
    const checked = page.locator('[data-testid^="model-switcher-"][aria-checked="true"]').first();
    if (await checked.count() > 0) {
      const checkedLabel = await readModelItemLabel(checked);
      if (checkedLabel) return checkedLabel;
    }

    const trigger = await firstVisible(page, SELECTORS.modelTrigger);
    if (trigger) {
      const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
      const line = text.split("\n").find((part) => isLikelyModelLabel(part));
      if (line) return line;

      // Only trust the aria-label if it actually names a model. Conversation
      // titles containing "Model" otherwise leak in via buttons like
      // "Pin <title>" or "Open conversation options for <title>".
      const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
      if (ariaLabel && isLikelyModelLabel(ariaLabel)) return ariaLabel.trim();
    }

    const checkedFromMenu = await detectCheckedModelFromMenu(page);
    if (checkedFromMenu) return checkedFromMenu;

    return "ChatGPT";
  } catch {
    return "ChatGPT";
  }
}

/** Read available models from ChatGPT's model menu. */
export async function listAvailableModels(page: Page): Promise<ModelOption[]> {
  await openModelMenu(page);
  const items = await modelMenuItems(page);
  const models: ModelOption[] = [];

  for (const item of items) {
    const label = await readModelItemLabel(item);
    if (!label || !isLikelyModelLabel(label)) continue;

    const id = await readModelItemId(item);
    const selected = await isSelectedModelItem(item);
    if (!models.some((model) => model.id === id && model.label === label)) {
      models.push({ id, label, selected });
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  return models;
}

async function detectCheckedModelFromMenu(page: Page): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await openModelMenu(page);
      const checkedModel = await readCheckedModelFromOpenMenu(page);
      await page.keyboard.press("Escape").catch(() => {});
      if (checkedModel) return checkedModel;
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
    }
    await page.waitForTimeout(750);
  }
  return null;
}

/** Select a ChatGPT model by visible label, data-testid suffix, or fuzzy query. */
export async function selectModel(page: Page, query: string): Promise<string> {
  const normalizedQuery = normalizeModelQuery(query);
  if (!normalizedQuery) throw new Error("Model name is required.");

  await openModelMenu(page);
  const items = await modelMenuItems(page);
  let fallback: Locator | null = null;

  for (const item of items) {
    const label = await readModelItemLabel(item);
    const id = await readModelItemId(item);
    const searchable = normalizeModelQuery(`${label} ${id}`);
    if (!label || !isLikelyModelLabel(label)) continue;

    if (searchable === normalizedQuery || searchable.includes(normalizedQuery)) {
      await item.click();
      await page.locator(SELECTORS.openMenu).waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
      return detectCurrentModel(page);
    }

    if (!fallback && normalizedQuery.includes(normalizeModelQuery(label))) {
      fallback = item;
    }
  }

  if (fallback) {
    await fallback.click();
    await page.locator(SELECTORS.openMenu).waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
    return detectCurrentModel(page);
  }

  await page.keyboard.press("Escape").catch(() => {});
  throw new Error(`No model matched "${query}". Run /model to list available browser models.`);
}

/** Edit the last user message and submit it again, optionally replacing its content. */
export async function rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
  const blocks = await page.locator(SELECTORS.userBlock).all();
  if (blocks.length === 0) throw new Error("No user message found to rewind.");

  const previousAssistantCount = await countAssistantResponses(page);
  const previousLastAssistantText = await captureLastResponse(page);
  const lastUserBlock = blocks[blocks.length - 1];
  const turn = lastUserBlock.locator('xpath=ancestor::section[starts-with(@data-testid, "conversation-turn-")][1]');
  const turnScope = await turn.count() > 0 ? turn : lastUserBlock;
  const previousText = normalizeDisplayText(await lastUserBlock.innerText());
  const prompt = replacement?.trim() || previousText;
  if (!prompt) throw new Error("Last user message is empty.");

  await turnScope.hover().catch(() => {});
  await page.waitForTimeout(300);
  const editButton = await firstVisibleIn(
    turnScope,
    [
      'button[data-testid="edit-turn-button"]',
      'button[data-testid="edit-message-button"]',
      'button[aria-label="Edit message"]',
      'button[aria-label*="Edit" i]',
      'button[title="Edit message"]',
      'button:has-text("Edit")',
    ],
  );
  if (!editButton) throw new Error("Could not find ChatGPT edit button for the last user message.");

  await editButton.click();

  const editor = await firstVisibleIn(
    turnScope,
    [
      'textarea[name="prompt-textarea"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      "textarea",
    ],
  ) ?? await firstVisible(page, [
    'textarea[name="prompt-textarea"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ]);

  if (!editor) throw new Error("Could not find editable prompt field after clicking edit.");

  await editor.click();
  await editor.fill(prompt);
  await editor.dispatchEvent("input").catch(() => {});

  const submitButton = await firstVisibleIn(
    turnScope,
    [
      'button[data-testid="send-button"]',
      'button[aria-label="Submit"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send prompt"]',
      'button:has-text("Save & submit")',
      'button:has-text("Submit")',
      'button:has-text("Update")',
    ],
  ) ?? await firstVisible(page, [
    'button[data-testid="send-button"]',
    'button[aria-label="Submit"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send prompt"]',
  ]);

  if (!submitButton) throw new Error("Could not find submit button for edited prompt.");

  await submitButton.click();
  await waitForResponse(page, { previousAssistantCount, previousLastAssistantText });
}

/** Stop the active streaming response when ChatGPT exposes the stop button. */
export async function stopGenerating(page: Page, timeout = 5_000): Promise<boolean> {
  const stop = page.locator(SELECTORS.streamingIndicator).first();
  try {
    await stop.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await stop.click();
  return true;
}

/** Attach local files to the ChatGPT composer when the browser UI exposes file upload. */
export async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const input = page.locator(SELECTORS.attachmentInput).first();
  if (await input.count() > 0) {
    await input.setInputFiles(paths);
    return;
  }

  const attachButton = await firstVisible(page, SELECTORS.attachmentButton);
  if (!attachButton) {
    throw new Error("Could not find ChatGPT attachment control.");
  }

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 });
  await attachButton.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(paths);
}

/** Best-effort ChatGPT Developer Mode connector setup through the browser UI. */
export async function setupMcpConnectorInChatGpt(
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> {
  const connectorName = options.connectorName ?? DEFAULT_CONNECTOR_NAME;
  const returnUrl = chatGptReturnUrl(page.url());
  const result: ConnectorSetupResult = {
    connectorUrl,
    completed: false,
    steps: [],
    warnings: [],
  };

  await openChatGptSettings(page, result);
  await openAppsOrConnectorsPanel(page, result);

  const hasCurrentConnector = await cleanupDuplicateConnectorApps(page, connectorName, connectorUrl, result);
  if (hasCurrentConnector) {
    const existing = await openExistingConnectorDetails(page, connectorName, connectorUrl, result);
    if (existing === "current") {
      result.completed = true;
      result.steps.push("Existing connector already uses the current URL.");
      if (await refreshOpenConnectorIfPresent(page)) {
        result.steps.push("Refreshed the connector tool schema.");
      }
      await selectConnectorAfterSetup(page, connectorName, returnUrl, result);
      return result;
    }
  }

  const existing = await openExistingConnectorDetails(page, connectorName, connectorUrl, result);
  if (existing === "current") {
    result.completed = true;
    result.steps.push("Existing connector already uses the current URL.");
    if (await refreshOpenConnectorIfPresent(page)) {
      result.steps.push("Refreshed the connector tool schema.");
    }
    await selectConnectorAfterSetup(page, connectorName, returnUrl, result);
    return result;
  }

  if (existing === "stale") {
    if (await deleteOpenConnectorIfPresent(page)) {
      result.steps.push("Deleted stale connector app before recreating it with the new tunnel URL.");
      await returnToConnectorListIfNeeded(page);
      await openAppsOrConnectorsPanel(page, result);
      await openAdvancedSettingsIfPresent(page, result);
    } else {
      result.warnings.push("Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.");
      if (options.automatic) await restoreAfterConnectorSetup(page, returnUrl);
      return result;
    }
  } else if (existing === "unknown") {
    result.warnings.push("Existing connector was found, but its URL could not be read from the settings panel.");
  }

  await openAdvancedSettingsIfPresent(page, result);
  await enableDeveloperModeIfPresent(page, result);
  await openCreateConnectorForm(page, result);

  const filledUrl = await fillFirstVisible(page, [
    'input[name="custom-connector-url"]',
    '#custom-connector-url',
    'input[type="url"]',
    'input[name*="url" i]',
    'input[placeholder*="https://" i]',
    'input[placeholder*="url" i]',
    'textarea[name*="url" i]',
    'textarea[placeholder*="https://" i]',
  ], connectorUrl);

  if (filledUrl) {
    result.steps.push(`Filled connector URL: ${connectorUrl}`);
  } else {
    result.warnings.push("Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.");
    if (options.automatic) await restoreAfterConnectorSetup(page, returnUrl);
    return result;
  }

  const filledName = await fillFirstVisible(page, [
    'input[name="custom-connector-name"]',
    '#custom-connector-name',
    'input[name*="name" i]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
  ], connectorName);
  if (filledName) result.steps.push(`Filled connector name: ${connectorName}`);

  const selectedNoAuth = await selectNoAuthenticationIfPresent(page);
  if (selectedNoAuth) result.steps.push("Selected no-authentication option when visible.");

  const acceptedRisk = await acceptCustomMcpRiskIfPresent(page);
  if (acceptedRisk) result.steps.push("Accepted custom MCP server risk notice.");

  const submitted = await clickFirstVisible(page, [
    'button:has-text("Create")',
    'button:has-text("Save")',
    'button:has-text("Add")',
    'button:has-text("Connect")',
  ], 2_000);
  if (submitted) {
    const appVisible = await waitForConnectorButton(page, connectorName, 20_000);
    const formStillOpen = await page.locator('input[name="custom-connector-url"], #custom-connector-url').first()
      .isVisible()
      .catch(() => false);
    if (formStillOpen && !appVisible) {
      result.warnings.push("Connector form is still open after submit. Check the visible validation message in ChatGPT settings.");
    } else {
      result.completed = true;
      result.steps.push("Submitted the connector form.");
      await selectConnectorAfterSetup(page, connectorName, returnUrl, result);
    }
  } else {
    result.warnings.push("Connector form was filled, but no Create/Save/Add button was visible or enabled.");
  }

  if (options.automatic && !result.completed) await restoreAfterConnectorSetup(page, returnUrl);
  return result;
}

async function openChatGptSettings(page: Page, result: ConnectorSetupResult): Promise<void> {
  await page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1_500);
  const settingsDialogOpen = await page.locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")').first()
    .isVisible()
    .catch(() => false);
  if (settingsDialogOpen) {
    result.steps.push("Opened ChatGPT settings.");
    return;
  }

  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});

  const menuOpened = await clickFirstVisible(page, SELECTORS.accountMenuButton, 2_000);
  if (!menuOpened) {
    result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }
  result.steps.push("Opened ChatGPT account menu.");

  const openedSettings = await clickFirstVisible(page, SELECTORS.settingsEntrypoint, 2_000);
  if (openedSettings) {
    result.steps.push("Opened ChatGPT settings.");
    await page.waitForTimeout(1_000);
  } else {
    result.warnings.push("Could not find Settings in the account menu.");
  }
}

async function openAppsOrConnectorsPanel(page: Page, result: ConnectorSetupResult): Promise<void> {
  const opened = await clickFirstVisible(page, [
    'button:has-text("Apps")',
    'a:has-text("Apps")',
    '[role="tab"]:has-text("Apps")',
    'button:has-text("Connectors")',
    'a:has-text("Connectors")',
    '[role="tab"]:has-text("Connectors")',
  ], 2_000);

  if (opened) {
    result.steps.push("Opened Apps/Connectors settings.");
  } else {
    result.warnings.push("Could not find Apps/Connectors in settings. Use Settings -> Apps manually.");
  }
}

async function openAdvancedSettingsIfPresent(page: Page, result: ConnectorSetupResult): Promise<void> {
  const opened = await clickFirstVisible(page, [
    'button:has-text("Advanced settings")',
    'button:has-text("Advanced Settings")',
    'a:has-text("Advanced settings")',
    '[role="tab"]:has-text("Advanced")',
    'button:has-text("Advanced")',
  ], 1_500);
  if (opened) result.steps.push("Opened Advanced settings.");
}

async function enableDeveloperModeIfPresent(page: Page, result: ConnectorSetupResult): Promise<void> {
  const outcome = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("body *"))
      .filter((node) => /Developer mode/i.test(node.textContent ?? ""));

    for (const label of labels.slice(0, 25)) {
      let scope: Element | null = label;
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
  });

  if (outcome === "enabled") {
    result.steps.push("Enabled Developer mode.");
    await page.waitForTimeout(750);
  } else if (outcome === "already-enabled") {
    result.steps.push("Developer mode was already enabled.");
  } else {
    result.warnings.push("Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.");
  }
}

async function openCreateConnectorForm(page: Page, result: ConnectorSetupResult): Promise<void> {
  const opened = await clickFirstVisible(page, [
    'button:has-text("Create app")',
    'button:has-text("Create App")',
    'button:has-text("Create")',
    'button:has-text("Add connector")',
    'button:has-text("Add Connector")',
    'button:has-text("New app")',
    'button:has-text("New App")',
    'button:has-text("Connect")',
  ], 2_000);

  if (opened) {
    result.steps.push("Opened connector/app creation form.");
  } else {
    result.warnings.push("Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.");
  }
}

type ExistingConnectorState = "missing" | "current" | "stale" | "unknown";

interface ConnectorAppSummary {
  name: string;
  appId: string | null;
  url: string | null;
}

async function cleanupDuplicateConnectorApps(
  page: Page,
  connectorName: string,
  connectorUrl: string,
  result: ConnectorSetupResult,
): Promise<boolean> {
  const summaries = await listBridgeConnectorSummaries(page);
  const current = summaries.find((summary) => summary.name === connectorName && summary.url === connectorUrl) ?? null;
  const deleteTargets = summaries.filter((summary) => {
    if (summary.name !== connectorName) return true;
    if (summary.url !== connectorUrl) return true;
    return !!current && !sameConnectorApp(summary, current);
  });

  for (const target of deleteTargets) {
    const deleted = await deleteConnectorAppBySummary(page, target);
    if (deleted) {
      result.steps.push(`Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`);
    } else {
      result.warnings.push(`Could not delete duplicate connector app: ${target.name}.`);
    }
  }

  await openConnectorList(page);
  return !!current;
}

async function listBridgeConnectorSummaries(page: Page): Promise<ConnectorAppSummary[]> {
  await openConnectorList(page);
  const entries = await findBridgeConnectorButtons(page);
  const summaries: ConnectorAppSummary[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    await openConnectorList(page);
    const currentEntries = await findBridgeConnectorButtons(page);
    const entry = currentEntries[index];
    if (!entry) continue;

    await entry.button.click({ timeout: 3_000, force: true });
    await page.waitForTimeout(1_000);
    const summary = await readOpenConnectorSummary(page);
    if (!summary) continue;

    const key = connectorSummaryKey(summary);
    if (!seen.has(key)) {
      seen.add(key);
      summaries.push(summary);
    }
  }

  await openConnectorList(page);
  return summaries;
}

async function openConnectorList(page: Page): Promise<void> {
  await page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1_000);
  const backButton = await firstVisible(page, [
    '[role="dialog"] button:has-text("Back")',
  ]);
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await page.waitForTimeout(750);
  }
}

async function findBridgeConnectorButtons(page: Page): Promise<Array<{ button: Locator; name: string }>> {
  const buttons = await page.locator('[role="dialog"] button').all();
  const entries: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = normalizeConnectorListLabel(await button.innerText().catch(() => ""));
    if (label.startsWith(BRIDGE_CONNECTOR_PREFIX)) {
      entries.push({ button, name: label });
    }
  }
  return entries;
}

async function readOpenConnectorSummary(page: Page): Promise<ConnectorAppSummary | null> {
  const text = await page.locator('[role="dialog"]').last().innerText().catch(() => "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const backIndex = lines.indexOf("Back");
  const name = backIndex >= 0 ? lines[backIndex + 1] ?? "" : "";
  if (!name.startsWith(BRIDGE_CONNECTOR_PREFIX)) return null;
  return {
    name,
    appId: valueAfterLine(lines, "App Id"),
    url: valueAfterLine(lines, "URL"),
  };
}

function valueAfterLine(lines: string[], label: string): string | null {
  const index = lines.indexOf(label);
  const value = index >= 0 ? lines[index + 1] : null;
  return value?.trim() || null;
}

function connectorSummaryKey(summary: ConnectorAppSummary): string {
  return `${summary.name}\u0000${summary.appId ?? ""}\u0000${summary.url ?? ""}`;
}

function sameConnectorApp(a: ConnectorAppSummary, b: ConnectorAppSummary): boolean {
  if (a.appId && b.appId) return a.appId === b.appId;
  return a.name === b.name && a.url === b.url;
}

async function deleteConnectorAppBySummary(page: Page, target: ConnectorAppSummary): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openConnectorList(page);
    const entries = await findBridgeConnectorButtons(page);
    for (const entry of entries) {
      if (entry.name !== target.name) continue;
      await entry.button.click({ timeout: 3_000, force: true });
      await page.waitForTimeout(1_000);
      const open = await readOpenConnectorSummary(page);
      if (!open || !sameConnectorApp(open, target)) continue;
      return deleteOpenConnectorIfPresent(page);
    }
  }
  return false;
}

async function openExistingConnectorDetails(
  page: Page,
  connectorName: string,
  connectorUrl: string,
  result: ConnectorSetupResult,
): Promise<ExistingConnectorState> {
  const alreadyOpen = await readOpenConnectorState(page, connectorName, connectorUrl);
  if (alreadyOpen !== "missing") return alreadyOpen;

  const button = await findConnectorButton(page, connectorName);
  if (!button) return "missing";

  await button.click({ timeout: 3_000, force: true });
  await page.waitForTimeout(1_000);
  result.steps.push(`Opened existing connector: ${connectorName}.`);
  return readOpenConnectorState(page, connectorName, connectorUrl);
}

async function readOpenConnectorState(
  page: Page,
  connectorName: string,
  connectorUrl: string,
): Promise<ExistingConnectorState> {
  const text = await settingsDialogText(page);
  if (!text.includes(connectorName) || !/\b(URL|App Id|Version Id)\b/i.test(text)) return "missing";
  if (text.includes(connectorUrl)) return "current";
  if (/\bURL\s+https?:\/\//i.test(text)) return "stale";
  return "unknown";
}

async function settingsDialogText(page: Page): Promise<string> {
  return normalizeDisplayText(await page.locator('[role="dialog"]').last().innerText().catch(() => ""));
}

async function findConnectorButton(page: Page, connectorName: string): Promise<Locator | null> {
  const buttons = await page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = normalizeConnectorListLabel(await button.innerText().catch(() => ""));
    if (label === connectorName) return button;
  }
  return null;
}

async function waitForConnectorButton(page: Page, connectorName: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const button = await findConnectorButton(page, connectorName);
    if (button && await button.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

function normalizeConnectorListLabel(value: string): string {
  return normalizeDisplayText(value)
    .replace(/\s+/g, "")
    .replace(/DEV$/i, "");
}

async function refreshOpenConnectorIfPresent(page: Page): Promise<boolean> {
  return clickFirstVisible(page, [
    '[role="dialog"] button:has-text("Refresh")',
  ], 1_000);
}

async function deleteOpenConnectorIfPresent(page: Page): Promise<boolean> {
  const manage = await firstVisible(page, [
    '[role="dialog"] button:has-text("Manage")',
  ]);
  if (!manage) return false;

  await manage.click({ timeout: 2_000, force: true });
  await page.waitForTimeout(500);
  const deleteItem = await firstVisible(page, [
    '[role="menu"] [role="menuitem"]:has-text("Delete")',
    '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
  ]);
  if (!deleteItem) return false;

  await deleteItem.click({ timeout: 2_000, force: true });
  await page.waitForTimeout(500);
  await clickFirstVisible(page, [
    '[role="alertdialog"] button:has-text("Delete")',
    '[role="dialog"] button:has-text("Delete")',
    'button:has-text("Delete app")',
    'button:has-text("Delete App")',
  ], 1_000);
  await page.waitForTimeout(2_000);
  return true;
}

async function returnToConnectorListIfNeeded(page: Page): Promise<void> {
  const back = await firstVisible(page, [
    '[role="dialog"] button:has-text("Back")',
  ]);
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await page.waitForTimeout(750);
  }
}

async function fillFirstVisible(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
  const field = await firstVisible(page, selectors);
  if (!field) return false;
  await field.fill(value);
  await field.dispatchEvent("input").catch(() => {});
  await field.dispatchEvent("change").catch(() => {});
  return true;
}

async function clickFirstVisible(page: Page, selectors: readonly string[], timeout = 1_000): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
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

async function selectNoAuthenticationIfPresent(page: Page): Promise<boolean> {
  const authSelect = page.locator("select#custom-connector-auth").first();
  if (await authSelect.count() > 0 && await authSelect.isVisible().catch(() => false)) {
    await authSelect.selectOption("NONE");
    await authSelect.dispatchEvent("change").catch(() => {});
    return true;
  }

  return clickFirstVisible(page, [
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
  ], 1_000);
}

async function acceptCustomMcpRiskIfPresent(page: Page): Promise<boolean> {
  const checkbox = page.locator('input[data-testid="trust-checkbox"], input[type="checkbox"]').first();
  const isVisible = await checkbox.isVisible().catch(() => false);
  if (await checkbox.count() === 0 || !isVisible) return false;
  if (await checkbox.isChecked().catch(() => false)) return true;
  await checkbox.check({ force: true });
  return true;
}

async function selectConnectorAfterSetup(
  page: Page,
  connectorName: string,
  returnUrl: string | null,
  result: ConnectorSetupResult,
): Promise<void> {
  const selectedInComposer = await selectConnectorInComposer(page, connectorName, returnUrl);
  if (selectedInComposer) {
    result.steps.push("Selected the connector in the composer.");
  } else {
    result.warnings.push("Connector is configured, but the composer menu did not expose it for automatic selection.");
  }
}

async function restoreAfterConnectorSetup(page: Page, returnUrl: string | null): Promise<void> {
  await closeSettingsDialogIfPresent(page);
  await restoreReturnUrlIfNeeded(page, returnUrl);
}

async function selectConnectorInComposer(page: Page, connectorName: string, returnUrl: string | null): Promise<boolean> {
  await closeSettingsDialogIfPresent(page);
  await restoreReturnUrlIfNeeded(page, returnUrl);
  await page.keyboard.press("Escape").catch(() => {});

  if (await isConnectorSelectedInComposer(page, connectorName)) return true;
  await removeStaleBridgeConnectorPills(page, connectorName);
  if (await isConnectorSelectedInComposer(page, connectorName)) return true;

  const plusButton = await firstVisible(page, [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label="Add files and more"]',
    'button[aria-label*="Add files" i]',
  ]);
  if (!plusButton) return false;

  await plusButton.click({ timeout: 5_000, force: true });
  await page.waitForTimeout(750);
  if (await clickConnectorMenuItem(page, connectorName)) return true;

  const moreItem = await firstVisible(page, [
    '[role="menuitem"][aria-haspopup="menu"]:has-text("More")',
    '[role="menuitem"]:has-text("More")',
  ]);
  if (!moreItem) return false;

  await moreItem.hover().catch(() => {});
  await moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await page.waitForTimeout(750);
  return clickConnectorMenuItem(page, connectorName);
}

async function restoreReturnUrlIfNeeded(page: Page, returnUrl: string | null): Promise<void> {
  if (returnUrl && chatGptReturnUrl(page.url()) !== returnUrl) {
    await page.goto(returnUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
}

function chatGptReturnUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("chatgpt.com")) return null;
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname.startsWith("/c/")) return parsed.toString();
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

async function isConnectorSelectedInComposer(page: Page, connectorName: string): Promise<boolean> {
  return !!await findSelectedConnectorPill(page, connectorName);
}

async function findSelectedConnectorPill(page: Page, connectorName: string): Promise<Locator | null> {
  const buttons = await page.locator('button[aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (aria === `${connectorName}, click to remove`) return button;
  }
  return null;
}

async function removeStaleBridgeConnectorPills(page: Page, connectorName: string): Promise<void> {
  const buttons = await page.locator('button[aria-label*="chatgpt-local-bridge"][aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (!aria || aria === `${connectorName}, click to remove`) continue;
    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function closeSettingsDialogIfPresent(page: Page): Promise<void> {
  const closeButton = await firstVisible(page, [
    '[role="dialog"] button[aria-label="Close"]',
    '[role="dialog"] [data-testid="close-button"]',
  ]);
  if (closeButton) {
    await closeButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function clickConnectorMenuItem(page: Page, connectorName: string): Promise<boolean> {
  const item = page.locator(`[role="menu"] [role="menuitem"]:has-text("${connectorName}"), [role="menu"] button:has-text("${connectorName}"), [role="menu"] :text-is("${connectorName}")`).last();
  if (!await item.isVisible().catch(() => false)) return false;
  await item.click({ timeout: 3_000, force: true });
  await page.waitForTimeout(500);
  return true;
}

async function openModelMenu(page: Page): Promise<void> {
  await page.locator(SELECTORS.modelTrigger.join(", ")).first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  const trigger = await firstVisible(page, SELECTORS.modelTrigger);
  if (!trigger) {
    throw new Error("Could not find ChatGPT model switcher button.");
  }
  try {
    await trigger.click({ timeout: 5_000 });
  } catch {
    await trigger.click({ timeout: 5_000, force: true });
  }
  await page.locator(SELECTORS.openMenu).first().waitFor({ state: "visible", timeout: 5_000 });
}

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

async function readCheckedModelFromOpenMenu(page: Page): Promise<string | null> {
  const items = await modelMenuItems(page);
  for (const item of items) {
    if (await isSelectedModelItem(item)) {
      const label = await readModelItemLabel(item);
      if (label) return label;
    }
  }
  return null;
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function firstVisibleIn(parent: Locator, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = parent.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function readModelItemLabel(item: Locator): Promise<string> {
  const testId = await item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }

  return normalizeDisplayText(await item.innerText().catch(() => ""));
}

async function readModelItemId(item: Locator): Promise<string> {
  const testId = await item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) return testId.replace("model-switcher-", "");
  const label = await readModelItemLabel(item);
  return normalizeModelQuery(label).replace(/\s+/g, "-");
}

async function isSelectedModelItem(item: Locator): Promise<boolean> {
  const ariaChecked = await item.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  const dataState = await item.getAttribute("data-state").catch(() => null);
  return dataState === "checked";
}

function normalizeDisplayText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
}

function normalizeModelQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a string looks like a real ChatGPT model name (vs. arbitrary UI text). */
export function isLikelyModelLabel(value: string): boolean {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(value);
}

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;
/**
 * Longer quiet window required when generated assets are present. ChatGPT can
 * briefly hide the stop indicator between sequential images/files in one turn,
 * so a short window would settle early and interrupt the remaining generations.
 */
const ASSET_SETTLE_QUIET_MS = 2_500;

/**
 * Decide whether the current assistant turn has finished producing output.
 *
 * Pure so the completion policy is unit-testable without a browser. A turn is
 * settled only when streaming has stopped AND the relevant content has held
 * still long enough: asset turns need the longer {@link ASSET_SETTLE_QUIET_MS}
 * window (multiple images can arrive in sequence), plain text turns use
 * {@link SETTLE_QUIET_MS}. An empty, asset-less turn never settles, and
 * transient placeholder text (e.g. "Thinking…") does not count as content.
 */
export function isTurnSettled(state: {
  hasText: boolean;
  isTransientText: boolean;
  assetCount: number;
  streaming: boolean;
  stableForMs: number;
}): boolean {
  if (state.streaming) return false;

  const requiredQuietMs = state.assetCount > 0 ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;
  if (state.stableForMs < requiredQuietMs) return false;

  return state.assetCount > 0 || (state.hasText && !state.isTransientText);
}

async function waitForLastAssistantTextStable(page: Page, timeout: number): Promise<void> {
  const startedAt = Date.now();
  let lastText = "";
  let lastAssetCount = 0;
  let stableSince = Date.now();

  while (Date.now() - startedAt < timeout) {
    const text = normalizeDisplayText(await captureLastResponse(page).catch(() => ""));
    const streaming = await page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
    const assetCount = await page.locator(SELECTORS.generatedImage).count().catch(() => 0);

    // Reset the quiet window whenever the text OR the asset count changes, so a
    // newly-arriving 2nd/3rd image keeps the wait alive instead of tripping early.
    if (text !== lastText || assetCount !== lastAssetCount) {
      lastText = text;
      lastAssetCount = assetCount;
      stableSince = Date.now();
    }

    if (
      isTurnSettled({
        hasText: !!text,
        isTransientText: isTransientAssistantText(text),
        assetCount,
        streaming,
        stableForMs: Date.now() - stableSince,
      })
    ) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error("Timed out waiting for ChatGPT response to settle.");
}

async function waitForResponseAfterBaseline(
  page: Page,
  options: {
    previousAssistantCount?: number;
    previousLastAssistantText?: string;
    timeout: number;
  },
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeout) {
    const responses = await page.locator(SELECTORS.responseBlock).all();
    const count = responses.length;
    const lastText = normalizeDisplayText(await captureLastResponse(page).catch(() => ""));
    const streaming = await page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);

    if (
      streaming
      || (options.previousAssistantCount !== undefined && count > options.previousAssistantCount)
      || (!!options.previousLastAssistantText && !!lastText && lastText !== options.previousLastAssistantText)
    ) {
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("Timed out waiting for ChatGPT to start a new response.");
}

function isTransientAssistantText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "thinking"
    || normalized.endsWith(" thinking")
    || normalized.endsWith(" thinking...")
    || /^thinking[.\s]*$/.test(normalized);
}

function remainingTimeout(startedAt: number, timeout: number): number {
  return Math.max(1_000, timeout - (Date.now() - startedAt));
}
