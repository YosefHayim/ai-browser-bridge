import type { Locator, Page } from "playwright";
import {
  clickFirstVisible,
  fillFirstVisible,
  firstVisible,
  normalizeDisplayText,
  SELECTORS,
} from "../chatgpt/conversation/chatgptControls.ts";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "./connectorTypes.ts";

type AppendUniqueSummaryContext = {
  summaries: ConnectorAppSummary[];
  seen: Set<string>;
  summary: ConnectorAppSummary | null;
};

type FindDeleteTargetsContext = {
  summaries: ConnectorAppSummary[];
  connectorName: string;
  connectorUrl: string;
};

type ClickConnectorDetailsButtonContext = {
  button: Locator;
  setup: ConnectorSetupContext;
};

type ClickConnectorEntryButtonContext = {
  button: Locator;
  page: Page;
};

type ClickConnectorListEntryContext = {
  page: Page;
  index: number;
};

type ClickConnectorMenuItemContext = {
  page: ConnectorSetupContext["page"];
  connectorName: string;
};

type ClickMoreMenuItemContext = {
  moreItem: Locator;
  setup: ConnectorSetupContext;
};

type ClickDeleteMenuEntryContext = {
  deleteItem: Locator;
  page: import("playwright").Page;
};

type FindSelectedConnectorPillContext = {
  page: ConnectorSetupContext["page"];
  connectorName: string;
};

type ValueAfterLineContext = {
  lines: string[];
  label: string;
};

type SameConnectorAppContext = {
  a: { appId: string | null; name: string; url: string | null };
  b: { appId: string | null; name: string; url: string | null };
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

type DeleteConnectorAppBySummaryContext = {
  page: ConnectorSetupContext["page"];
  target: ConnectorAppSummary;
};

type DeleteDuplicateTargetsContext = {
  setup: ConnectorSetupContext;
  deleteTargets: ConnectorAppSummary[];
};

type RunConnectorSetupStepsContext = {
  setup: ConnectorSetupContext;
  hasCurrentConnector: boolean;
};

type FindConnectorButtonContext = {
  page: Page;
  connectorName: string;
};

type WaitForConnectorButtonContext = {
  page: Page;
  connectorName: string;
  timeoutMs: number;
};

type InitConnectorSetupContextInput = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupOptions;
};

type CollectConnectorSummariesContext = {
  page: Page;
  entryCount: number;
};

type ReadConnectorSummaryAtIndexContext = {
  page: Page;
  index: number;
};

type ReadOpenConnectorStateContext = {
  page: Page;
  connectorName: string;
  connectorUrl: string;
};

type TryFinalizeExistingConnectorContext = {
  setup: ConnectorSetupContext;
  hasCurrentConnector: boolean;
};

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

const isRiskCheckboxVisible = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const checkbox = setup.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  if ((await checkbox.count()) === 0) return false;
  return checkbox.isVisible().catch(() => false);
};

const acceptCustomMcpRiskIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (!(await isRiskCheckboxVisible(connectorSetupContext))) return false;
  const checkbox = connectorSetupContext.page
    .locator('input[data-testid="trust-checkbox"], input[type="checkbox"]')
    .first();
  if (await checkbox.isChecked().catch(() => false)) return true;
  await checkbox.check({ force: true });
  return true;
};

const appendUniqueSummary = (appendUniqueSummaryContext: AppendUniqueSummaryContext): void => {
  if (!appendUniqueSummaryContext.summary) return;
  const key = connectorSummaryKey(appendUniqueSummaryContext.summary);
  if (appendUniqueSummaryContext.seen.has(key)) return;
  appendUniqueSummaryContext.seen.add(key);
  appendUniqueSummaryContext.summaries.push(appendUniqueSummaryContext.summary);
};

const chatGptReturnUrl = (url: string): string | null => {
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
};

const findDeleteTargets = (
  findDeleteTargetsContext: FindDeleteTargetsContext,
): ConnectorAppSummary[] => {
  const current = findDeleteTargetsContext.summaries.find(
    (summary) =>
      summary.name === findDeleteTargetsContext.connectorName &&
      summary.url === findDeleteTargetsContext.connectorUrl,
  );
  return findDeleteTargetsContext.summaries.filter((summary) => {
    if (summary.name !== findDeleteTargetsContext.connectorName) return true;
    if (summary.url !== findDeleteTargetsContext.connectorUrl) return true;
    if (current === undefined) return true;
    return !sameConnectorApp({ a: summary, b: current });
  });
};

