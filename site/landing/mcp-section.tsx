import { RepoToolsPanel } from "@site/landing/repo-tools-panel.tsx";
import { ToolsExplorer } from "@site/landing/tools-explorer.tsx";
import type { SiteData } from "@site/site-data.ts";

interface McpSectionProps {
  siteData: SiteData;
}

export const McpSection = ({ siteData }: McpSectionProps) => {
  const agentTools = siteData.tools.filter((tool) => tool.direction === "served-to-agents");
  const repoTools = siteData.tools.filter((tool) => tool.direction === "served-to-chat-app");

  return (
    <section class="sec wrap" id="mcp">
      <div class="sec-head reveal">
        <h2 class="h2">MCP in both directions.</h2>
        <p class="lede">
          Your agent can call the chat apps. ChatGPT, Claude and Grok can read your repo through a
          small set of checked tools, never a shell.
        </p>
      </div>
      <div class="mcp">
        <div class="mcp-box reveal">
          <h3 class="h3">bridge serve</h3>
          <ToolsExplorer tools={agentTools} />
          <p>{siteData.tools.length} tools in all. Design tools that delete need confirm: true.</p>
        </div>
        <RepoToolsPanel repoTools={repoTools} permissionModes={siteData.permissionModes} />
      </div>
    </section>
  );
};
