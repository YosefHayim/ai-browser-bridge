export interface PluginSummary {
  name: string;
  detailUrl: string;
  serverUrl: string | null;
}

interface PluginSetupPlan {
  action: "reuse" | "replace" | "create" | "unreadable";
  pluginsToDelete: PluginSummary[];
}

export const readPluginNameFromRowText = (rowText: string): string => {
  const firstLine = rowText.trim().split("\n")[0] ?? "";
  return firstLine.trim();
};

export const readServerUrlFromText = (details: {
  text: string;
  connectorUrl: string;
}): string | null => {
  const shownUrls = details.text.match(/https:\/\/[^\s"'<>)]+/g) ?? [];

  const isCurrentUrlShown = shownUrls.includes(details.connectorUrl);
  if (isCurrentUrlShown) return details.connectorUrl;

  const otherUrl = shownUrls.find((url) => !isChatGptOrOpenAiUrl(url));
  return otherUrl ?? null;
};

const isChatGptOrOpenAiUrl = (url: string): boolean => {
  const hostName = new URL(url).hostname;
  return hostName.endsWith("chatgpt.com") || hostName.endsWith("openai.com");
};

// Only plugins named exactly like the connector are ever touched. A same-name plugin with the current URL is reused.
export const readPluginSetupPlan = (details: {
  connectorName: string;
  connectorUrl: string;
  plugins: PluginSummary[];
}): PluginSetupPlan => {
  const samePlugins = details.plugins.filter((plugin) => plugin.name === details.connectorName);

  const hasCurrentPlugin = samePlugins.some((plugin) => plugin.serverUrl === details.connectorUrl);
  if (hasCurrentPlugin) return { action: "reuse", pluginsToDelete: [] };

  const hasUnreadablePlugin = samePlugins.some((plugin) => plugin.serverUrl == null);
  if (hasUnreadablePlugin) return { action: "unreadable", pluginsToDelete: [] };

  const hasStalePlugin = samePlugins.length > 0;
  if (hasStalePlugin) return { action: "replace", pluginsToDelete: samePlugins };

  return { action: "create", pluginsToDelete: [] };
};