const cleanupDuplicateConnectorApps = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  const summaries = await listBridgeConnectorSummaries(connectorSetupContext.page);
  const current = summaries.find(
    (summary) =>
      summary.name === connectorSetupContext.connectorName &&
      summary.url === connectorSetupContext.connectorUrl,
  );
  await deleteDuplicateTargets({
    setup: connectorSetupContext,
    deleteTargets: findDeleteTargets({
      summaries,
      connectorName: connectorSetupContext.connectorName,
      connectorUrl: connectorSetupContext.connectorUrl,
    }),
  });
  await openConnectorList(connectorSetupContext.page);
  return current !== undefined;
};

const clickConnectorDetailsButton = async (
  clickConnectorDetailsButtonContext: ClickConnectorDetailsButtonContext,
): Promise<void> => {
  await clickConnectorDetailsButtonContext.button.click({ timeout: 3_000, force: true });
  await clickConnectorDetailsButtonContext.setup.page.waitForTimeout(1_000);
  clickConnectorDetailsButtonContext.setup.result.steps.push(
    `Opened existing connector: ${clickConnectorDetailsButtonContext.setup.connectorName}.`,
  );
};

const clickConnectorEntryButton = async (
  clickConnectorEntryButtonContext: ClickConnectorEntryButtonContext,
): Promise<void> => {
  await clickConnectorEntryButtonContext.button.click({ timeout: 3_000, force: true });
  await clickConnectorEntryButtonContext.page.waitForTimeout(1_000);
};

const clickConnectorFromMoreMenu = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (!(await hoverAndClickMoreMenuItem(connectorSetupContext))) return false;
  return clickConnectorMenuItem({
    page: connectorSetupContext.page,
    connectorName: connectorSetupContext.connectorName,
  });
};

const clickConnectorListEntry = async (
  clickConnectorListEntryContext: ClickConnectorListEntryContext,
): Promise<boolean> => {
  await openConnectorList(clickConnectorListEntryContext.page);
  const entry = (await findBridgeConnectorButtons(clickConnectorListEntryContext.page))[
    clickConnectorListEntryContext.index
  ];
  if (!entry) return false;
  await clickConnectorEntryButton({
    button: entry.button,
    page: clickConnectorListEntryContext.page,
  });
  return true;
};

const clickConnectorMenuItem = async (
  clickConnectorMenuItemContext: ClickConnectorMenuItemContext,
): Promise<boolean> => {
  const item = clickConnectorMenuItemContext.page
    .locator(
      `[role="menu"] [role="menuitem"]:has-text("${clickConnectorMenuItemContext.connectorName}"), [role="menu"] button:has-text("${clickConnectorMenuItemContext.connectorName}"), [role="menu"] :text-is("${clickConnectorMenuItemContext.connectorName}")`,
    )
    .last();
  if (!(await item.isVisible().catch(() => false))) return false;
  await item.click({ timeout: 3_000, force: true });
  await clickConnectorMenuItemContext.page.waitForTimeout(500);
  return true;
};

const clickDeleteConfirmation = async (page: Page): Promise<void> => {
  await clickFirstVisible({
    page: page,
    selectors: [
      '[role="alertdialog"] button:has-text("Delete")',
      '[role="dialog"] button:has-text("Delete")',
      'button:has-text("Delete app")',
      'button:has-text("Delete App")',
    ],
    timeout: 1_000,
  });
  await page.waitForTimeout(2_000);
};

const clickDeleteMenuItem = async (page: Page) => {
  return firstVisible({
    page: page,
    selectors: [
      '[role="menu"] [role="menuitem"]:has-text("Delete")',
      '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
    ],
  });
};

const clickMoreMenuItem = async (
  clickMoreMenuItemContext: ClickMoreMenuItemContext,
): Promise<void> => {
  await clickMoreMenuItemContext.moreItem.hover().catch(() => {});
  await clickMoreMenuItemContext.moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await clickMoreMenuItemContext.setup.page.waitForTimeout(750);
};

