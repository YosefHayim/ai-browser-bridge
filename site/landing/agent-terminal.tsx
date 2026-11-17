import type { HeroRun } from "@site/hero-run.ts";
import { colorCommand, colorNumbers } from "@site/landing/command-colors.tsx";
import { ShellPrompt, TerminalWindow } from "@site/landing/terminal-window.tsx";

interface AgentTerminalProps {
  command: string;
  totalDurationMs: number;
  shownProviders: HeroRun["providers"];
}

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function readDurationText(durationMs: number | undefined): string {
  return durationMs == null ? "" : ` · ${formatSeconds(durationMs)}`;
}

export function AgentTerminal({ command, totalDurationMs, shownProviders }: AgentTerminalProps) {
  const providerCount = shownProviders.length;

  return (
    <TerminalWindow title="your agent · ~/shop-api">
      <div class="term">
        <span class="t t1">
          <ShellPrompt />
          {colorCommand(command)}
        </span>
        <span class="t t2 k">{`  sending to ${providerCount} chat apps in your Chrome`}</span>
        {shownProviders.map((provider, index) => (
          <span class={`t t${index + 3}`} key={provider.id}>
            <span class="ok">{"  ✓"}</span>
            {` ${provider.id.padEnd(10)} `}
            <span class="k">
              {"ok · reply returned"}
              {colorNumbers(readDurationText(provider.durationMs))}
            </span>
          </span>
        ))}
        <span class={`t t${providerCount + 3} k`}>
          {colorNumbers(
            `  ${providerCount} of ${providerCount} replied in ${formatSeconds(totalDurationMs)} · the pages stayed in Chrome`,
          )}
        </span>
      </div>
    </TerminalWindow>
  );
}
