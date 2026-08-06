/** Model picker option from the provider UI. */
export type ModelOption = {
  id: string;
  label: string;
  selected: boolean;
};

/** Outcome of an MCP connector setup flow in ChatGPT. */
export type ConnectorSetupResult = {
  connectorUrl: string;
  completed: boolean;
  steps: string[];
  warnings: string[];
};

/** Options for opening the MCP connector setup UI. */
export type ConnectorSetupOptions = {
  connectorName?: string;
  automatic?: boolean;
};