const clickSettingsEntry = async (setup: ConnectorSetupContext): Promise<void> => {
  const openedSettings = await clickFirstVisible({
    page: setup.page,
    selectors: SELECTORS.settingsEntrypoint,
    timeout: 2_000,
  });
  if (openedSettings) {
    setup.result.steps.push("Opened ChatGPT settings.");
    await setup.page.waitForTimeout(1_000);
  } else {
    setup.result.warnings.push("Could not find Settings in the account menu.");
  }
};

const closeSettingsDialogIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const closeButton = await firstVisible({
    page: connectorSetupContext.page,
    selectors: [
      '[role="dialog"] button[aria-label="Close"]',
      '[role="dialog"] [data-testid="close-button"]',
    ],
  });
  if (closeButton) {
    await closeButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await connectorSetupContext.page.waitForTimeout(500);
  }
};

const clickDeleteMenuEntry = async (
  clickDeleteMenuEntryContext: ClickDeleteMenuEntryContext,
): Promise<void> => {
  await clickDeleteMenuEntryContext.deleteItem.click({ timeout: 2_000, force: true });
  await clickDeleteMenuEntryContext.page.waitForTimeout(500);
  await clickDeleteConfirmation(clickDeleteMenuEntryContext.page);
};

const confirmOpenConnectorDeletion = async (page: import("playwright").Page): Promise<boolean> => {
  const deleteItem = await clickDeleteMenuItem(page);
  if (!deleteItem) return false;
  await clickDeleteMenuEntry({ deleteItem, page: page });
  return true;
};

const findSelectedConnectorPill = async (
  findSelectedConnectorPillContext: FindSelectedConnectorPillContext,
): Promise<Locator | null> => {
  const buttons = await findSelectedConnectorPillContext.page
    .locator('button[aria-label*="click to remove"]')
    .all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (aria === `${findSelectedConnectorPillContext.connectorName}, click to remove`)
      return button;
  }
  return null;
};

const isConnectorSelectedInComposer = async (setup: ConnectorSetupContext): Promise<boolean> => {
  return !!(await findSelectedConnectorPill({
    page: setup.page,
    connectorName: setup.connectorName,
  }));
};

const removeStaleBridgeConnectorPills = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const buttons = await connectorSetupContext.page
    .locator('button[aria-label*="ai-browser-bridge"][aria-label*="click to remove"]')
    .all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (!aria || aria === `${connectorSetupContext.connectorName}, click to remove`) continue;
    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await connectorSetupContext.page.waitForTimeout(250);
  }
};

const normalizeConnectorListLabel = (value: string): string => {
  return normalizeDisplayText(value).replace(/\s+/g, "").replace(/DEV$/i, "");
};

const valueAfterLine = (valueAfterLineContext: ValueAfterLineContext): string | null => {
  const index = valueAfterLineContext.lines.indexOf(valueAfterLineContext.label);
  const value = index >= 0 ? valueAfterLineContext.lines[index + 1] : null;
  return value?.trim() || null;
};

const connectorSummaryKey = (summary: {
  name: string;
  appId: string | null;
  url: string | null;
}): string => {
  const appId = summary.appId === undefined ? "" : summary.appId;
  const summaryUrl = summary.url === undefined ? "" : summary.url;
  return `${summary.name}\u0000${appId}\u0000${summaryUrl}`;
};

const sameConnectorApp = (sameConnectorAppContext: SameConnectorAppContext): boolean => {
  if (sameConnectorAppContext.a.appId && sameConnectorAppContext.b.appId)
    return sameConnectorAppContext.a.appId === sameConnectorAppContext.b.appId;
  return (
    sameConnectorAppContext.a.name === sameConnectorAppContext.b.name &&
    sameConnectorAppContext.a.url === sameConnectorAppContext.b.url
  );
};

const warnMissingConnectorUrlField = async (setup: ConnectorSetupContext): Promise<void> => {
  setup.result.warnings.push(
    "Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.",
  );
  if (setup.options.automatic) await restoreAfterConnectorSetup(setup);
};

