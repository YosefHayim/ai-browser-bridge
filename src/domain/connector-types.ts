export type ModelOption = {
  id: string;
  label: string;
  selected: boolean;
};

export type ConnectorSetupReport = {
  connectorUrl: string;
  completed: boolean;
  steps: string[];
  warnings: string[];
};

export type ConnectorSetupSettings = {
  connectorName?: string;
  automatic?: boolean;
};
