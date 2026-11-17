import type { Page } from "playwright";
import type { ConnectorSetupReport, ConnectorSetupSettings } from "@/connector-types.ts";
import type { BridgeProviderId } from "@/provider-settings.ts";
import { setupMcpConnectorInClaude } from "@/providers/claude-connector.ts";
import { setupMcpConnectorInGrok } from "@/providers/grok-connector.ts";

type ConnectorSetup = (
  page: Page,
  url: string,
  settings?: ConnectorSetupSettings,
) => Promise<ConnectorSetupReport>;

export const CONNECTOR_SETUP: Partial<Record<BridgeProviderId, ConnectorSetup>> = {
  claude: setupMcpConnectorInClaude,
  grok: setupMcpConnectorInGrok,
};