const createNewConnector = async (connectorSetupContext: ConnectorSetupContext): Promise<void> => {
  await openAdvancedSettingsIfPresent(connectorSetupContext);
  await enableDeveloperModeIfPresent(connectorSetupContext);
  await openCreateConnectorForm(connectorSetupContext);
  if (!(await fillConnectorFormFields(connectorSetupContext))) {
    await warnMissingConnectorUrlField(connectorSetupContext);
    return;
  }
  await finishConnectorCreation(connectorSetupContext);
};

const deleteConnectorAppBySummary = async (
  deleteConnectorAppBySummaryContext: DeleteConnectorAppBySummaryContext,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openConnectorList(deleteConnectorAppBySummaryContext.page);
    const entries = await findBridgeConnectorButtons(deleteConnectorAppBySummaryContext.page);
    for (const entry of entries) {
      if (entry.name !== deleteConnectorAppBySummaryContext.target.name) continue;
      await entry.button.click({ timeout: 3_000, force: true });
      await deleteConnectorAppBySummaryContext.page.waitForTimeout(1_000);
      const open = await readOpenConnectorSummary(deleteConnectorAppBySummaryContext.page);
      if (!open || !sameConnectorApp({ a: open, b: deleteConnectorAppBySummaryContext.target }))
        continue;
      return deleteOpenConnectorIfPresent(deleteConnectorAppBySummaryContext.page);
    }
  }
  return false;
};

const deleteDuplicateTargets = async (
  deleteDuplicateTargetsContext: DeleteDuplicateTargetsContext,
): Promise<void> => {
  for (const target of deleteDuplicateTargetsContext.deleteTargets) {
    const deleted = await deleteConnectorAppBySummary({
      page: deleteDuplicateTargetsContext.setup.page,
      target,
    });
    if (deleted) {
      deleteDuplicateTargetsContext.setup.result.steps.push(
        `Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`,
      );
    } else {
      deleteDuplicateTargetsContext.setup.result.warnings.push(
        `Could not delete duplicate connector app: ${target.name}.`,
      );
    }
  }
};

const deleteOpenConnectorIfPresent = async (page: Page): Promise<boolean> => {
  const manage = await firstVisible({
    page: page,
    selectors: ['[role="dialog"] button:has-text("Manage")'],
  });
  if (!manage) return false;
  await manage.click({ timeout: 2_000, force: true });
  await page.waitForTimeout(500);
  return confirmOpenConnectorDeletion(page);
};

const enableDeveloperModeIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const outcome = await connectorSetupContext.page.evaluate(ENABLE_DEVELOPER_MODE_SNIPPET);
  if (outcome === "enabled") {
    connectorSetupContext.result.steps.push("Enabled Developer mode.");
    await connectorSetupContext.page.waitForTimeout(750);
    return;
  }
  if (outcome === "already-enabled") {
    connectorSetupContext.result.steps.push("Developer mode was already enabled.");
    return;
  }
  connectorSetupContext.result.warnings.push(
    "Could not find the Developer mode toggle. It may already be enabled or unavailable for this account/workspace.",
  );
};

const ensureComposerConnectorSelected = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (await isConnectorSelectedInComposer(connectorSetupContext)) return true;
  await removeStaleBridgeConnectorPills(connectorSetupContext);
  if (await isConnectorSelectedInComposer(connectorSetupContext)) return true;
  return openComposerConnectorMenu(connectorSetupContext);
};

const runConnectorSetupSteps = async (
  runConnectorSetupStepsContext: RunConnectorSetupStepsContext,
): Promise<ConnectorSetupContext["result"]> => {
  if (
    await tryFinalizeExistingConnector({
      setup: runConnectorSetupStepsContext.setup,
      hasCurrentConnector: runConnectorSetupStepsContext.hasCurrentConnector,
    })
  ) {
    return runConnectorSetupStepsContext.setup.result;
  }
  if (!(await handleStaleExistingConnector(runConnectorSetupStepsContext.setup)))
    return runConnectorSetupStepsContext.setup.result;
  await createNewConnector(runConnectorSetupStepsContext.setup);
  return runConnectorSetupStepsContext.setup.result;
};

const executeConnectorSetup = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<ConnectorSetupContext["result"]> => {
  await openChatGptSettings(connectorSetupContext);
  await openAppsOrConnectorsPanel(connectorSetupContext);
  const hasCurrentConnector = await cleanupDuplicateConnectorApps(connectorSetupContext);
  return runConnectorSetupSteps({ setup: connectorSetupContext, hasCurrentConnector });
};

