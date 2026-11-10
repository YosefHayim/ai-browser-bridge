import { type BridgeProviderId, DEFAULT_PROVIDER, PROVIDER_IDS, PROVIDER_SETTINGS } from "@/config";
import { arenaProvider } from "@/providers/arena/arena-page.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { chatGptProvider } from "@/providers/chatgpt/chatgpt-page.ts";
import { designProvider } from "@/providers/design/design-page.ts";
import { flowProvider } from "@/providers/flow/flow-page.ts";
import { geminiProvider } from "@/providers/gemini/gemini-page.ts";
import type { BrowserProvider } from "./browser-provider.ts";
import { createUnknownProviderError } from "./provider-errors.ts";
import { createSelectorDrivenProvider } from "./selector-driven-provider.ts";

const CHATGPT_PROVIDER_ID = "chatgpt";

// The Record type makes a missing adapter a compile error.
const PROVIDER_ADAPTERS: Record<BridgeProviderId, BrowserProvider> = {
  chatgpt: chatGptProvider,
  gemini: geminiProvider,
  claude: createSelectorDrivenProvider("claude"),
  deepseek: createSelectorDrivenProvider("deepseek"),
  grok: createSelectorDrivenProvider("grok"),
  perplexity: createSelectorDrivenProvider("perplexity"),
  flow: flowProvider,
  duck: createSelectorDrivenProvider("duck"),
  arena: arenaProvider,
  design: designProvider,
};

const isBridgeProviderId = (providerId: string): providerId is BridgeProviderId => {
  const providerIdList: readonly string[] = PROVIDER_IDS;
  return providerIdList.includes(providerId);
};

export const readProviderIdFrom = (unparsedProviderId: string | undefined): BridgeProviderId => {
  const isProviderIdMissing = unparsedProviderId == null;
  if (isProviderIdMissing) return DEFAULT_PROVIDER;

  const providerId = unparsedProviderId.trim();

  const isProviderIdEmpty = providerId.length === 0;
  if (isProviderIdEmpty) return DEFAULT_PROVIDER;

  if (isBridgeProviderId(providerId)) return providerId;

  throw createUnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
};

export const readProvider = (unparsedProviderId: string | undefined): BrowserProvider => {
  return PROVIDER_ADAPTERS[readProviderIdFrom(unparsedProviderId)];
};

export const listProviderIdsFrom = (
  unparsedProviderIds: string | undefined,
): BridgeProviderId[] => {
  const isProviderIdsMissing = unparsedProviderIds == null;
  if (isProviderIdsMissing) return [DEFAULT_PROVIDER];

  const isProviderIdsEmpty = unparsedProviderIds.trim().length === 0;
  if (isProviderIdsEmpty) return [DEFAULT_PROVIDER];

  const providerIds = unparsedProviderIds.split(",").map((segment) => readProviderIdFrom(segment));
  return [...new Set(providerIds)];
};

export const readConversationIdForProviderUrl = (request: {
  providerId: string;
  url: string;
}): string | null => {
  const urlProviderId = readProviderIdForUrl(request.url);

  const isUnknownProviderGiven =
    request.providerId !== CHATGPT_PROVIDER_ID || urlProviderId !== CHATGPT_PROVIDER_ID;
  if (isUnknownProviderGiven) return null;

  return readChatGptConversationIdFromUrl(request.url);
};

const isHostOwnedBy = (hostname: string, origin: string): boolean => {
  return hostname === origin || hostname.endsWith(`.${origin}`);
};

const isPathOwnedBy = (pathname: string, pathPrefix: string): boolean => {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
};

// The most specific owner wins, so a claude.ai/design tab belongs to Design, not Claude.
export const readProviderIdForUrl = (url: string): BridgeProviderId | undefined => {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return undefined;

  const { hostname, pathname } = new URL(url);
  let ownerProviderId: BridgeProviderId | undefined;
  let ownerPathLength = -1;
  for (const providerId of PROVIDER_IDS) {
    const { origin, pathPrefix } = PROVIDER_SETTINGS[providerId];

    const isHostNotOwned = !isHostOwnedBy(hostname, origin);
    if (isHostNotOwned) continue;

    let ownedPathLength = 0;

    const hasPathPrefix = pathPrefix != null;
    if (hasPathPrefix) {
      const isPathNotOwned = !isPathOwnedBy(pathname, pathPrefix);
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
