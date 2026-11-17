import { CountUpNumber } from "@site/landing/count-up-number.tsx";
import type { SiteData } from "@site/site-data.ts";

interface FactsStripProps {
  siteData: SiteData;
}

export function FactsStrip({ siteData }: FactsStripProps) {
  const agentToolCount = siteData.tools.filter(
    (tool) => tool.direction === "served-to-agents",
  ).length;
  const facts = [
    { value: siteData.providers.length, text: "chat apps behind one command" },
    { value: agentToolCount, text: "MCP tools for agents" },
    { value: siteData.permissionModes.length, text: "permission modes for repo access" },
    { value: 0, text: "API keys. Your own accounts and plans." },
  ];

  return (
    <div class="facts reveal">
      {facts.map((fact) => (
        <div class="fact" key={fact.text}>
          <b>
            <CountUpNumber value={fact.value} text={String(fact.value)} />
          </b>
          <span>{fact.text}</span>
        </div>
      ))}
    </div>
  );
}