const fillConnectorUrlField = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const filledUrl = await fillFirstVisible({
    page: setup.page,
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
    value: setup.connectorUrl,
  });
  if (filledUrl) setup.result.steps.push(`Filled connector URL: ${setup.connectorUrl}`);
  return filledUrl;
};

const fillConnectorNameField = async (setup: ConnectorSetupContext): Promise<void> => {
  const filledName = await fillFirstVisible({
    page: setup.page,
    selectors: [
      'input[name="custom-connector-name"]',
      "#custom-connector-name",
      'input[name*="name" i]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
    ],
    value: setup.connectorName,
  });
  if (filledName) setup.result.steps.push(`Filled connector name: ${setup.connectorName}`);
};

const fillConnectorFormFields = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (!(await fillConnectorUrlField(connectorSetupContext))) return false;
  await fillConnectorNameField(connectorSetupContext);
  return true;
};

const finalizeCurrentConnector = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  connectorSetupContext.result.completed = true;
  connectorSetupContext.result.steps.push("Existing connector already uses the current URL.");
  if (await refreshOpenConnectorIfPresent(connectorSetupContext)) {
    connectorSetupContext.result.steps.push("Refreshed the connector tool schema.");
  }
  await selectConnectorAfterSetup(connectorSetupContext);
};

const findBridgeConnectorButtons = async (
  page: Page,
): Promise<Array<{ button: Locator; name: string }>> => {
  const buttons = await page.locator('[role="dialog"] button').all();
  const entries: Array<{ button: Locator; name: string }> = [];
  for (const button of buttons) {
    const label = normalizeConnectorListLabel(await button.innerText().catch(() => ""));
    if (label.startsWith(BRIDGE_CONNECTOR_PREFIX)) {
      entries.push({ button, name: label });
    }
  }
  return entries;
};

const findConnectorButton = async (
  findConnectorButtonContext: FindConnectorButtonContext,
): Promise<Locator | null> => {
  const buttons = await findConnectorButtonContext.page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = normalizeConnectorListLabel(await button.innerText().catch(() => ""));
    if (label === findConnectorButtonContext.connectorName) return button;
  }
  return null;
};

const waitForConnectorButton = async (
  waitForConnectorButtonContext: WaitForConnectorButtonContext,
): Promise<boolean> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitForConnectorButtonContext.timeoutMs) {
    const button = await findConnectorButton({
      page: waitForConnectorButtonContext.page,
      connectorName: waitForConnectorButtonContext.connectorName,
    });
    if (button && (await button.isVisible().catch(() => false))) return true;
    await waitForConnectorButtonContext.page.waitForTimeout(500);
  }
  return false;
};

const recordConnectorFormOptions = async (setup: ConnectorSetupContext): Promise<void> => {
  if (await selectNoAuthenticationIfPresent(setup)) {
    setup.result.steps.push("Selected no-authentication option when visible.");
  }
  if (await acceptCustomMcpRiskIfPresent(setup)) {
    setup.result.steps.push("Accepted custom MCP server risk notice.");
  }
};

const finishConnectorCreation = async (setup: ConnectorSetupContext): Promise<void> => {
  await recordConnectorFormOptions(setup);
  await submitConnectorForm(setup);
  if (setup.options.automatic && !setup.result.completed) {
    await restoreAfterConnectorSetup(setup);
  }
};

const handleStaleExistingConnector = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(connectorSetupContext);
  if (existing === "stale") return deleteStaleConnector(connectorSetupContext);
  if (existing === "unknown") {
    connectorSetupContext.result.warnings.push(
      "Existing connector was found, but its URL could not be read from the settings panel.",
    );
  }
  return true;
};

const deleteStaleConnector = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (await deleteOpenConnectorIfPresent(connectorSetupContext.page)) {
    connectorSetupContext.result.steps.push(
      "Deleted stale connector app before recreating it with the new tunnel URL.",
    );
    await returnToConnectorListIfNeeded(connectorSetupContext);
    await openAppsOrConnectorsPanel(connectorSetupContext);
    await openAdvancedSettingsIfPresent(connectorSetupContext);
    return true;
  }
  connectorSetupContext.result.warnings.push(
    "Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.",
  );
  if (connectorSetupContext.options.automatic)
    await restoreAfterConnectorSetup(connectorSetupContext);
  return false;
};

