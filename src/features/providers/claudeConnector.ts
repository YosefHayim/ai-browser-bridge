import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "@/features/domain";

const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

const openConnectorsPanel = async (page: Page, setupResult: ConnectorSetupResult) => {
  await page.locator('[data-testid="user-menu-button"]').first().click({ timeout: 10_000 });
  await page.locator('[data-testid="user-menu-settings"]').first().click({ timeout: 10_000 });
  await page
    .locator('[role="tab"], [role="menuitem"], [role="dialog"] a[href], [role="dialog"] button')
    .filter({ hasText: /connectors/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  setupResult.steps.push("Opened Settings → Connectors.");
};

const connectorExists = async (page: Page, connectorName: string) => {
  const listedConnector = page
    .locator('[role="dialog"]')
    .getByText(connectorName, { exact: false });
  return (await listedConnector.count()) > 0;
};

const openCustomConnectorForm = async (page: Page, setupResult: ConnectorSetupResult) => {
  await page.locator('button[aria-label="Add connector"]').first().click({ timeout: 10_000 });
  await page
    .getByRole("menuitem", { name: /add custom connector/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  setupResult.steps.push("Opened the custom-connector form.");
};

const fillConnectorForm = async (
  page: Page,
  connectorName: string,
  connectorUrl: string,
  setupResult: ConnectorSetupResult,
) => {
  await page.locator('input[placeholder="Name"]').first().fill(connectorName);
  await page.locator('input[placeholder="Remote MCP server URL"]').first().fill(connectorUrl);
  setupResult.steps.push(`Filled name "${connectorName}" and the connector URL.`);
};

const submitConnectorForm = async (page: Page, setupResult: ConnectorSetupResult) => {
  const addButton = page
    .locator('[role="dialog"] button[type="submit"], [role="dialog"] button')
    .filter({ hasText: /^add$/i });
  try {
    await addButton.first().click({ timeout: 8_000 });
  } catch {
    setupResult.warnings.push("Filled the connector form but could not click Add.");
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
      setupResult.steps.push("Accepted the unverified-connector confirmation.");
    } catch {
      setupResult.warnings.push("Unverified-connector confirmation was visible but not accepted.");
    }
  }

  setupResult.completed = true;
  setupResult.steps.push("Submitted the connector form.");
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
  setupOptions: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  const connectorName =
    setupOptions.connectorName === undefined ? DEFAULT_CONNECTOR_NAME : setupOptions.connectorName;
  const setupResult: ConnectorSetupResult = {
    connectorUrl,
    completed: false,
    steps: [],
    warnings: [],
  };
  try {
    await openConnectorsPanel(page, setupResult);
    if (await connectorExists(page, connectorName)) {
      setupResult.completed = true;
      setupResult.steps.push(`Connector "${connectorName}" is already installed.`);
      await closeSettings(page);
      return setupResult;
    }
    await openCustomConnectorForm(page, setupResult);
    await fillConnectorForm(page, connectorName, connectorUrl, setupResult);
    if (setupOptions.automatic === false) {
      setupResult.steps.push(
        "Left the form filled but unsubmitted for manual review (automatic=false).",
      );
      return setupResult;
    }
    await submitConnectorForm(page, setupResult);
    await closeSettings(page);
  } catch (error) {
    const firstLine = String(error).split("\n")[0];
    setupResult.warnings.push(`Claude connector setup did not finish: ${firstLine}`);
  }
  return setupResult;
};
