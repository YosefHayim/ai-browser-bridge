import type { HeroRun } from "@site/hero-run.ts";

interface AgentTerminalProps {
  command: string;
  totalDurationMs: number;
  shownProviders: HeroRun["providers"];
}

const formatSeconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`;

const readDurationText = (durationMs: number | undefined): string =>
  durationMs == null ? "" : ` · ${formatSeconds(durationMs)}`;

export const AgentTerminal = ({ command, totalDurationMs, shownProviders }: AgentTerminalProps) => {
  const providerCount = shownProviders.length;

  return (
    <div class="card">
      <div class="card-head">
        <span class="label">your agent · terminal</span>
        <span class="label" style="margin-left:auto">
          ~/shop-api
        </span>
      </div>
      <div class="term">
        <span class="t t1">
          <span class="p">$</span>
          {` ${command}`}
        </span>
        <span class="t t2 k">{`  sending to ${providerCount} chat apps in your Chrome`}</span>
        {shownProviders.map((provider, index) => (
          <span class={`t t${index + 3}`} key={provider.id}>
            <span class="ok">{"  ✓"}</span>
            {` ${provider.id.padEnd(10)} `}
            <span class="k">{`ok · reply returned${readDurationText(provider.durationMs)}`}</span>
          </span>
        ))}
        <span class={`t t${providerCount + 3} k`}>
          {`  ${providerCount} of ${providerCount} replied in ${formatSeconds(totalDurationMs)} · the pages stayed in Chrome`}
        </span>
      </div>
    </div>
  );
};
