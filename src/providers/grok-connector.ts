import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/domain/connector-types.ts";
import { logUnlessElementMissing, probeOrFallback } from "./browser-provider.ts";

const CONNECTOR_ACTION_TIMEOUT_MILLISECONDS = 8_000;

const CONNECTOR_FORM_SETTLE_MILLISECONDS = 600;

const CONNECTOR_MENU_CLICK_TIMEOUT_MILLISECONDS = 10_000;

const ACTION_TIMEOUT_MILLISECONDS = 30_000;

const readConnectorHost = (connectorUrl: string) => {
  try {
    return new URL(connectorUrl).hostname;
  } catch (error) {
    const isUrlInvalid = error instanceof TypeError;
    if (isUrlInvalid) return undefined;

    throw error;
  }
};

const openConnectorsPage = async (page: Page, setupSteps: string[]) => {
  await page.goto("https://grok.com/connectors", {
    waitUntil: "domcontentloaded",
    timeout: ACTION_TIMEOUT_MILLISECONDS,
  });
  const connectorsPageSettleMilliseconds = 800;

  await page.waitForTimeout(connectorsPageSettleMilliseconds);
  setupSteps.push("Opened grok.com/connectors.");
};

// The Installed row shows the server host, not the display name typed into the form.
const hasConnector = async (page: Page, connectorName: string, connectorUrl: string) => {
  const exactNameLocator = page.getByText(connectorName, { exact: true });
  const isExactNameShown = await probeOrFallback(false, async () => {
    const exactNameLocatorCount = await exactNameLocator.count();

    return exactNameLocatorCount > 0;
  });
  if (isExactNameShown) return true;

  const looseNameLocator = page.getByText(connectorName, { exact: false });
  const isLooseNameShown = await probeOrFallback(false, async () => {
    const looseNameLocatorCount = await looseNameLocator.count();

    return looseNameLocatorCount > 0;
  });
  if (isLooseNameShown) return true;

  const host = readConnectorHost(connectorUrl);

  const hasHost = host !== undefined;
  if (hasHost) {
    const hostLocator = page.getByText(host, { exact: false });
    const isHostShown = await probeOrFallback(false, async () => {
      const hostLocatorCount = await hostLocator.count();

      return hostLocatorCount > 0;
    });
    if (isHostShown) return true;
  }

  return false;
};

const returnToChat = async (page: Page, setupSteps: string[]) => {
  await page.goto("https://grok.com/", {
    waitUntil: "domcontentloaded",
    timeout: ACTION_TIMEOUT_MILLISECONDS,
  });
  const returnToChatSettleMilliseconds = 500;

  await page.waitForTimeout(returnToChatSettleMilliseconds);
  setupSteps.push("Returned to Grok chat.");
};

const openCustomConnectorForm = async (page: Page, setupSteps: string[]) => {
  const newConnectorControl = page
    .getByRole("button", { name: /new connector/i })
    .or(page.locator("button, a, [role='button']").filter({ hasText: /new connector/i }));
  await newConnectorControl.first().click({ timeout: CONNECTOR_MENU_CLICK_TIMEOUT_MILLISECONDS });
  await page.waitForTimeout(CONNECTOR_FORM_SETTLE_MILLISECONDS);

  const customConnectorControl = page
    .getByRole("button", { name: /^custom$/i })
    .or(page.getByRole("menuitem", { name: /custom/i }))
    .or(
      page
        .locator("button, a, [role='button'], [role='menuitem']")
        .filter({ hasText: /^custom$/i }),
    )
    .or(
      page
        .locator("button, a, [role='button'], [role='menuitem']")
        .filter({ hasText: /custom connector/i }),
    );
  await customConnectorControl
    .first()
    .click({ timeout: CONNECTOR_MENU_CLICK_TIMEOUT_MILLISECONDS });
  await page.waitForTimeout(CONNECTOR_FORM_SETTLE_MILLISECONDS);
  setupSteps.push("Opened New Connector → Custom.");
};

// Grok form labels vary; try labels first, then ordered text inputs.
interface FillConnectorFormDetails {
  page: Page;
  connectorName: string;
  connectorUrl: string;
  setupSteps: string[];
}

