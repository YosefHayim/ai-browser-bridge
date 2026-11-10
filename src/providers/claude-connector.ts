import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/domain/connector-types.ts";
import { logUnlessElementMissing, probeOrFallback } from "./browser-provider.ts";

const CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS = 10_000;

const openConnectorsPanel = async (page: Page, setupReport: ConnectorSetupReport) => {
  await page
    .locator('[data-testid="user-menu-button"]')
    .first()
    .click({ timeout: CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS });
  await page
    .locator('[data-testid="user-menu-settings"]')
    .first()
    .click({ timeout: CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS });
  await page
    .locator('[role="tab"], [role="menuitem"], [role="dialog"] a[href], [role="dialog"] button')
    .filter({ hasText: /connectors/i })
    .first()
    .click({ timeout: CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS });
  const connectorPanelSettleMilliseconds = 800;

  await page.waitForTimeout(connectorPanelSettleMilliseconds);
  setupReport.steps.push("Opened Settings → Connectors.");
};

const hasConnector = async (page: Page, connectorName: string) => {
  const listedConnector = page
    .locator('[role="dialog"]')
    .getByText(connectorName, { exact: false });
  const listedConnectorCount = await listedConnector.count();
  return listedConnectorCount > 0;
};

const openCustomConnectorForm = async (page: Page, setupReport: ConnectorSetupReport) => {
  await page
    .locator('button[aria-label="Add connector"]')
    .first()
    .click({ timeout: CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS });
  await page
    .getByRole("menuitem", { name: /add custom connector/i })
    .first()
    .click({ timeout: CONNECTOR_UI_CLICK_TIMEOUT_MILLISECONDS });
  const connectorFormSettleMilliseconds = 600;

  await page.waitForTimeout(connectorFormSettleMilliseconds);
  setupReport.steps.push("Opened the custom-connector form.");
};

interface FillConnectorFormDetails {
  page: Page;
  connectorName: string;
  connectorUrl: string;
  setupResult: ConnectorSetupReport;
}

const fillConnectorForm = async ({
  page,
  connectorName,
  connectorUrl,
  setupResult: setupReport,
}: FillConnectorFormDetails) => {
  await page.locator('input[placeholder="Name"]').first().fill(connectorName);
  await page.locator('input[placeholder="Remote MCP server URL"]').first().fill(connectorUrl);
  setupReport.steps.push(`Filled name "${connectorName}" and the connector URL.`);
};

const submitConnectorForm = async (page: Page, setupReport: ConnectorSetupReport) => {
  const addButton = page
    .locator('[role="dialog"] button[type="submit"], [role="dialog"] button')
    .filter({ hasText: /^add$/i });
  try {
    const connectorSubmitClickTimeoutMilliseconds = 8_000;

    await addButton.first().click({ timeout: connectorSubmitClickTimeoutMilliseconds });
  } catch (error) {
    logUnlessElementMissing(error);
    setupReport.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  const connectorSaveSettleMilliseconds = 1_500;

  await page.waitForTimeout(connectorSaveSettleMilliseconds);

  const confirmButton = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$/i,
  });
  const isConfirmationVisible = await probeOrFallback(false, async () => {
    const visibilityTimeoutMilliseconds = 3_000;

    return confirmButton.first().isVisible({ timeout: visibilityTimeoutMilliseconds });
  });

  if (isConfirmationVisible) {
    try {
      const connectorConfirmClickTimeoutMilliseconds = 5_000;

      await confirmButton.first().click({ timeout: connectorConfirmClickTimeoutMilliseconds });
      setupReport.steps.push("Accepted the unverified-connector confirmation.");
    } catch (error) {
      logUnlessElementMissing(error);
      setupReport.warnings.push("Unverified-connector confirmation was visible but not accepted.");
    }
  }

  setupReport.completed = true;
  setupReport.steps.push("Submitted the connector form.");
};

const closeSettings = async (page: Page) => {
  const settingsCloseClickTimeoutMilliseconds = 4_000;

  await Promise.allSettled([
    page
      .locator('[role="dialog"] button[aria-label="Close"]')
      .first()
      .click({ timeout: settingsCloseClickTimeoutMilliseconds }),
    page.keyboard.press("Escape"),
  ]);
};

export const setupMcpConnectorInClaude = async (
  page: Page,
  connectorUrl: string,
  setupSettings: ConnectorSetupSettings = {},
): Promise<ConnectorSetupReport> => {
  const connectorName =
    setupSettings.connectorName === undefined
      ? DEFAULT_CONNECTOR_NAME
      : setupSettings.connectorName;
  const setupReport: ConnectorSetupReport = {
    connectorUrl,
    completed: false,
    steps: [],
    warnings: [],
  };
  try {
    await openConnectorsPanel(page, setupReport);

    const isConnectorListed = await hasConnector(page, connectorName);
    if (isConnectorListed) {
      setupReport.completed = true;
      setupReport.steps.push(`Connector "${connectorName}" is already installed.`);
      await closeSettings(page);
      return setupReport;
    }

    await openCustomConnectorForm(page, setupReport);
    await fillConnectorForm({ page, connectorName, connectorUrl, setupResult: setupReport });

    if (setupSettings.automatic === false) {
      setupReport.steps.push(
        "Left the form filled but unsubmitted for manual review (automatic=false).",
      );
      return setupReport;
    }

    await submitConnectorForm(page, setupReport);
    await closeSettings(page);
  } catch (error) {
    const firstLine = String(error).split("\n")[0];
    setupReport.warnings.push(`Claude connector setup did not finish: ${firstLine}`);
  }
  return setupReport;
};
