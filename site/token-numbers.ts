import type { HeroRunProvider } from "@site/hero-run.ts";

const MINIMUM_SMALL_BAR_PERCENT = 1.5;

export interface TokenNumbers {
  pageHtmlTokens: number;
  replyTokens: number;
  keptOutTokens: number;
  pageHtmlText: string;
  replyText: string;
  keptOutText: string;
  ratioText: string;
  smallBarPercent: number;
}

const numberFormat = new Intl.NumberFormat("en-US");

const formatCount = (count: number): string => numberFormat.format(count);

const formatRatio = (ratio: number): string => {
  const isLargeRatio = ratio >= 10;
  const ratioText = isLargeRatio ? ratio.toFixed(0) : ratio.toFixed(1);

  return `${ratioText}x`;
};

export const sumTokenNumbers = (providers: HeroRunProvider[]): TokenNumbers => {
  const pageHtmlTokens = providers.reduce((sum, provider) => sum + provider.pageHtmlTokens, 0);
  const replyTokens = providers.reduce((sum, provider) => sum + provider.replyTokens, 0);
  const keptOutTokens = pageHtmlTokens - replyTokens;
  const ratio = replyTokens === 0 ? 0 : pageHtmlTokens / replyTokens;
  const replyPercent = pageHtmlTokens === 0 ? 100 : (replyTokens / pageHtmlTokens) * 100;

  return {
    pageHtmlTokens,
    replyTokens,
    keptOutTokens,
    pageHtmlText: formatCount(pageHtmlTokens),
    replyText: formatCount(replyTokens),
    keptOutText: formatCount(keptOutTokens),
    ratioText: formatRatio(ratio),
    smallBarPercent: Math.min(100, Math.max(MINIMUM_SMALL_BAR_PERCENT, replyPercent)),
  };
};
