import type { BridgeProviderId } from "../features/providers/create-provider.factory.ts";

/** Metadata for a supported browser provider. */
export interface ProviderConfigEntry {
  /** Stable provider id. */
  id: BridgeProviderId;
  /** Human-readable label for CLI/TUI. */
  displayName: string;
  /** Whether MCP connector setup is supported. */
  supportsMcpConnector: boolean;
}

/** Registry of supported browser providers. */
export const PROVIDER_CONFIG: ProviderConfigEntry[] = [
  { id: "chatgpt", displayName: "ChatGPT", supportsMcpConnector: true },
  { id: "gemini", displayName: "Gemini", supportsMcpConnector: false },
];
