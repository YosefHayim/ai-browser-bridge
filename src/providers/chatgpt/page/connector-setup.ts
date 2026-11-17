import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/connector-types.ts";
import { FIVE_SECONDS_MILLISECONDS } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import {
  addCustomMcpPlugin,
  deleteStalePlugins,
  listPluginSummaries,
  waitForTunnelToAnswer,
} from "@/providers/chatgpt/page/plugin-management.ts";
import { pickPluginSetupPlan } from "@/providers/chatgpt/plugin-setup-logic.ts";
import { DEFAULT_CONNECTOR_NAME } from "@/providers/engine/browser-provider.ts";

export type ConnectorSetupRun = {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupSettings;
  connectorName: string;
  result: ConnectorSetupReport;
};

const COMPOSER_PLUS_BUTTON_SELECTOR = 'button[aria-label="Add files and more"]';

const COMPOSER_PLUGIN_ROW_SELECTOR = 'button[data-list-navigation-item="true"]';

// An enabled plugin shows in the composer as a label span with the plugin's name.
function isConnectorChipShownInComposer(page: Page, connectorName: string): Promise<boolean> {
  return page.evaluate((chipText) => {
    const composerSpans = [...document.querySelectorAll("form span")];
    return composerSpans.some((span) => span.textContent.trim() === chipText);
  }, connectorName);
}

// Opens the composer "+" menu and clicks the plugin row. Only called when the chip is missing, since a click turns the plugin off when it is on.
export async function turnOnConnectorInChatComposer(
  page: Page,
  connectorName: string,
): Promise<void> {
  const isConnectorAlreadyOn = await isConnectorChipShownInComposer(page, connectorName);
  if (isConnectorAlreadyOn) return;

  await page
    .locator(COMPOSER_PLUS_BUTTON_SELECTOR)
    .first()
    .click({ timeout: FIVE_SECONDS_MILLISECONDS });
  const pluginRow = page
    .locator(COMPOSER_PLUGIN_ROW_SELECTOR)
    .filter({ hasText: connectorName })
    .first();

  try {
    await pluginRow.click({ timeout: FIVE_SECONDS_MILLISECONDS });
  } catch (error) {
    await page.keyboard.press("Escape");
    throw error;
  }

  await page.waitForFunction(
    (chipText) =>
      [...document.querySelectorAll("form span")].some(
        (span) => span.textContent.trim() === chipText,
      ),
    connectorName,
    { timeout: FIVE_SECONDS_MILLISECONDS },
  );
}

function initConnectorSetupRun(details: {
  page: Page;
  connectorUrl: string;
  options: ConnectorSetupSettings;
}): ConnectorSetupRun {
  const connectorName = details.options.connectorName ?? DEFAULT_CONNECTOR_NAME;

  return {
    page: details.page,
    connectorUrl: details.connectorUrl,
    options: details.options,
    connectorName,
    result: {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [],
    },
  };
}

// The orchestrator aborts the setup at its deadline; a step that would act after that must not run.
export function throwIfSetupStopped(details: ConnectorSetupRun): void {
  details.options.signal?.throwIfAborted();
}

async function executeConnectorSetup(details: ConnectorSetupRun): Promise<ConnectorSetupReport> {
  throwIfSetupStopped(details);
  const pluginsBefore = await listPluginSummaries(details);
  const setupPlan = pickPluginSetupPlan({
    connectorName: details.connectorName,
    connectorUrl: details.connectorUrl,
    plugins: pluginsBefore,
  });

  const isCurrentPluginReused = setupPlan.action === "reuse";
  if (isCurrentPluginReused) {
    details.result.steps.push(
      `Plugin "${details.connectorName}" already uses the current tunnel URL.`,
    );
    details.result.completed = true;
    return details.result;
  }

  const isPluginUrlUnreadable = setupPlan.action === "unreadable";
  if (isPluginUrlUnreadable) {
    details.result.warnings.push(
      `Plugin "${details.connectorName}" exists, but its server URL could not be read. No second plugin was created.`,
    );
    return details.result;
  }

  await deleteStalePlugins({ setup: details, plugins: setupPlan.pluginsToDelete });

  await waitForTunnelToAnswer(details);
  const createFailureText = await addCustomMcpPlugin(details);
  const isPluginNotCreated = createFailureText != null;
  if (isPluginNotCreated) {
    details.result.warnings.push(createFailureText);
    return details.result;
  }

  throwIfSetupStopped(details);
  const pluginsAfter = await listPluginSummaries(details);
  const setupPlanAfter = pickPluginSetupPlan({
    connectorName: details.connectorName,
    connectorUrl: details.connectorUrl,
    plugins: pluginsAfter,
  });

  const isNewPluginListed = setupPlanAfter.action === "reuse";
  if (isNewPluginListed) {
    details.result.steps.push(
      `Created plugin "${details.connectorName}" with the current tunnel URL.`,
    );
    details.result.completed = true;
    return details.result;
  }

  details.result.warnings.push(
    `Plugin "${details.connectorName}" was not listed with the current tunnel URL after creating it.`,
  );
  return details.result;
}

export async function setupMcpConnectorInChatGpt(
  page: Page,
  connectorUrl: string,
  settings: ConnectorSetupSettings = {},
): Promise<ConnectorSetupReport> {
  const setupRun = initConnectorSetupRun({ page, connectorUrl, options: settings });
  return executeConnectorSetup(setupRun);
}
