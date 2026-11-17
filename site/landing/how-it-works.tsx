import type { HeroRun } from "@site/hero-run.ts";
import { BrandIcon } from "@site/landing/brand-icons.tsx";
import { colorCommand } from "@site/landing/command-colors.tsx";
import { readProviderColor } from "@site/landing/provider-colors.ts";
import { readReplyParts } from "@site/landing/read-reply-parts.ts";
import { ShellPrompt, TerminalWindow } from "@site/landing/terminal-window.tsx";

const SIGNED_IN_APPS = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "grok", name: "Grok" },
  { id: "perplexity", name: "Perplexity" },
];

function WindowDots() {
  return (
    <>
      <i class="dot" />
      <i class="dot" />
      <i class="dot" />
    </>
  );
}

interface HowItWorksProps {
  heroRun: HeroRun;
}

const REPLY_START_WORDS = 4;

function readReplyStart(replyText: string): string {
  return `${replyText.split(/\s+/).slice(0, REPLY_START_WORDS).join(" ")}…`;
}

export function HowItWorks({ heroRun }: HowItWorksProps) {
  const jsonProviders = heroRun.providers.slice(0, 3);

  return (
    <section class="sec wrap" id="how">
      <div class="sec-head reveal">
        <h2 class="h2">Log in once. Ask from anywhere.</h2>
        <p class="lede">
          The bridge opens Chrome on its own profile. You sign in to each chat app one time, and
          every repo and every agent reuses it.
        </p>
      </div>
      <div class="steps">
        <div class="step reveal">
          <div class="step-txt">
            <h3 class="h3">Start the bridge Chrome</h3>
            <p>
              Opens a Chrome window on a separate profile. Sign in to the chat apps you use. The
              sessions stay there for every repo.
            </p>
            <code>bridge chrome start</code>
          </div>
          <div class="panel">
            <div class="panel-head">
              <WindowDots />
              <span class="label" style="margin-left:8px">
                ~/.ai-browser-bridge/chrome-profile
              </span>
            </div>
            <div class="signed">
              {SIGNED_IN_APPS.map((app) => (
                <div key={app.id} style={`--cc:${readProviderColor(app.id)}`}>
                  <span class="app-name">
                    <BrandIcon name={app.id} size={15} />
                    {app.name}
                  </span>
                  <em>signed in</em>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class="step reveal">
          <div class="step-txt">
            <h3 class="h3">Ask from the terminal or your agent</h3>
            <p>
              Name one provider or a list to fan out. Agents connect over MCP and call the same ask
              tool.
            </p>
            <code>bridge serve</code>
          </div>
          <TerminalWindow title="terminal" className="panel">
            <pre class="code">
              <span class="tk-dim"># one provider</span>
              {"\n"}
              <ShellPrompt />
              {colorCommand('bridge ask --provider claude --json "Review this migration"')}
              {"\n\n"}
              <span class="tk-dim"># fan out to three</span>
              {"\n"}
              <ShellPrompt />
              {colorCommand(
                'bridge ask --provider claude,deepseek,grok --json "same question, three models"',
              )}
              {"\n\n"}
              <span class="tk-dim"># give Claude Code the bridge as MCP tools</span>
              {"\n"}
              <ShellPrompt />
              {colorCommand("claude mcp add ai-browser-bridge -- bridge serve")}
            </pre>
          </TerminalWindow>
        </div>
        <div class="step reveal">
          <div class="step-txt">
            <h3 class="h3">Get clean JSON back</h3>
            <p>
              Each provider returns its reply text as JSON, ready for a script or an agent to read.
            </p>
            <code>--json</code>
          </div>
          <TerminalWindow title="stdout" className="panel">
            <pre class="code">
              {"[\n"}
              {jsonProviders.map((provider, index) => (
                <>
                  {"  { "}
                  <span class="tk-flag">"provider"</span>:{" "}
                  <span class="tk-value">"{provider.id}"</span>, <span class="tk-flag">"ok"</span>:{" "}
                  <span class="tk-ok">true</span>, <span class="tk-flag">"text"</span>:{" "}
                  <span class="tk-value">
                    "{readReplyStart(readReplyParts(provider.replyText, provider.label).answerText)}
                    "
                  </span>
                  {index === jsonProviders.length - 1 ? " }\n" : " },\n"}
                </>
              ))}
              {"]"}
            </pre>
          </TerminalWindow>
        </div>
      </div>
    </section>
  );
}
