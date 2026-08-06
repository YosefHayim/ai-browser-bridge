import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "@/features/domain";

const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";
const CONNECTORS_URL = "https://grok.com/connectors";
// Restore chat home after connector setup so the composer is available.
const CHAT_HOME_URL = "https://grok.com/";

const connectorHost = (connectorUrl: string) => {
  try {
    return new URL(connectorUrl).hostname;
  } catch {
    return undefined;
  }
};

const openConnectorsPage = async (page: Page, setupSteps: string[]) => {
  await page.goto(CONNECTORS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  setupSteps.push("Opened grok.com/connectors.");
};

// Grok's Installed row often shows the server host (e.g. *.trycloudflare.com)
// rather than the display name filled into the form.
const connectorExists = async (page: Page, connectorName: string, connectorUrl: string) => {
  const exactNameMatch = page.getByText(connectorName, { exact: true });
  if ((await exactNameMatch.count().catch(() => 0)) > 0) return true;
  const looseNameMatch = page.getByText(connectorName, { exact: false });
  if ((await looseNameMatch.count().catch(() => 0)) > 0) return true;
  const host = connectorHost(connectorUrl);
  if (host !== undefined) {
    const hostMatch = page.getByText(host, { exact: false });
    if ((await hostMatch.count().catch(() => 0)) > 0) return true;
  }
  return false;
};

const returnToChat = async (page: Page, setupSteps: string[]) => {
  await page.goto(CHAT_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(500);
  setupSteps.push("Returned to Grok chat.");
};

const openCustomForm = async (page: Page, setupSteps: string[]) => {
  const newConnectorControl = page
    .getByRole("button", { name: /new connector/i })
    .or(page.locator("button, a, [role='button']").filter({ hasText: /new connector/i }));
  await newConnectorControl.first().click({ timeout: 10_000 });
  await page.waitForTimeout(600);

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
  await customConnectorControl.first().click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  setupSteps.push("Opened New Connector → Custom.");
};

// Grok form labels vary; try placeholders/labels first, then ordered text inputs.
const fillForm = async (
  page: Page,
  connectorName: string,
  connectorUrl: string,
  setupSteps: string[],
) => {
  const nameInput = page
    .locator(
      'input[placeholder*="Name" i], input[name*="name" i], input[aria-label*="Name" i], input[id*="name" i]',
    )
    .first();
  const urlInput = page
    .locator(
      'input[placeholder*="Server" i], input[placeholder*="URL" i], input[placeholder*="mcp" i], input[name*="url" i], input[aria-label*="URL" i], input[aria-label*="Server" i], input[type="url"]',
    )
    .first();

  const nameFilled = await nameInput
    .fill(connectorName, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const urlFilled = await urlInput
    .fill(connectorUrl, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (!nameFilled || !urlFilled) {
    const visibleTextInputs = page.locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])',
    );
    const visibleInputCount = await visibleTextInputs.count().catch(() => 0);
    if (visibleInputCount >= 2) {
      if (!nameFilled) await visibleTextInputs.nth(0).fill(connectorName);
      if (!urlFilled) await visibleTextInputs.nth(1).fill(connectorUrl);
    } else {
      throw new Error("Could not find Name and Server URL inputs on the custom connector form.");
    }
  }

  setupSteps.push(`Filled name "${connectorName}" and the connector URL.`);
};

const submitForm = async (page: Page, setupResult: ConnectorSetupResult) => {
  const submitButton = page
    .getByRole("button", { name: /^(add|create|connect|save|add connector)$/i })
    .or(
      page
        .locator('button[type="submit"], button')
        .filter({ hasText: /^(add|create|connect|save|add connector)$/i }),
    );
  const submitClicked = await submitButton
    .first()
    .click({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!submitClicked) {
    setupResult.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  await page.waitForTimeout(1_500);

  const confirmButton = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$|allow/i,
  });
  if (
    await confirmButton
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false)
  ) {
    await confirmButton
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    setupResult.steps.push("Accepted the connector confirmation.");
  }

  setupResult.completed = true;
  setupResult.steps.push("Submitted the connector form.");
};

/**
 * Register the bridge MCP server as a custom connector on grok.com/connectors.
 * When `automatic` is false, fill the form but leave it unsubmitted for review.
 *
 * Uses Streamable HTTP (`…/mcp`) via the shared Cloudflare tunnel. Grok's UI
 * placeholder may show `/sse`; cloudflared quick tunnels do not support SSE.
 */
export const setupMcpConnectorInGrok = async (
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
    await openConnectorsPage(page, setupResult.steps);
    if (await connectorExists(page, connectorName, connectorUrl)) {
      setupResult.completed = true;
      setupResult.steps.push(`Connector "${connectorName}" is already installed.`);
      await returnToChat(page, setupResult.steps);
      return setupResult;
    }
    await openCustomForm(page, setupResult.steps);
    await fillForm(page, connectorName, connectorUrl, setupResult.steps);
    if (setupOptions.automatic === false) {
      setupResult.steps.push(
        "Left the form filled but unsubmitted for manual review (automatic=false).",
      );
      return setupResult;
    }
    await submitForm(page, setupResult);
    if (setupResult.completed) {
      await returnToChat(page, setupResult.steps);
    }
  } catch (error) {
    const firstLine = String(error).split("\n")[0];
    setupResult.warnings.push(`Grok connector setup did not finish: ${firstLine}`);
  }
  return setupResult;
};
