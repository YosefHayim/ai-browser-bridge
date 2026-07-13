import type { ConnectorSetupOptions, ConnectorSetupResult } from "@/features/domain";
import type { Page } from "playwright";

/** Default display name for the bridge's connector inside Grok. */
const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

/** Dedicated connectors page on grok.com. */
const CONNECTORS_URL = "https://grok.com/connectors";

/** Chat home — restore this after connector setup so the composer is available. */
const CHAT_HOME_URL = "https://grok.com/";

/** Hostname from a connector URL, or null when the value is not a valid URL. */
const connectorHost = (connectorUrl: string): string | null => {
  try {
    return new URL(connectorUrl).hostname;
  } catch {
    return null;
  }
};

/** Navigate to Grok's connectors page. */
const openConnectorsPage = async (page: Page, steps: string[]): Promise<void> => {
  await page.goto(CONNECTORS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);
  steps.push("Opened grok.com/connectors.");
};

/**
 * Whether a matching connector is already listed.
 * Grok's Installed row often shows the server host (e.g. *.trycloudflare.com)
 * rather than the display name we filled in.
 */
const connectorExists = async (
  page: Page,
  name: string,
  connectorUrl: string,
): Promise<boolean> => {
  // Prefer exact text on the page body; Grok lists connectors outside dialogs.
  const exact = page.getByText(name, { exact: true });
  if ((await exact.count().catch(() => 0)) > 0) return true;
  const loose = page.getByText(name, { exact: false });
  if ((await loose.count().catch(() => 0)) > 0) return true;
  const host = connectorHost(connectorUrl);
  if (host) {
    const byHost = page.getByText(host, { exact: false });
    if ((await byHost.count().catch(() => 0)) > 0) return true;
  }
  return false;
};

/** Leave /connectors so subsequent ask turns find the chat composer. */
const returnToChat = async (page: Page, steps: string[]): Promise<void> => {
  await page.goto(CHAT_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(500);
  steps.push("Returned to Grok chat.");
};

/** Click New Connector, then Custom, to open the custom-connector form. */
const openCustomForm = async (page: Page, steps: string[]): Promise<void> => {
  const newConnector = page
    .getByRole("button", { name: /new connector/i })
    .or(page.locator("button, a, [role='button']").filter({ hasText: /new connector/i }));
  await newConnector.first().click({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const custom = page
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
  await custom.first().click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  steps.push("Opened New Connector → Custom.");
};

/**
 * Fill Name + Server URL. Grok's form labels vary; try placeholders, labels, then
 * ordered text inputs.
 */
const fillForm = async (page: Page, name: string, url: string, steps: string[]): Promise<void> => {
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
    .fill(name, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const urlFilled = await urlInput
    .fill(url, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (!nameFilled || !urlFilled) {
    // Fallback: first two visible text-like inputs in dialog/main form.
    const inputs = page.locator(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])',
    );
    const count = await inputs.count().catch(() => 0);
    if (count >= 2) {
      if (!nameFilled) await inputs.nth(0).fill(name);
      if (!urlFilled) await inputs.nth(1).fill(url);
    } else {
      throw new Error("Could not find Name and Server URL inputs on the custom connector form.");
    }
  }

  steps.push(`Filled name "${name}" and the connector URL.`);
};

/** Submit the form and accept any confirmation dialog. */
const submitForm = async (page: Page, result: ConnectorSetupResult): Promise<void> => {
  const submit = page
    .getByRole("button", { name: /^(add|create|connect|save|add connector)$/i })
    .or(
      page
        .locator('button[type="submit"], button')
        .filter({ hasText: /^(add|create|connect|save|add connector)$/i }),
    );
  const clicked = await submit
    .first()
    .click({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) {
    result.warnings.push("Filled the connector form but could not click Add.");
    return;
  }
  await page.waitForTimeout(1_500);

  const confirm = page.getByRole("button", {
    name: /add anyway|confirm|continue|^connect$|allow/i,
  });
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
    result.steps.push("Accepted the connector confirmation.");
  }

  result.completed = true;
  result.steps.push("Submitted the connector form.");
};

/**
 * Register the bridge's MCP server as a custom connector in Grok web
 * (grok.com/connectors → New Connector → Custom). Accumulates human-readable
 * steps/warnings like the Claude flow, and — when `automatic` is false — fills
 * the form but leaves it unsubmitted for manual review.
 *
 * Uses Streamable HTTP (`…/mcp`) via the shared Cloudflare tunnel. Grok's UI
 * placeholder may show `/sse`; cloudflared quick tunnels do not support SSE.
 *
 * @param page - Playwright page to operate on.
 * @param connectorUrl - Public MCP URL (typically `https://….trycloudflare.com/mcp`).
 * @param options - Options that configure the operation.
 * @returns Steps, warnings, and whether setup completed.
 * @example
 * ```ts
 * const result = await setupMcpConnectorInGrok(page, connectorUrl, options);
 * ```
 */
export const setupMcpConnectorInGrok = async (
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> => {
  const connectorName = options.connectorName ?? DEFAULT_CONNECTOR_NAME;
  const result: ConnectorSetupResult = { connectorUrl, completed: false, steps: [], warnings: [] };
  try {
    await openConnectorsPage(page, result.steps);
    if (await connectorExists(page, connectorName, connectorUrl)) {
      result.completed = true;
      result.steps.push(`Connector "${connectorName}" is already installed.`);
      await returnToChat(page, result.steps);
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
    if (result.completed) {
      await returnToChat(page, result.steps);
    }
  } catch (err) {
    result.warnings.push(`Grok connector setup did not finish: ${String(err).split("\n")[0]}`);
  }
  return result;
};
