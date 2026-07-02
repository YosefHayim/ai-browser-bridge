/** Model picker option from the provider UI. */
export interface ModelOption {
  /** Provider model id or alias. */
  id: string;
  /** Human-readable label shown in the picker. */
  label: string;
  /** Whether the option is currently selected. */
  selected: boolean;
}

/** Outcome of an MCP connector setup flow in ChatGPT. */
export interface ConnectorSetupResult {
  /** Connector URL opened during setup. */
  connectorUrl: string;
  /** Whether the setup flow completed successfully. */
  completed: boolean;
  /** Human-readable steps taken during setup. */
  steps: string[];
  /** Non-fatal warnings collected during setup. */
  warnings: string[];
}

/** Options for opening the MCP connector setup UI. */
export interface ConnectorSetupOptions {
  /** Display name for the connector. */
  connectorName?: string;
  /** When true, attempt automated setup steps. */
  automatic?: boolean;
}
