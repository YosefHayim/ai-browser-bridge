import type { HeroRunProvider } from "@site/hero-run.ts";
import { CountUpNumber } from "@site/landing/count-up-number.tsx";
import { readReplyParts } from "@site/landing/read-reply-parts.ts";
import { sumTokenNumbers } from "@site/token-numbers.ts";

interface ContextSectionProps {
  provider: HeroRunProvider;
}

const PAGE_MARKUP_LINES = [
  '<div class="flex h-full flex-col" data-testid="conversation-turn-14">',
  '<script id="__NEXT_DATA__" type="application/json">{"props":',
  '<div class="relative flex w-full min-w-0 flex-col agent-turn">',
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">',
  '<button aria-label="Copy" class="rounded-lg text-token-text-',
  '<div class="markdown prose w-full break-words dark:prose-invert">',
  '<link rel="preload" as="script" crossorigin="anonymous" href=',
  '<div data-message-author-role="user" data-message-id="aaa2',
  '<span class="sr-only">You said:</span><div class="whitespace',
  '<nav class="flex h-full w-full flex-col px-3" aria-label="Chat',
];

export const ContextSection = ({ provider }: ContextSectionProps) => {
  const tokenNumbers = sumTokenNumbers([provider]);
  const replyParts = readReplyParts(provider.replyText, provider.label);

  return (
    <section class="sec wrap" id="context">
      <div class="ctx">
        <div class="ctx-copy reveal">
          <h2 class="h2">Your agent reads the answer, not the page.</h2>
          <p class="lede">
            A chat page is thousands of lines of markup, scripts and old messages. The bridge reads
            the reply inside Chrome and hands back only the text, so your agent keeps its context
            for your code.
          </p>
        </div>
        <div class="ctx-board reveal">
          <div class="ctx-cols">
            <div class="ctx-col">
              <span class="label">what a page scrape would send</span>
              <CountUpNumber
                class="big"
                value={tokenNumbers.pageHtmlTokens}
                text={tokenNumbers.pageHtmlText}
              />
              <span class="label">tokens of page HTML</span>
              <div class="html-lines" aria-hidden="true">
                {PAGE_MARKUP_LINES.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            </div>
            <div class="ctx-col">
              <span class="label">what bridge returns</span>
              <CountUpNumber
                class="big"
                style="color:var(--accent-text)"
                value={tokenNumbers.replyTokens}
                text={tokenNumbers.replyText}
              />
              <span class="label">tokens of reply text</span>
              <div class="reply-out">{replyParts.answerText}</div>
            </div>
          </div>
          <div class="big-meter" style={`--small-bar:${tokenNumbers.smallBarPercent}%`}>
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
              <CountUpNumber
                class="n"
                value={tokenNumbers.replyTokens}
                text={tokenNumbers.replyText}
              />
            </div>
          </div>
          <div class="log">
            <div class="log-row">
              <i style="background:var(--c-claude)" />
              <b>{provider.id}</b>reply read inside Chrome<span class="label">step 1</span>
            </div>
            <div class="log-row">
              <i style="background:var(--accent)" />
              <b>bridge</b>returned the text as JSON<span class="label">step 2</span>
            </div>
            <div class="log-row">
              <i style="background:var(--c-deepseek)" />
              <b>agent</b>got the answer, not the page<span class="label">step 3</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
