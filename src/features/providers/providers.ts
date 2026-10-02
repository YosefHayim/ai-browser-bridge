import { type BridgeProviderId, DEFAULT_PROVIDER, PROVIDER_CONFIG, PROVIDER_IDS } from "@/config";
import { arenaProvider } from "./arena/arenaPage.ts";
import type { BrowserProvider } from "./browserProvider.ts";
import { chatGptProvider } from "./chatgpt/chatgptPage.ts";
import { designProvider } from "./design/designPage.ts";
import { flowProvider } from "./flow/flowPage.ts";
import { geminiProvider } from "./gemini/geminiPage.ts";
import { UnknownProviderError } from "./providerErrors.ts";
import { selectorDrivenProvider } from "./selectorDrivenProvider.ts";

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
  if (rawProviderId === undefined) return DEFAULT_PROVIDER;
  const providerId = rawProviderId.trim();
  if (providerId.length === 0) return DEFAULT_PROVIDER;
  if (isBridgeProviderId(providerId)) return providerId;
  throw new UnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
};

export const providerFor = (rawProviderId: string | undefined): BrowserProvider => {
  return PROVIDER_ADAPTERS[providerIdFrom(rawProviderId)];
};

export const providerIdsFrom = (rawProviderIds: string | undefined): BridgeProviderId[] => {
  if (rawProviderIds === undefined) return [DEFAULT_PROVIDER];
  if (rawProviderIds.trim().length === 0) return [DEFAULT_PROVIDER];
  const providerIds = rawProviderIds.split(",").map((segment) => providerIdFrom(segment));
  return [...new Set(providerIds)];
};

const hostOwnedBy = (hostname: string, origin: string): boolean => {
  return hostname === origin || hostname.endsWith(`.${origin}`);
};

const pathOwnedBy = (pathname: string, pathPrefix: string): boolean => {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
};

// The most specific owner wins, so a claude.ai/design tab belongs to Design, not Claude.
export const providerIdForUrl = (url: string): BridgeProviderId | undefined => {
  if (!URL.canParse(url)) return undefined;
  const { hostname, pathname } = new URL(url);
  let ownerProviderId: BridgeProviderId | undefined;
  let ownerPathLength = -1;
  for (const providerId of PROVIDER_IDS) {
    const { origin, pathPrefix } = PROVIDER_CONFIG[providerId];
    if (!hostOwnedBy(hostname, origin)) continue;
    let ownedPathLength = 0;
    if (pathPrefix !== undefined) {
      if (!pathOwnedBy(pathname, pathPrefix)) continue;
      ownedPathLength = pathPrefix.length;
    }
    if (ownedPathLength <= ownerPathLength) continue;
    ownerProviderId = providerId;
    ownerPathLength = ownedPathLength;
  }
  return ownerProviderId;
};
