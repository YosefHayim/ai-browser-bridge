import { type BridgeProviderId, DEFAULT_PROVIDER, PROVIDER_CONFIG, PROVIDER_IDS } from "@/config";
import { arenaProvider } from "@/providers/arena/arena-page.ts";
import { chatGptConversationIdFromUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { chatGptProvider } from "@/providers/chatgpt/chatgpt-page.ts";
import { designProvider } from "@/providers/design/design-page.ts";
import { flowProvider } from "@/providers/flow/flow-page.ts";
import { geminiProvider } from "@/providers/gemini/gemini-page.ts";
import type { BrowserProvider } from "./browser-provider.ts";
import { createUnknownProviderError } from "./provider-errors.ts";
import { selectorDrivenProvider } from "./selector-driven-provider.ts";

// Metadata and selectors live in `@/config`. This table binds each id to behavior.
// The Record annotation makes a missing adapter a compile error.
const PROVIDER_ADAPTERS: Record<BridgeProviderId, BrowserProvider> = {
  chatgpt: chatGptProvider,
  gemini: geminiProvider,
  claude: selectorDrivenProvider("claude"),
  deepseek: selectorDrivenProvider("deepseek"),
  grok: selectorDrivenProvider("grok"),
  perplexity: selectorDrivenProvider("perplexity"),
  flow: flowProvider,
  duck: selectorDrivenProvider("duck"),
  arena: arenaProvider,
  design: designProvider,
};

const isBridgeProviderId = (providerId: string): providerId is BridgeProviderId => {
  return (PROVIDER_IDS as readonly string[]).includes(providerId);
};

export const providerIdFrom = (rawProviderId: string | undefined): BridgeProviderId => {
  const isProviderIdMissing = rawProviderId === undefined;
  if (isProviderIdMissing) return DEFAULT_PROVIDER;

  const providerId = rawProviderId.trim();

  const isProviderIdEmpty = providerId.length === 0;
  if (isProviderIdEmpty) return DEFAULT_PROVIDER;

  if (isBridgeProviderId(providerId)) return providerId;

  throw createUnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
};

export const providerFor = (rawProviderId: string | undefined): BrowserProvider => {
  return PROVIDER_ADAPTERS[providerIdFrom(rawProviderId)];
};

export const providerIdsFrom = (rawProviderIds: string | undefined): BridgeProviderId[] => {
  const isProviderIdsMissing = rawProviderIds === undefined;
  if (isProviderIdsMissing) return [DEFAULT_PROVIDER];

  const isProviderIdsEmpty = rawProviderIds.trim().length === 0;
  if (isProviderIdsEmpty) return [DEFAULT_PROVIDER];

  const providerIds = rawProviderIds.split(",").map((segment) => providerIdFrom(segment));
  return [...new Set(providerIds)];
};

export const conversationIdForProviderUrl = (input: {
  providerId: string;
  url: string;
}): string | null => {
  const urlProviderId = providerIdForUrl(input.url);
  const isUnknownProviderGiven = input.providerId !== "chatgpt" || urlProviderId !== "chatgpt";
  if (isUnknownProviderGiven) return null;

  return chatGptConversationIdFromUrl(input.url);
};

const hostOwnedBy = (hostname: string, origin: string): boolean => {
  return hostname === origin || hostname.endsWith(`.${origin}`);
};

const pathOwnedBy = (pathname: string, pathPrefix: string): boolean => {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
};

// The most specific owner wins, so a claude.ai/design tab belongs to Design, not Claude.
export const providerIdForUrl = (url: string): BridgeProviderId | undefined => {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return undefined;

  const { hostname, pathname } = new URL(url);
  let ownerProviderId: BridgeProviderId | undefined;
  let ownerPathLength = -1;
  for (const providerId of PROVIDER_IDS) {
    const { origin, pathPrefix } = PROVIDER_CONFIG[providerId];
    const isHostNotOwned = !hostOwnedBy(hostname, origin);
    if (isHostNotOwned) continue;

    let ownedPathLength = 0;

    const hasPathPrefix = pathPrefix !== undefined;
    if (hasPathPrefix) {
      const isPathNotOwned = !pathOwnedBy(pathname, pathPrefix);
      if (isPathNotOwned) continue;

      ownedPathLength = pathPrefix.length;
    }

    const isOwnerPathNotLonger = ownedPathLength <= ownerPathLength;
    if (isOwnerPathNotLonger) continue;

    ownerProviderId = providerId;
    ownerPathLength = ownedPathLength;
  }
  return ownerProviderId;
};
