import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "../../../domain/types.ts";
import { executeConnectorSetup } from "./execute-connector-setup.ts";
import { initConnectorSetupContext } from "./init-connector-setup-context.ts";

/** Best-effort ChatGPT Developer Mode connector setup through the browser UI. */
export async function setupMcpConnectorInChatGpt(
  page: Page,
  connectorUrl: string,
  options: ConnectorSetupOptions = {},
): Promise<ConnectorSetupResult> {
  return executeConnectorSetup(initConnectorSetupContext({ page, connectorUrl, options }));
}
