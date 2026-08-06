export type ModelOption = {
  id: string;
  label: string;
  selected: boolean;
};

export type ConnectorSetupResult = {
  connectorUrl: string;
  completed: boolean;
  steps: string[];
  warnings: string[];
};

export type ConnectorSetupOptions = {
  connectorName?: string;
  automatic?: boolean;
};
