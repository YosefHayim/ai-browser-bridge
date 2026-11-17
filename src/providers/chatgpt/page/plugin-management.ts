import type { Locator, Page } from "playwright";
import {
  CHATGPT_ORIGIN_URL,
  FIVE_SECONDS_MILLISECONDS,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  type ConnectorSetupRun,
  throwIfSetupStopped,
} from "@/providers/chatgpt/page/connector-setup.ts";
import { SETTLE_QUIET_MILLISECONDS } from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";
import { PLUGINS_SETTINGS_URL } from "@/providers/chatgpt/page/snapshot-attachments.ts";
import {
  isTunnelReplyAnswering,
  type PluginSummary,
  pickCreateDialogErrorLine,
  readPluginNameFromRowText,
  readServerUrlFromText,
} from "@/providers/chatgpt/plugin-setup-logic.ts";
import { readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { HTML_PARSED_WAIT } from "@/providers/engine/page-probes.ts";

export async function listPluginSummaries(details: ConnectorSetupRun): Promise<PluginSummary[]> {
  const page = details.page;
  await page.goto(PLUGINS_SETTINGS_URL, { waitUntil: HTML_PARSED_WAIT });
  await page
    .getByPlaceholder("Search installed plugins")
    .fill(details.connectorName, { timeout: FIVE_SECONDS_MILLISECONDS });
  await page.waitForTimeout(SETTLE_QUIET_MILLISECONDS);

  // Rows are read before any navigation, because the list page is left behind by the first detail visit.
  const pluginRowLocators = await page.locator('main a[href*="/plugins-settings/plugin_"]').all();
  const pluginRows: { rowText: string; detailUrl: string }[] = [];
  for (const pluginRowLocator of pluginRowLocators) {
    const rowText = await readVisibleCopy(pluginRowLocator);
    const rowHref = (await pluginRowLocator.getAttribute("href")) ?? "";
    const detailUrl = new URL(rowHref, CHATGPT_ORIGIN_URL).toString();
    pluginRows.push({ rowText, detailUrl });
  }

  const pluginSummaries: PluginSummary[] = [];
  for (const pluginRow of pluginRows) {
    throwIfSetupStopped(details);
    const pluginName = readPluginNameFromRowText(pluginRow.rowText);

    // Only same-name plugins are ever opened, so the list visit stays inside the setup deadline.
    const isOtherPlugin = pluginName !== details.connectorName;
    if (isOtherPlugin) continue;

    const serverUrl = await readPluginServerUrl({
      page,
      detailUrl: pluginRow.detailUrl,
      connectorUrl: details.connectorUrl,
    });
    pluginSummaries.push({
      name: pluginName,
      detailUrl: pluginRow.detailUrl,
      serverUrl,
    });
  }
  return pluginSummaries;
}

async function readPluginServerUrl(details: {
  page: Page;
  detailUrl: string;
  connectorUrl: string;
}): Promise<string | null> {
  await details.page.goto(details.detailUrl, { waitUntil: HTML_PARSED_WAIT });
  await details.page
    .getByRole("button", { name: "Uninstall", exact: true })
    .waitFor({ timeout: FIVE_SECONDS_MILLISECONDS });

  const pageText = await readVisibleCopy(details.page.locator("body"));
  return readServerUrlFromText({ text: pageText, connectorUrl: details.connectorUrl });
}

export async function deleteStalePlugins(details: {
  setup: ConnectorSetupRun;
  plugins: PluginSummary[];
}): Promise<void> {
  for (const stalePlugin of details.plugins) {
    throwIfSetupStopped(details.setup);
    await deletePluginApp({ page: details.setup.page, detailUrl: stalePlugin.detailUrl });
    details.setup.result.steps.push(
      `Deleted plugin "${details.setup.connectorName}" with an old tunnel URL.`,
    );
  }
}

// Delete app removes the app itself. Uninstall alone leaves the app behind, and its name then blocks the create.
async function deletePluginApp(details: { page: Page; detailUrl: string }): Promise<void> {
  await details.page.goto(details.detailUrl, { waitUntil: HTML_PARSED_WAIT });
  await details.page
    .getByRole("button", { name: "Delete app", exact: true })
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });

  await details.page.waitForTimeout(SETTLE_QUIET_MILLISECONDS);
  await details.page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete app", exact: true })
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });

  await waitForPluginToLeaveList(details);
}

