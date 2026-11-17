import { DOCS_PAGES } from "@site/docs/docs-page-list.ts";
import { SITE_URL } from "@site/site-address.ts";
import type { SiteData } from "@site/site-data.ts";

export function createLlmsText(siteData: SiteData): string {
  const providerNames = siteData.providers.map((provider) => provider.siteName).join(", ");
  const providerLines = siteData.providers.map(
    (provider) => `- [${provider.siteName}](${SITE_URL}providers/${provider.id}/)`,
  );

  return [
    "# ai-browser-bridge",
    "",
    `> ai-browser-bridge is a CLI and MCP server that drives chat apps (${providerNames}) in your own logged-in Chrome, so a terminal or an agent can ask them a question and get the reply text back instead of the page. It needs no API keys. It serves ${siteData.tools.filter((tool) => tool.direction === "served-to-agents").length} MCP tools to agents, and ${siteData.tools.filter((tool) => tool.direction === "served-to-chat-app").length} repo tools to the chat app behind ${siteData.permissionModes.length} permission modes.`,
    "",
    "## Pages",
    "",
    `- [Home](${SITE_URL})`,
    `- [Docs](${SITE_URL}docs/)`,
    ...DOCS_PAGES.map((page) => `- [${page.label}](${SITE_URL}${page.pathInsideSite})`),
    ...providerLines,
    "",
  ].join("\n");
}
