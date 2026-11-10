import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/domain/connector-types.ts";

const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

const openConnectorsPanel = async (page: Page, setupReport: ConnectorSetupResult) => {
  await page.locator('[data-testid="user-menu-button"]').first().click({ timeout: 10_000 });
  await page.locator('[data-testid="user-menu-settings"]').first().click({ timeout: 10_000 });
  await page
    .locator('[role="tab"], [role="menuitem"], [role="dialog"] a[href], [role="dialog"] button')
    .filter({ hasText: /connectors/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  setupReport.steps.push("Opened Settings → Connectors.");
};

const hasConnector = async (page: Page, connectorName: string) => {
  const listedConnector = page
    .locator('[role="dialog"]')
    .getByText(connectorName, { exact: false });
  return (await listedConnector.count()) > 0;
};

const openCustomConnectorForm = async (page: Page, setupReport: ConnectorSetupResult) => {
  await page.locator('button[aria-label="Add connector"]').first().click({ timeout: 10_000 });
  await page
    .getByRole("menuitem", { name: /add custom connector/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(600);
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

const submitConnectorForm = async (page: Page, setupReport: ConnectorSetupResult) => {
  const addButton = page
    .locator('[role="dialog"] button[type="submit"], [role="dialog"] button')
    .filter({ hasText: /^add$/i });
  try {
    await addButton.first().click({ timeout: 8_000 });
  } catch {
    setupReport.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  await page.waitForTimeout(1_500);

  const confirmButton = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$/i,
  });
  let confirmationVisible = false;
  try {
    confirmationVisible = await confirmButton.first().isVisible({ timeout: 3_000 });
  } catch {
    confirmationVisible = false;
  }

  if (confirmationVisible) {
    try {
      await confirmButton.first().click({ timeout: 5_000 });
      setupReport.steps.push("Accepted the unverified-connector confirmation.");
    } catch {
      setupReport.warnings.push("Unverified-connector confirmation was visible but not accepted.");
    }
  }

  setupReport.completed = true;
  setupReport.steps.push("Submitted the connector form.");
};

const closeSettings = async (page: Page) => {
  await Promise.allSettled([
    page.locator('[role="dialog"] button[aria-label="Close"]').first().click({ timeout: 4_000 }),
    page.keyboard.press("Escape"),
  ]);
};

/**
 * Register the bridge MCP server as a Claude custom connector
 * (Settings → Connectors → Add custom connector). When `automatic` is false,
 * fills the form and leaves it unsubmitted for manual review.
 */
export const setupMcpConnectorInClaude = async (
  page: Page,
  connectorUrl: string,
  setupSettings: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  const connectorName =
    setupSettings.connectorName === undefined
      ? DEFAULT_CONNECTOR_NAME
      : setupSettings.connectorName;
  const setupReport: ConnectorSetupResult = {
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
