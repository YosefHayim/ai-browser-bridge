import type { HeroRun } from "@site/hero-run.ts";
import { readReplyParts } from "@site/landing/read-reply-parts.ts";

const SIGNED_IN_APPS = ["ChatGPT", "Claude", "Gemini", "DeepSeek", "Grok", "Perplexity"];

const WindowDots = () => (
  <>
    <i class="dot" />
    <i class="dot" />
    <i class="dot" />
  </>
);

interface HowItWorksProps {
  heroRun: HeroRun;
}

const REPLY_START_WORDS = 4;

const readReplyStart = (replyText: string): string =>
  `${replyText.split(/\s+/).slice(0, REPLY_START_WORDS).join(" ")}…`;

export const HowItWorks = ({ heroRun }: HowItWorksProps) => {
  const jsonProviders = heroRun.providers.slice(0, 3);

  return (
    <section class="sec wrap" id="how">
      <div class="sec-head reveal">
        <span class="label">/how-it-works</span>
        <h2 class="h2">Log in once. Ask from anywhere.</h2>
        <p class="lede">
          The bridge opens Chrome on its own profile. You sign in to each chat app one time, and
          every repo and every agent reuses it.
        </p>
      </div>
      <div class="steps">
        <div class="step reveal">
          <div class="step-txt">
            <span class="num">01</span>
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
              {SIGNED_IN_APPS.map((appName) => (
                <div key={appName}>
                  {appName}
                  <em>signed in</em>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div class="step reveal">
          <div class="step-txt">
            <span class="num">02</span>
            <h3 class="h3">Ask from the terminal or your agent</h3>
            <p>
              Name one provider or a list to fan out. Agents connect over MCP and call the same ask
              tool.
            </p>
            <code>bridge serve</code>
          </div>
          <div class="panel">
            <div class="panel-head">
              <span class="label">terminal</span>
            </div>
            <pre class="code">
              <span class="c"># one provider</span>
              {"\n"}
              <span class="p">$</span> bridge ask --provider claude --json{" "}
              <span class="s">"Review this migration"</span>
              {"\n\n"}
              <span class="c"># fan out to three</span>
              {"\n"}
              <span class="p">$</span> bridge ask --provider claude,deepseek,grok --json{" "}
              <span class="s">"same question, three models"</span>
              {"\n\n"}
              <span class="c"># give Claude Code the bridge as MCP tools</span>
              {"\n"}
              <span class="p">$</span> claude mcp add ai-browser-bridge -- bridge serve
            </pre>
          </div>
        </div>
        <div class="step reveal">
          <div class="step-txt">
            <span class="num">03</span>
            <h3 class="h3">Get clean JSON back</h3>
            <p>
              Each provider returns its reply text as JSON, ready for a script or an agent to read.
            </p>
            <code>--json</code>
          </div>
          <div class="panel">
            <div class="panel-head">
              <span class="label">stdout</span>
            </div>
            <pre class="code">
              {"[\n"}
              {jsonProviders.map((provider, index) => (
                <>
                  {"  { "}
                  <span class="k">"provider"</span>: <span class="s">"{provider.id}"</span>,{" "}
                  <span class="k">"ok"</span>: true, <span class="k">"text"</span>:{" "}
                  <span class="s">
                    "{readReplyStart(readReplyParts(provider.replyText, provider.label).answerText)}
                    "
                  </span>
                  {index === jsonProviders.length - 1 ? " }\n" : " },\n"}
                </>
              ))}
              {"]"}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
};
