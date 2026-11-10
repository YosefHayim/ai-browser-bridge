import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/domain/connector-types.ts";

const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";
const CONNECTORS_URL = "https://grok.com/connectors";
// Restore chat home after connector setup so the composer is available.
const CHAT_HOME_URL = "https://grok.com/";

const readConnectorHost = (connectorUrl: string) => {
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
const hasConnector = async (page: Page, connectorName: string, connectorUrl: string) => {
  const exactNameLocator = page.getByText(connectorName, { exact: true });
  try {
    const hasExactName = (await exactNameLocator.count()) > 0;
    if (hasExactName) return true;
  } catch {
    // count race
  }
  const looseNameLocator = page.getByText(connectorName, { exact: false });
  try {
    const hasLooseName = (await looseNameLocator.count()) > 0;
    if (hasLooseName) return true;
  } catch {
    // count race
  }
  const host = readConnectorHost(connectorUrl);

  const hasHost = host !== undefined;
  if (hasHost) {
    const hostLocator = page.getByText(host, { exact: false });
    try {
      const hasHost = (await hostLocator.count()) > 0;
      if (hasHost) return true;
    } catch {
      // count race
    }
  }

  return false;
};

const returnToChat = async (page: Page, setupSteps: string[]) => {
  await page.goto(CHAT_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(500);
  setupSteps.push("Returned to Grok chat.");
};

const openCustomConnectorForm = async (page: Page, setupSteps: string[]) => {
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

  let nameFilled = false;
  let urlFilled = false;
  try {
    await nameField.fill(connectorName, { timeout: 8_000 });
    nameFilled = true;
  } catch {
    nameFilled = false;
  }
  try {
    await urlField.fill(connectorUrl, { timeout: 8_000 });
    urlFilled = true;
  } catch {
    urlFilled = false;
  }

  const isFormIncomplete = !nameFilled || !urlFilled;
  if (isFormIncomplete) {
    const visibleFields = page.locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])',
    );
    let visibleFieldCount = 0;
    try {
      visibleFieldCount = await visibleFields.count();
    } catch {
      visibleFieldCount = 0;
    }

    const hasMultipleVisibleFields = visibleFieldCount >= 2;
    if (hasMultipleVisibleFields) {
      const isNotNameFilled = !nameFilled;
      if (isNotNameFilled) await visibleFields.nth(0).fill(connectorName);

      const isNotUrlFilled = !urlFilled;
      if (isNotUrlFilled) await visibleFields.nth(1).fill(connectorUrl);
    } else {
      throw new Error("Could not find Name and Server URL inputs on the custom connector form.");
    }
  }

  setupSteps.push(`Filled name "${connectorName}" and the connector URL.`);
};

const submitConnectorForm = async (page: Page, setupReport: ConnectorSetupResult) => {
  const submitButton = page
    .getByRole("button", { name: /^(add|create|connect|save|add connector)$/i })
    .or(
      page
        .locator('button[type="submit"], button')
        .filter({ hasText: /^(add|create|connect|save|add connector)$/i }),
    );
  try {
    await submitButton.first().click({ timeout: 8_000 });
  } catch {
    setupReport.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  await page.waitForTimeout(1_500);

  const confirmButton = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$|allow/i,
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
      setupReport.steps.push("Accepted the connector confirmation.");
    } catch {
      setupReport.warnings.push("Connector confirmation was visible but not accepted.");
    }
  }

  setupReport.completed = true;
  setupReport.steps.push("Submitted the connector form.");
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
