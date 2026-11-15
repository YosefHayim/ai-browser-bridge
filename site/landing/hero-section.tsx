import { AgentTerminal } from "@site/landing/agent-terminal.tsx";
import { ContextMeter } from "@site/landing/context-meter.tsx";
import { HeroProviderWindows } from "@site/landing/hero-provider-windows.tsx";
import { InstallBox } from "@site/landing/install-box.tsx";
import type { SiteData } from "@site/site-data.ts";
import { sumTokenNumbers } from "@site/token-numbers.ts";

interface HeroSectionProps {
  siteData: SiteData;
}

const HEADLINE_WORDS = ["Every", "chat", "app,", "driven", "from", "one", "command."];
const SHOWN_WINDOW_COUNT = 3;

export const HeroSection = ({ siteData }: HeroSectionProps) => {
  const { heroRun, version } = siteData;
  const shownProviders = heroRun.providers.slice(0, SHOWN_WINDOW_COUNT);
  const tokenNumbers = sumTokenNumbers(heroRun.providers);

  return (
    <section class="hero" id="top">
      <div class="wrap">
        <div class="hero-top">
          <div class="hero-copy">
            <h1 class="h1">
              {HEADLINE_WORDS.map((word, index) => (
                <>
                  <span class="w rise" style={`--step:${index + 1}`} key={word}>
                    {word}
                  </span>{" "}
                </>
              ))}
            </h1>
            <p class="lede rise" style="--step:8">
              Ask ChatGPT, Claude, Gemini, DeepSeek, Grok and more in your own logged-in Chrome,
              from the terminal or from your agent. One provider or all of them at once. Your agent
              gets the reply, not the page.
            </p>
          </div>
          <div class="rise" style="--step:9" id="install">
            <InstallBox />
            <div class="hint label">
              <span>v{version}</span>
              <span>macOS, Windows, Linux</span>
              <span>Node 24</span>
              <span>No API keys</span>
              <span>MIT</span>
            </div>
          </div>
        </div>

        <div class="stage rise" style="--step:10">
          <HeroProviderWindows heroRun={heroRun} shownProviders={shownProviders} />
          <div class="cards">
            <AgentTerminal
              command={heroRun.command}
              totalDurationMs={heroRun.durationMs}
              shownProviders={shownProviders}
            />
            <ContextMeter tokenNumbers={tokenNumbers} />
          </div>
        </div>
      </div>
    </section>
  );
};
