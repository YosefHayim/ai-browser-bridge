import { SITE_URL } from "@site/site-address.ts";
import type { SiteData } from "@site/site-data.ts";

export const createLlmsText = (siteData: SiteData): string => {
  const providerNames = siteData.providers.map((provider) => provider.siteName).join(", ");
  const providerLines = siteData.providers.map(
    (provider) => `- [${provider.siteName}](${SITE_URL}providers/${provider.id}/)`,
  );

  return [
    "# ai-browser-bridge",
    "",
    `> ai-browser-bridge is a CLI and MCP server that drives chat apps (${providerNames}) in your own logged-in Chrome, so a terminal or an agent can ask them a question and get the reply text back instead of the page. It needs no API keys. It exposes ${siteData.tools.length} MCP tools and ${siteData.permissionModes.length} permission modes for repo access.`,
    "",
    "## Pages",
    "",
    `- [Home](${SITE_URL})`,
    ...providerLines,
    "",
  ].join("\n");
};
