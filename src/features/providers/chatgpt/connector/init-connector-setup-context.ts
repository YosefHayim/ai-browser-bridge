import type { Page } from "playwright";
import type { ConnectorSetupOptions } from "../../../domain/types.ts";
import { DEFAULT_CONNECTOR_NAME } from "../connector.constants.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { chatGptReturnUrl } from "./chatgpt-return-url.ts";

/** Input for initializing a connector setup context. */
export interface InitConnectorSetupContextInput {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** MCP connector URL to register in ChatGPT settings. */
  connectorUrl: string;
  /** Connector setup options from the caller. */
  options: ConnectorSetupOptions;
}

/** Build a fully initialized connector setup context. */
export function initConnectorSetupContext(input: InitConnectorSetupContextInput): ConnectorSetupContext {
  const connectorName = input.options.connectorName ?? DEFAULT_CONNECTOR_NAME;
  const returnUrl = chatGptReturnUrl({ url: input.page.url() });
  return {
    page: input.page,
    connectorUrl: input.connectorUrl,
    options: input.options,
    connectorName,
    returnUrl,
    result: {
      connectorUrl: input.connectorUrl,
      completed: false,
      steps: [],
      warnings: [],
    },
  };
}