const hoverAndClickMoreMenuItem = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const moreItem = await firstVisible({
    page: setup.page,
    selectors: [
      '[role="menuitem"][aria-haspopup="menu"]:has-text("More")',
      '[role="menuitem"]:has-text("More")',
    ],
  });
  if (!moreItem) return false;
  await clickMoreMenuItem({ moreItem, setup: setup });
  return true;
};

const initConnectorSetupContext = (
  input: InitConnectorSetupContextInput,
): ConnectorSetupContext => {
  const connectorName =
    input.options.connectorName === undefined
      ? DEFAULT_CONNECTOR_NAME
      : input.options.connectorName;
  const returnUrl = chatGptReturnUrl(input.page.url());
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

const collectConnectorSummaries = async (
  collectConnectorSummariesContext: CollectConnectorSummariesContext,
): Promise<ConnectorAppSummary[]> => {
  const summaries: ConnectorAppSummary[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < collectConnectorSummariesContext.entryCount; index += 1) {
    appendUniqueSummary({
      summaries,
      seen,
      summary: await readConnectorSummaryAtIndex({
        page: collectConnectorSummariesContext.page,
        index,
      }),
    });
  }
  return summaries;
};

const listBridgeConnectorSummaries = async (page: Page): Promise<ConnectorAppSummary[]> => {
  await openConnectorList(page);
  const entryCount = (await findBridgeConnectorButtons(page)).length;
  const summaries = await collectConnectorSummaries({
    page: page,
    entryCount,
  });
  await openConnectorList(page);
  return summaries;
};

const openAdvancedSettingsIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const opened = await clickFirstVisible({
    page: connectorSetupContext.page,
    selectors: [
      'button:has-text("Advanced settings")',
      'button:has-text("Advanced Settings")',
      'a:has-text("Advanced settings")',
      '[role="tab"]:has-text("Advanced")',
      'button:has-text("Advanced")',
    ],
    timeout: 1_500,
  });
  if (opened) connectorSetupContext.result.steps.push("Opened Advanced settings.");
};

const openAppsOrConnectorsPanel = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const opened = await clickFirstVisible({
    page: connectorSetupContext.page,
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
    connectorSetupContext.result.steps.push("Opened Apps/Connectors settings.");
  } else {
    connectorSetupContext.result.warnings.push(
      "Could not find Apps/Connectors in settings. Use Settings -> Apps manually.",
    );
  }
};

const openChatGptSettings = async (connectorSetupContext: ConnectorSetupContext): Promise<void> => {
  await connectorSetupContext.page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await connectorSetupContext.page.waitForTimeout(1_500);
  const settingsDialogOpen = await connectorSetupContext.page
    .locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")')
    .first()
    .isVisible()
    .catch(() => false);
  if (settingsDialogOpen) {
    connectorSetupContext.result.steps.push("Opened ChatGPT settings.");
    return;
  }
  await openSettingsFromAccountMenu(connectorSetupContext);
};

const openComposerPlusMenu = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const plusButton = await firstVisible({
    page: setup.page,
    selectors: [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files" i]',
    ],
  });
  if (!plusButton) return false;
  await plusButton.click({ timeout: 5_000, force: true });
  await setup.page.waitForTimeout(750);
  return true;
};

const openComposerConnectorMenu = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  if (!(await openComposerPlusMenu(connectorSetupContext))) return false;
  if (
    await clickConnectorMenuItem({
      page: connectorSetupContext.page,
      connectorName: connectorSetupContext.connectorName,
    })
  )
    return true;
  return clickConnectorFromMoreMenu(connectorSetupContext);
};

const openConnectorDetailsPanel = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const button = await findConnectorButton({
    page: setup.page,
    connectorName: setup.connectorName,
  });
  if (!button) return false;
  await clickConnectorDetailsButton({ button, setup: setup });
  return true;
};

