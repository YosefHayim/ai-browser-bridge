import type { TokenNumbers } from "@site/token-numbers.ts";

interface ContextMeterProps {
  tokenNumbers: TokenNumbers;
}

export const ContextMeter = ({ tokenNumbers }: ContextMeterProps) => (
  <div class="card">
    <div class="card-head">
      <span class="label">context meter</span>
      <span class="label" style="margin-left:auto">
        tokens
      </span>
    </div>
    <div class="meter" style={`--small-bar:${tokenNumbers.smallBarPercent}%`}>
      <div class="meter-row">
        <span>Page HTML</span>
        <span class="bar">
          <i class="full" />
        </span>
        <span class="n">{tokenNumbers.pageHtmlText}</span>
      </div>
      <div class="meter-row">
        <span>Reply text</span>
        <span class="bar">
          <i class="small" />
        </span>
        <span class="n">{tokenNumbers.replyText}</span>
      </div>
      <div class="meter-foot">
        <span class="label">kept out of your agent</span>
        <strong>{tokenNumbers.keptOutText}</strong>
      </div>
    </div>
  </div>
);
