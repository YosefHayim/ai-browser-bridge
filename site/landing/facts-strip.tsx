import type { SiteData } from "@site/site-data.ts";

interface FactsStripProps {
  siteData: SiteData;
}

export const FactsStrip = ({ siteData }: FactsStripProps) => {
  const facts = [
    { value: String(siteData.providers.length), text: "chat apps behind one command" },
    { value: String(siteData.tools.length), text: "MCP tools for agents" },
    { value: String(siteData.permissionModes.length), text: "permission modes for repo access" },
    { value: "0", text: "API keys. Your own accounts and plans." },
  ];

  return (
    <div class="facts reveal">
      {facts.map((fact) => (
        <div class="fact" key={fact.text}>
          <b>{fact.value}</b>
          <span>{fact.text}</span>
        </div>
      ))}
    </div>
  );
};