const openConnectorList = async (page: Page): Promise<void> => {
  await page
    .goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await page.waitForTimeout(1_000);
  const backButton = await firstVisible({
    page: page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await page.waitForTimeout(750);
  }
};

const openCreateConnectorForm = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const opened = await clickFirstVisible({
    page: connectorSetupContext.page,
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
    connectorSetupContext.result.steps.push("Opened connector/app creation form.");
  } else {
    connectorSetupContext.result.warnings.push(
      "Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.",
    );
  }
};

const readConnectorState = (setup: ConnectorSetupContext) => {
  return readOpenConnectorState({
    page: setup.page,
    connectorName: setup.connectorName,
    connectorUrl: setup.connectorUrl,
  });
};

const openExistingConnectorDetails = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<ExistingConnectorState> => {
  const alreadyOpen = await readConnectorState(connectorSetupContext);
  if (alreadyOpen !== "missing") return alreadyOpen;
  if (!(await openConnectorDetailsPanel(connectorSetupContext))) return "missing";
  return readConnectorState(connectorSetupContext);
};

const openSettingsFromAccountMenu = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  await connectorSetupContext.page
    .goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await connectorSetupContext.page
    .waitForSelector(SELECTORS.promptInput, { timeout: 15_000 })
    .catch(() => {});
  if (
    !(await clickFirstVisible({
      page: connectorSetupContext.page,
      selectors: SELECTORS.accountMenuButton,
      timeout: 2_000,
    }))
  ) {
    connectorSetupContext.result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }
  connectorSetupContext.result.steps.push("Opened ChatGPT account menu.");
  await clickSettingsEntry(connectorSetupContext);
};

const readConnectorSummaryAtIndex = async (
  readConnectorSummaryAtIndexContext: ReadConnectorSummaryAtIndexContext,
) => {
  if (
    !(await clickConnectorListEntry({
      page: readConnectorSummaryAtIndexContext.page,
      index: readConnectorSummaryAtIndexContext.index,
    }))
  )
    return null;
  return readOpenConnectorSummary(readConnectorSummaryAtIndexContext.page);
};

const readOpenConnectorState = async (
  readOpenConnectorStateContext: ReadOpenConnectorStateContext,
): Promise<ExistingConnectorState> => {
  const text = await settingsDialogText(readOpenConnectorStateContext.page);
  if (
    !text.includes(readOpenConnectorStateContext.connectorName) ||
    !/\b(URL|App Id|Version Id)\b/i.test(text)
  )
    return "missing";
  if (text.includes(readOpenConnectorStateContext.connectorUrl)) return "current";
  if (/\bURL\s+https?:\/\//i.test(text)) return "stale";
  return "unknown";
};

const parseConnectorSummaryLines = (lines: string[]): ConnectorAppSummary | null => {
  const backIndex = lines.indexOf("Back");
  let name = "";
  if (backIndex >= 0) {
    const nextLine = lines[backIndex + 1];
    name = nextLine === undefined ? "" : nextLine;
  }
  if (!name.startsWith(BRIDGE_CONNECTOR_PREFIX)) return null;
  return {
    name,
    appId: valueAfterLine({ lines: lines, label: "App Id" }),
    url: valueAfterLine({ lines: lines, label: "URL" }),
  };
};

const readOpenConnectorSummary = async (page: Page): Promise<ConnectorAppSummary | null> => {
  const text = await page
    .locator('[role="dialog"]')
    .last()
    .innerText()
    .catch(() => "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return parseConnectorSummaryLines(lines);
};

const refreshOpenConnectorIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  return clickFirstVisible({
    page: connectorSetupContext.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: 1_000,
  });
};

const restoreAfterConnectorSetup = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  await closeSettingsDialogIfPresent(connectorSetupContext);
  await restoreReturnUrlIfNeeded(connectorSetupContext);
};

const restoreReturnUrlIfNeeded = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  if (
    connectorSetupContext.returnUrl &&
    chatGptReturnUrl(connectorSetupContext.page.url()) !== connectorSetupContext.returnUrl
  ) {
    await connectorSetupContext.page
      .goto(connectorSetupContext.returnUrl, { waitUntil: "domcontentloaded" })
      .catch(() => {});
  }
  await connectorSetupContext.page
    .waitForSelector(SELECTORS.promptInput, { timeout: 15_000 })
    .catch(() => {});
};

