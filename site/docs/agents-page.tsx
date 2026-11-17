import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";
import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import { readSitePath } from "@site/site-address.ts";
import type { SiteData } from "@site/site-data.ts";

interface AgentsPageProps {
  siteData: SiteData;
}

const FAN_OUT_CODE = `# one provider
bridge ask --provider claude --json "summarize the tradeoffs of optimistic locking"

# fan out across several free chats; one call, replies keyed by provider
bridge ask --provider claude,deepseek,grok --json "same question, three models"
# → { "claude": { "ok": true, "reply": "…", "elapsedMs": 8123 },
#     "deepseek": { "ok": true, "reply": "…", "elapsedMs": 6210 },
#     "grok": { "ok": false, "error": "…", "elapsedMs": 300000 } }`;

const CLAUDE_CODE_ADD = `claude mcp add ai-browser-bridge -- bridge serve`;

const MCP_CLIENT_SETTINGS_CODE = `{
  "mcpServers": {
    "ai-browser-bridge": { "command": "bridge", "args": ["serve"] }
  }
}`;

export function AgentsPage({ siteData }: AgentsPageProps) {
  return (
    <DocsPageLayout
      navGroups={createDocsNavGroups(siteData, "docs/agents/")}
      heading="Agents and fan-out"
    >
      <p>
        <code>bridge ask</code> is a stable, non-interactive surface for scripts and agents: it
        prints to stdout, never prompts in a pipe, and <code>--json</code> emits a machine-readable
        payload.
      </p>
      <CodeBlock code={FAN_OUT_CODE} />
      <p>
        Fan-out is <strong>partial-failure tolerant</strong>: the run exits non-zero only when{" "}
        <em>every</em> provider fails, or, with <code>--strict</code>, when <em>any</em> fails. Run{" "}
        <code>bridge chrome start --provider &lt;name&gt;</code> and sign in if needed; the bridge
        reuses the shared bridge Chrome profile across repos.
      </p>
      <DocsSection title="The bridge serve MCP server">
        <p>
          The same fan-out core is exposed through outbound MCP tools. Launch a stdio MCP server
          with <code>bridge serve</code> and any MCP-capable agent can call{" "}
          <code>ask({"{ prompt, providers }"})</code> or{" "}
          <code>search_conversations({"{ query, providers, limit }"})</code> as native tools instead
          of shelling out. Register it with Claude Code:
        </p>
        <CodeBlock code={CLAUDE_CODE_ADD} />
        <p>...or add it to any MCP client config directly (the standard stdio-server shape):</p>
        <CodeBlock code={MCP_CLIENT_SETTINGS_CODE} />
        <p>
          The <code>ask</code> tool takes <code>{"{ prompt, providers?, timeoutSeconds? }"}</code>{" "}
          and returns each provider's reply keyed by id (the same partial-failure-tolerant fan-out
          as <code>bridge ask</code>). The <code>search_conversations</code> tool takes{" "}
          <code>{"{ query, providers?, limit? }"}</code> and returns matching conversation URLs
          keyed by provider. Run <code>bridge chrome start --provider &lt;name&gt;</code> first, so
          the gateway has a signed-in Chrome session to drive. This is the opposite direction to the
          inbound MCP server, which exposes your repo tools <em>to</em> the web model. See the{" "}
          <a href={readSitePath("#mcp")}>full tool list</a>.
        </p>
        <p>
          Provider adapters other than ChatGPT and Gemini ship with best-effort selectors marked{" "}
          <code>LIVE-VERIFY</code>. Confirm them against the live signed-in site before relying on
          them in production.
        </p>
      </DocsSection>
    </DocsPageLayout>
  );
}
