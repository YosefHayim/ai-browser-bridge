import type { ConnectorSetupOptions, ConnectorSetupResult } from "@/features/domain";
import type { Page } from "playwright";

/** Default display name for the bridge's connector inside Claude. */
const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

/** Open Settings → Connectors from the account menu. */
const openConnectorsPanel = async (page: Page, steps: string[]): Promise<void> => {
  await page.locator('[data-testid="user-menu-button"]').first().click({ timeout: 10_000 });
  await page.locator('[data-testid="user-menu-settings"]').first().click({ timeout: 10_000 });
  await page
    .locator('[role="tab"], [role="menuitem"], [role="dialog"] a[href], [role="dialog"] button')
    .filter({ hasText: /connectors/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  steps.push("Opened Settings → Connectors.");
};

/** Whether a connector with this name is already listed on the panel. */
const connectorExists = async (page: Page, name: string): Promise<boolean> => {
  const match = page.locator('[role="dialog"]').getByText(name, { exact: false });
  return (await match.count().catch(() => 0)) > 0;
};

/** Open the custom-connector form via Add connector → Add custom connector. */
const openCustomForm = async (page: Page, steps: string[]): Promise<void> => {
  await page.locator('button[aria-label="Add connector"]').first().click({ timeout: 10_000 });
  await page
    .getByRole("menuitem", { name: /add custom connector/i })
    .first()
    .click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  steps.push("Opened the custom-connector form.");
};

/** Fill the connector name + remote MCP server URL fields. */
const fillForm = async (page: Page, name: string, url: string, steps: string[]): Promise<void> => {
  await page.locator('input[placeholder="Name"]').first().fill(name);
  await page.locator('input[placeholder="Remote MCP server URL"]').first().fill(url);
  steps.push(`Filled name "${name}" and the connector URL.`);
};

/** Submit the form and accept any unverified-connector confirmation. */
const submitForm = async (page: Page, result: ConnectorSetupResult): Promise<void> => {
  const add = page
    .locator('[role="dialog"] button[type="submit"], [role="dialog"] button')
    .filter({ hasText: /^add$/i });
  const clicked = await add
    .first()
    .click({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) {
    result.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  await page.waitForTimeout(1_500);
  const confirm = page.getByRole("button", { name: /add anyway|confirm|continue|^connect$/i });
  if (
    await confirm
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false)
  ) {
    await confirm
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    result.steps.push("Accepted the unverified-connector confirmation.");
  }
  result.completed = true;
  result.steps.push("Submitted the connector form.");
};

/** Close the settings dialog. */
const closeSettings = async (page: Page): Promise<void> => {
  await page
    .locator('[role="dialog"] button[aria-label="Close"]')
    .first()
    .click({ timeout: 4_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
};

/**
 * Register the bridge's MCP server as a custom connector in Claude web
 * (account menu → Settings → Connectors → Add custom connector). Accumulates
 * human-readable steps/warnings like the ChatGPT flow, and — when `automatic` is
 * false — fills the form but leaves it unsubmitted for manual review.
 *
 * @param page - Playwright page to operate on.
 * @param connectorUrl - Connector url value.
 * @param options - Options that configure the operation.
 * @returns The `setupMcpConnectorInClaude` result.
 * @example
 * ```ts
 * const result = await setupMcpConnectorInClaude(page, connectorUrl, options);
 * ```
 */
export const setupMcpConnectorInClaude = async (
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  const connectorName = options.connectorName ?? DEFAULT_CONNECTOR_NAME;
  const result: ConnectorSetupResult = { connectorUrl, completed: false, steps: [], warnings: [] };
  try {
    await openConnectorsPanel(page, result.steps);
    if (await connectorExists(page, connectorName)) {
      result.completed = true;
      result.steps.push(`Connector "${connectorName}" is already installed.`);
      await closeSettings(page);
      return result;
    }
    await openCustomForm(page, result.steps);
    await fillForm(page, connectorName, connectorUrl, result.steps);
    if (options.automatic === false) {
      result.steps.push(
        "Left the form filled but unsubmitted for manual review (automatic=false).",
      );
      return result;
    }
    await submitForm(page, result);
    await closeSettings(page);
  } catch (err) {
    result.warnings.push(`Claude connector setup did not finish: ${String(err).split("\n")[0]}`);
  }
  return result;
};