const returnToConnectorListIfNeeded = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const back = await firstVisible({
    page: connectorSetupContext.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (back) {
    await back.click({ timeout: 2_000, force: true }).catch(() => {});
    await connectorSetupContext.page.waitForTimeout(750);
  }
};

const selectConnectorAfterSetup = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<void> => {
  const selectedInComposer = await selectConnectorInComposer(connectorSetupContext);
  if (selectedInComposer) {
    connectorSetupContext.result.steps.push("Selected the connector in the composer.");
  } else {
    connectorSetupContext.result.warnings.push(
      "Connector is configured, but the composer menu did not expose it for automatic selection.",
    );
  }
};

const selectConnectorInComposer = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  await closeSettingsDialogIfPresent(connectorSetupContext);
  await restoreReturnUrlIfNeeded(connectorSetupContext);
  await connectorSetupContext.page.keyboard.press("Escape").catch(() => {});
  return ensureComposerConnectorSelected(connectorSetupContext);
};

const selectNoAuthenticationIfPresent = async (
  connectorSetupContext: ConnectorSetupContext,
): Promise<boolean> => {
  const authSelect = connectorSetupContext.page.locator("select#custom-connector-auth").first();
  if ((await authSelect.count()) > 0 && (await authSelect.isVisible().catch(() => false))) {
    await authSelect.selectOption("NONE");
    await authSelect.dispatchEvent("change").catch(() => {});
    return true;
  }
  return clickFirstVisible({
    page: connectorSetupContext.page,
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

const settingsDialogText = async (page: Page): Promise<string> => {
  return normalizeDisplayText(
    await page
      .locator('[role="dialog"]')
      .last()
      .innerText()
      .catch(() => ""),
  );
};

export const setupMcpConnectorInChatGpt = async (
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  return executeConnectorSetup(initConnectorSetupContext({ page, connectorUrl, options }));
};

const connectorFormStillOpen = async (setup: ConnectorSetupContext): Promise<boolean> => {
  return setup.page
    .locator('input[name="custom-connector-url"], #custom-connector-url')
    .first()
    .isVisible()
    .catch(() => false);
};

const markConnectorSubmitCompleted = async (setup: ConnectorSetupContext): Promise<void> => {
  setup.result.completed = true;
  setup.result.steps.push("Submitted the connector form.");
  await selectConnectorAfterSetup(setup);
};

const warnConnectorSubmitIncomplete = async (setup: ConnectorSetupContext): Promise<void> => {
  const appVisible = await waitForConnectorButton({
    page: setup.page,
    connectorName: setup.connectorName,
    timeoutMs: 20_000,
  });
  const formStillOpen = await connectorFormStillOpen(setup);
  if (formStillOpen && !appVisible) {
    setup.result.warnings.push(
      "Connector form is still open after submit. Check the visible validation message in ChatGPT settings.",
    );
    return;
  }
  await markConnectorSubmitCompleted(setup);
};

const submitConnectorForm = async (connectorSetupContext: ConnectorSetupContext): Promise<void> => {
  const submitted = await clickFirstVisible({
    page: connectorSetupContext.page,
    selectors: [
      'button:has-text("Create")',
      'button:has-text("Save")',
      'button:has-text("Add")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
  });
  if (!submitted) {
    connectorSetupContext.result.warnings.push(
      "Connector form was filled, but no Create/Save/Add button was visible or enabled.",
    );
    return;
  }
  await warnConnectorSubmitIncomplete(connectorSetupContext);
};

const finalizeIfCurrentConnector = async (setup: ConnectorSetupContext): Promise<boolean> => {
  const existing = await openExistingConnectorDetails(setup);
  if (existing !== "current") return false;
  await finalizeCurrentConnector(setup);
  return true;
};

const tryFinalizeExistingConnector = async (
  tryFinalizeExistingConnectorContext: TryFinalizeExistingConnectorContext,
): Promise<boolean> => {
  if (
    tryFinalizeExistingConnectorContext.hasCurrentConnector &&
    (await finalizeIfCurrentConnector(tryFinalizeExistingConnectorContext.setup))
  )
    return true;
  return finalizeIfCurrentConnector(tryFinalizeExistingConnectorContext.setup);
};
