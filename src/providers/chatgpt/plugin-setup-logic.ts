export interface PluginSummary {
  name: string;
  detailUrl: string;
  serverUrl: string | null;
}

interface PluginSetupPlan {
  action: "reuse" | "replace" | "create" | "unreadable";
  pluginsToDelete: PluginSummary[];
}

// A tunnel answers 502 or 530 while it starts, so only a reply below 500 counts as up.
const firstServerErrorStatus = 500;

export const isTunnelReplyAnswering = (replyStatus: number): boolean => {
  return replyStatus < firstServerErrorStatus;
};

export const readPluginNameFromRowText = (rowText: string): string => {
  const firstLine = rowText.trim().split("\n")[0] ?? "";
  return firstLine.trim();
};

export const readServerUrlFromText = (details: {
  text: string;
  connectorUrl: string;
}): string | null => {
  const shownUrls: string[] = details.text.match(/https:\/\/[^\s"'<>)]+/g) ?? [];

  const isCurrentUrlShown = shownUrls.includes(details.connectorUrl);
  if (isCurrentUrlShown) return details.connectorUrl;

  const otherUrl = shownUrls.find((url) => !isChatGptOrOpenAiUrl(url));
  return otherUrl ?? null;
};

const isChatGptOrOpenAiUrl = (url: string): boolean => {
  const hostName = new URL(url).hostname;
  return hostName.endsWith("chatgpt.com") || hostName.endsWith("openai.com");
};

const CREATE_DIALOG_TRUST_LINE_START = "Only connect to MCP servers you trust";
const CREATE_DIALOG_FOOTER_LINE = "Read the guide";

// The create dialog shows ChatGPT's own error between the trust warning and its footer, e.g. a name clash.
export const pickCreateDialogErrorLine = (dialogText: string): string | null => {
  const lines = dialogText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const trustLineIndex = lines.findIndex((line) => line.startsWith(CREATE_DIALOG_TRUST_LINE_START));
  const isTrustLineMissing = trustLineIndex < 0;
  if (isTrustLineMissing) return null;

  const linesAfterTrustLine = lines.slice(trustLineIndex + 1);
  const footerLineIndex = linesAfterTrustLine.indexOf(CREATE_DIALOG_FOOTER_LINE);
  const isFooterLineMissing = footerLineIndex < 0;
  if (isFooterLineMissing) return linesAfterTrustLine[0] ?? null;

  return linesAfterTrustLine.slice(0, footerLineIndex)[0] ?? null;
};

// Only plugins named exactly like the connector are ever touched. Several same-name plugins are all replaced by one.
export const pickPluginSetupPlan = (details: {
  connectorName: string;
  connectorUrl: string;
  plugins: PluginSummary[];
}): PluginSetupPlan => {
  const bridgePlugins = details.plugins.filter((plugin) => plugin.name === details.connectorName);

  const isDuplicated = bridgePlugins.length > 1;
  if (isDuplicated) return { action: "replace", pluginsToDelete: bridgePlugins };

  const hasCurrentPlugin = bridgePlugins.some(
    (plugin) => plugin.serverUrl === details.connectorUrl,
  );
  if (hasCurrentPlugin) return { action: "reuse", pluginsToDelete: [] };

  const hasUnreadablePlugin = bridgePlugins.some((plugin) => plugin.serverUrl == null);
  if (hasUnreadablePlugin) return { action: "unreadable", pluginsToDelete: [] };

  const hasStalePlugin = bridgePlugins.length > 0;
  if (hasStalePlugin) return { action: "replace", pluginsToDelete: bridgePlugins };

  return { action: "create", pluginsToDelete: [] };
};