const fillConnectorForm = async ({
  page,
  connectorName,
  connectorUrl,
  setupSteps,
}: FillConnectorFormDetails) => {
  const nameField = page
    .locator(
      'input[placeholder*="Name" i], input[name*="name" i], input[aria-label*="Name" i], input[id*="name" i]',
    )
    .first();
  const urlField = page
    .locator(
      'input[placeholder*="Server" i], input[placeholder*="URL" i], input[placeholder*="mcp" i], input[name*="url" i], input[aria-label*="URL" i], input[aria-label*="Server" i], input[type="url"]',
    )
    .first();

  const isNameFilled = await probeOrFallback(false, async () => {
    await nameField.fill(connectorName, { timeout: CONNECTOR_ACTION_TIMEOUT_MILLISECONDS });
    return true;
  });
  const isUrlFilled = await probeOrFallback(false, async () => {
    await urlField.fill(connectorUrl, { timeout: CONNECTOR_ACTION_TIMEOUT_MILLISECONDS });
    return true;
  });

  const isFormIncomplete = !isNameFilled || !isUrlFilled;
  if (isFormIncomplete) {
    const visibleFields = page.locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])',
    );
    const visibleFieldCount = await probeOrFallback(0, () => visibleFields.count());

    const minimumVisibleFieldCount = 2;

    const hasMultipleVisibleFields = visibleFieldCount >= minimumVisibleFieldCount;
    if (hasMultipleVisibleFields) {
      const isNotNameFilled = !isNameFilled;
      if (isNotNameFilled) await visibleFields.nth(0).fill(connectorName);

      const isNotUrlFilled = !isUrlFilled;
      if (isNotUrlFilled) await visibleFields.nth(1).fill(connectorUrl);
    } else {
      throw new Error("Could not find Name and Server URL inputs on the custom connector form.");
    }
  }

  setupSteps.push(`Filled name "${connectorName}" and the connector URL.`);
};

const submitConnectorForm = async (page: Page, setupReport: ConnectorSetupReport) => {
  const submitButton = page
    .getByRole("button", { name: /^(add|create|connect|save|add connector)$/i })
    .or(
      page
        .locator('button[type="submit"], button')
        .filter({ hasText: /^(add|create|connect|save|add connector)$/i }),
    );
  try {
    await submitButton.first().click({ timeout: CONNECTOR_ACTION_TIMEOUT_MILLISECONDS });
  } catch (error) {
    logUnlessElementMissing(error);
    setupReport.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  const connectorSaveSettleMilliseconds = 1_500;

  await page.waitForTimeout(connectorSaveSettleMilliseconds);

  const confirmButton = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$|allow/i,
  });
  const isConfirmationVisible = await probeOrFallback(false, async () => {
    const visibilityTimeoutMilliseconds = 3_000;

    return confirmButton.first().isVisible({ timeout: visibilityTimeoutMilliseconds });
  });

  if (isConfirmationVisible) {
    try {
      const connectorConfirmClickTimeoutMilliseconds = 5_000;

      await confirmButton.first().click({ timeout: connectorConfirmClickTimeoutMilliseconds });
      setupReport.steps.push("Accepted the connector confirmation.");
    } catch (error) {
      logUnlessElementMissing(error);
      setupReport.warnings.push("Connector confirmation was visible but not accepted.");
    }
  }

  setupReport.completed = true;
  setupReport.steps.push("Submitted the connector form.");
};

export const setupMcpConnectorInGrok = async (
  page: Page,
  connectorUrl: string,
  setupSettings: ConnectorSetupSettings = {},
): Promise<ConnectorSetupReport> => {
  const connectorName =
    setupSettings.connectorName === undefined ? "ai-browser-bridge" : setupSettings.connectorName;
  const setupReport: ConnectorSetupReport = {
    connectorUrl,
    completed: false,
    steps: [],
    warnings: [],
  };
  try {
    await openConnectorsPage(page, setupReport.steps);

    const isConnectorListed = await hasConnector(page, connectorName, connectorUrl);
    if (isConnectorListed) {
      setupReport.completed = true;
      setupReport.steps.push(`Connector "${connectorName}" is already installed.`);
      await returnToChat(page, setupReport.steps);
      return setupReport;
    }

    await openCustomConnectorForm(page, setupReport.steps);
    await fillConnectorForm({ page, connectorName, connectorUrl, setupSteps: setupReport.steps });

    if (setupSettings.automatic === false) {
      setupReport.steps.push(
        "Left the form filled but unsubmitted for manual review (automatic=false).",
      );
      return setupReport;
    }

    await submitConnectorForm(page, setupReport);

    if (setupReport.completed) {
      await returnToChat(page, setupReport.steps);
    }
  } catch (error) {
    const firstLine = String(error).split("\n")[0];
    setupReport.warnings.push(`Grok connector setup did not finish: ${firstLine}`);
  }
  return setupReport;
};
