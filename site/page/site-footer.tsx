import { BrandIcon } from "@site/landing/brand-icons.tsx";
import { BrandMark } from "@site/page/brand-mark.tsx";
import { GITHUB_URL, NPM_URL, readSitePath } from "@site/site-address.ts";

interface SiteFooterProps {
  version: string;
}

export function SiteFooter({ version }: SiteFooterProps) {
  return (
    <footer class="foot">
      <div class="wrap">
        <div class="foot-in">
          <div>
            <BrandMark />
            <p>Drive the chat apps in your Chrome from the terminal and from your agents.</p>
          </div>
          <div class="foot-col">
            <span class="label">product</span>
            <a href={readSitePath("#how")}>How it works</a>
            <a href={readSitePath("#context")}>Context</a>
            <a href={readSitePath("#mcp")}>MCP tools</a>
            <a href={readSitePath("#faq")}>FAQ</a>
          </div>
          <div class="foot-col">
            <span class="label">resources</span>
            <a href={readSitePath("docs/")}>Docs</a>
            <a href={readSitePath("docs/usage/")}>Usage</a>
            <a href={readSitePath("docs/agents/")}>Agents and fan-out</a>
            <a href={GITHUB_URL}>
              <BrandIcon name="github" size={14} />
              GitHub
            </a>
            <a href={NPM_URL}>
              <BrandIcon name="npm" size={14} />
              npm
            </a>
            <a href={readSitePath("llms.txt")}>llms.txt</a>
          </div>
        </div>
        <div class="legal label">
          <span>MIT License · v{version}</span>
          <span>Not affiliated with OpenAI, Google, Anthropic, DeepSeek, xAI or Perplexity.</span>
        </div>
      </div>
    </footer>
  );
}
