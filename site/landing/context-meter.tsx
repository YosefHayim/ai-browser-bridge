import { CountUpNumber } from "@site/landing/count-up-number.tsx";
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
        <CountUpNumber
          class="n"
          value={tokenNumbers.pageHtmlTokens}
          text={tokenNumbers.pageHtmlText}
        />
      </div>
      <div class="meter-row">
        <span>Reply text</span>
        <span class="bar">
          <i class="small" />
        </span>
        <CountUpNumber class="n" value={tokenNumbers.replyTokens} text={tokenNumbers.replyText} />
      </div>
      <div class="meter-foot">
        <span class="label">kept out of your agent</span>
        <strong>
          <CountUpNumber value={tokenNumbers.keptOutTokens} text={tokenNumbers.keptOutText} />
        </strong>
      </div>
    </div>
  </div>
);
