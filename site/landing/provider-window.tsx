import type { HeroRunProvider } from "@site/hero-run.ts";
import { BrandIcon } from "@site/landing/brand-icons.tsx";
import { readProviderColor } from "@site/landing/provider-colors.ts";
import { readReplyParts } from "@site/landing/read-reply-parts.ts";

interface ProviderWindowProps {
  provider: HeroRunProvider;
  prompt: string;
  flyInX: number;
  flyInY: number;
}

export function ProviderWindow({ provider, prompt, flyInX, flyInY }: ProviderWindowProps) {
  const color = readProviderColor(provider.id);
  const replyParts = readReplyParts(provider.replyText, provider.label);

  return (
    <div class="win" style={`--cc:${color}`}>
      <div class="win-top">
        <span class="win-brand">
          <BrandIcon name={provider.id} size={15} />
        </span>
        <span class="label">{provider.host}</span>
        <span class="tag">driven by bridge</span>
      </div>
      <div class="msgs">
        <div class="ask">{prompt}</div>
        <div class="reply">
          <span class="who">{provider.label}</span>
          {replyParts.thoughtLine == null ? null : (
            <span class="thought">{replyParts.thoughtLine}</span>
          )}
          {replyParts.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
      <div class="composer" style={`--chars:${prompt.length}`}>
        <span class="ph">Message {provider.label}</span>
        <span class="typed">
          <span class="typed-box">
            <span class="typed-text">{prompt}</span>
            <span class="typed-cover">
              <i class="typed-caret" />
            </span>
          </span>
        </span>
        <button class="send" type="button" aria-label="Send">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 12V2M3 6l4-4 4 4"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <i class="click-ring" aria-hidden="true" />
      <i class="click-ring click-ring-send" aria-hidden="true" />
      <div class="cur">
        <div class="cur-in" style={`--fx:${flyInX}px;--fy:${flyInY}px`}>
          <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
            <path
              d="M2 2l15 8-6.5 1.6L7.5 18z"
              fill={color}
              stroke="#12100E"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
          <span class="name">
            <BrandIcon name={provider.id} size={12} />
            {provider.id}
          </span>
        </div>
      </div>
    </div>
  );
}