// The list is reloaded on each try, because a removal can finish after the first load.
async function waitForPluginToLeaveList(details: { page: Page; detailUrl: string }): Promise<void> {
  const pluginPathName = new URL(details.detailUrl).pathname;
  const listCheckAttempts = 6;
  const listCheckWaitMilliseconds = 5_000;

  for (let attempt = 0; attempt < listCheckAttempts; attempt += 1) {
    await details.page.goto(PLUGINS_SETTINGS_URL, { waitUntil: HTML_PARSED_WAIT });
    await details.page.waitForTimeout(SETTLE_QUIET_MILLISECONDS);

    const isPluginStillListed =
      (await details.page.locator(`main a[href="${pluginPathName}"]`).count()) > 0;
    if (!isPluginStillListed) return;

    await details.page.waitForTimeout(listCheckWaitMilliseconds);
  }

  throw new Error(`Plugin is still listed after delete: ${details.detailUrl}`);
}

// A server that is not up yet fails the request; the caller waits and asks again.
async function isConnectorUrlAnswering(details: ConnectorSetupRun): Promise<boolean> {
  const replyTimeoutSignal = AbortSignal.timeout(FIVE_SECONDS_MILLISECONDS);
  const setupSignal = details.options.signal;
  const isSetupSignalMissing = setupSignal == null;
  const requestSignal = isSetupSignalMissing
    ? replyTimeoutSignal
    : AbortSignal.any([setupSignal, replyTimeoutSignal]);

  try {
    const connectorReply = await fetch(details.connectorUrl, { signal: requestSignal });
    await connectorReply.body?.cancel();
    return isTunnelReplyAnswering(connectorReply.status);
  } catch {
    return false;
  }
}

// ChatGPT lists the plugin only after its server answers, so Create waits for the tunnel.
export async function waitForTunnelToAnswer(details: ConnectorSetupRun): Promise<void> {
  const retryWaitMilliseconds = 1_000;
  const tunnelAnswerDeadlineMilliseconds = 60_000;
  const tunnelAnswerDeadlineSignal = AbortSignal.timeout(tunnelAnswerDeadlineMilliseconds);

  for (;;) {
    throwIfSetupStopped(details);
    const isTunnelAnswering = await isConnectorUrlAnswering(details);
    if (isTunnelAnswering) return;

    const isDeadlineReached = tunnelAnswerDeadlineSignal.aborted;
    if (isDeadlineReached) {
      throw new Error(
        `The connector URL did not answer within ${tunnelAnswerDeadlineMilliseconds / 1_000} seconds.`,
      );
    }

    await details.page.waitForTimeout(retryWaitMilliseconds);
  }
}

// Returns null when the plugin was created, or the warning text to show when it was not.
export async function addCustomMcpPlugin(details: ConnectorSetupRun): Promise<string | null> {
  const page = details.page;
  await page.goto("https://chatgpt.com/plugins", { waitUntil: HTML_PARSED_WAIT });
  await page
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });
  await page
    .getByRole("menuitem", { name: "Add custom MCP server", exact: true })
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });

  const createForm = page.getByRole("dialog").filter({ hasText: "Create as a plugin" });
  await createForm
    .getByLabel("Name", { exact: true })
    .fill(details.connectorName, { timeout: FIVE_SECONDS_MILLISECONDS });

  const serverUrlConnectionButton = createForm.getByRole("button", {
    name: "Server URL",
    exact: true,
  });
  const isServerUrlConnectionPressed =
    (await serverUrlConnectionButton.getAttribute("aria-pressed")) === "true";
  if (!isServerUrlConnectionPressed) {
    await serverUrlConnectionButton.click({ timeout: FIVE_SECONDS_MILLISECONDS });
  }

  await createForm
    .getByLabel("Server URL", { exact: true })
    .fill(details.connectorUrl, { timeout: FIVE_SECONDS_MILLISECONDS });
  await createForm
    .locator("select")
    .selectOption({ label: "No authentication" }, { timeout: FIVE_SECONDS_MILLISECONDS });
  await createForm
    .getByRole("checkbox", { name: "I understand and want to continue" })
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });

  await createForm
    .getByRole("button", { name: "Create as a plugin", exact: true })
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });
  return waitForCreateFormToClose(createForm);
}

// A dialog that stays open shows ChatGPT's reason (for example a name clash); it is closed with Cancel.
async function waitForCreateFormToClose(createForm: Locator): Promise<string | null> {
  const createFormCloseWaitMilliseconds = 60_000;

  try {
    await createForm.waitFor({ state: "hidden", timeout: createFormCloseWaitMilliseconds });
    return null;
  } catch {
    const dialogText = await readVisibleCopy(createForm);
    const chatGptErrorLine = pickCreateDialogErrorLine(dialogText);

    await createForm
      .getByRole("button", { name: "Cancel", exact: true })
      .click({ timeout: FIVE_SECONDS_MILLISECONDS });
    return chatGptErrorLine ?? "The Create as a plugin dialog did not close within 60 seconds.";
  }
}
