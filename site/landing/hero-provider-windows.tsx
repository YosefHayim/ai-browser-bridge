import type { HeroRun } from "@site/hero-run.ts";
import { ProviderWindow } from "@site/landing/provider-window.tsx";

interface HeroProviderWindowsProps {
  heroRun: HeroRun;
  shownProviders: HeroRun["providers"];
}

const FLY_IN_STARTS = [
  { x: -220, y: -160 },
  { x: 0, y: -260 },
  { x: 220, y: -160 },
];

export function HeroProviderWindows({ heroRun, shownProviders }: HeroProviderWindowsProps) {
  return (
    <div class="desk">
      <div class="desk-bar">
        <i class="dot" />
        <i class="dot" />
        <i class="dot" />
        <span class="label">Chrome · ~/.ai-browser-bridge/chrome-profile</span>
        <span class="live label">
          <i class="pulse" />
          bridge ask · {shownProviders.length} providers
        </span>
      </div>
      <div class="desk-body">
        {shownProviders.map((provider, index) => (
          <ProviderWindow
            provider={provider}
            prompt={heroRun.prompt}
            flyInX={FLY_IN_STARTS[index]?.x ?? 0}
            flyInY={FLY_IN_STARTS[index]?.y ?? -200}
            key={provider.id}
          />
        ))}
      </div>
    </div>
  );
}
