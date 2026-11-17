import type { Page } from "playwright";
import { DEFAULT_PROVIDER } from "@/app-defaults.ts";
import { type BridgeProviderId, PROVIDER_IDS, PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { ArenaProvider, arenaProfile } from "@/providers/arena/arena-provider.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import { ChatGptProvider, chatGptProfile } from "@/providers/chatgpt/page/chatgpt-page.ts";
import { DesignProvider, designProfile } from "@/providers/design/design-page.ts";
import type { BrowserProvider, ProviderProfile } from "@/providers/engine/browser-provider.ts";
import { createUnknownProviderError } from "@/providers/engine/provider-errors.ts";
import { SelectorDrivenProvider } from "@/providers/engine/selector-driven-provider.ts";
import {
  claudeProfile,
  deepseekProfile,
  duckProfile,
  grokProfile,
  perplexityProfile,
} from "@/providers/engine/selector-profiles.ts";
import { FlowProvider, flowProfile } from "@/providers/flow/flow-page.ts";
import { GeminiProvider, geminiProfile } from "@/providers/gemini/gemini-provider.ts";

const CHATGPT_PROVIDER_ID = "chatgpt";

function isBridgeProviderId(providerId: string): providerId is BridgeProviderId {
  const providerIdList: readonly string[] = PROVIDER_IDS;
  return providerIdList.includes(providerId);
}

export function readProviderIdFrom(unparsedProviderId: string | undefined): BridgeProviderId {
  const isProviderIdMissing = unparsedProviderId == null;
  if (isProviderIdMissing) return DEFAULT_PROVIDER;

  const providerId = unparsedProviderId.trim();

  const isProviderIdEmpty = providerId.length === 0;
  if (isProviderIdEmpty) return DEFAULT_PROVIDER;

  if (isBridgeProviderId(providerId)) return providerId;

  throw createUnknownProviderError({ value: providerId, validProviders: PROVIDER_IDS });
}

export function createProvider(providerId: BridgeProviderId, page: Page): BrowserProvider {
  switch (providerId) {
    case "chatgpt":
      return new ChatGptProvider(page);
    case "gemini":
      return new GeminiProvider(page);
    case "claude":
      return new SelectorDrivenProvider(claudeProfile, page);
    case "deepseek":
      return new SelectorDrivenProvider(deepseekProfile, page);
    case "grok":
      return new SelectorDrivenProvider(grokProfile, page);
    case "perplexity":
      return new SelectorDrivenProvider(perplexityProfile, page);
    case "flow":
      return new FlowProvider(page);
    case "duck":
      return new SelectorDrivenProvider(duckProfile, page);
    case "arena":
      return new ArenaProvider(page);
    case "design":
      return new DesignProvider(page);
  }
}

export function readProviderProfile(providerId: BridgeProviderId): ProviderProfile {
  switch (providerId) {
    case "chatgpt":
      return chatGptProfile;
    case "gemini":
      return geminiProfile;
    case "claude":
      return claudeProfile;
    case "deepseek":
      return deepseekProfile;
    case "grok":
      return grokProfile;
    case "perplexity":
      return perplexityProfile;
    case "flow":
      return flowProfile;
    case "duck":
      return duckProfile;
    case "arena":
      return arenaProfile;
    case "design":
      return designProfile;
  }
}

export function listProviderIdsFrom(unparsedProviderIds: string | undefined): BridgeProviderId[] {
  const isProviderIdsMissing = unparsedProviderIds == null;
  if (isProviderIdsMissing) return [DEFAULT_PROVIDER];

  const isProviderIdsEmpty = unparsedProviderIds.trim().length === 0;
  if (isProviderIdsEmpty) return [DEFAULT_PROVIDER];

  const providerIds = unparsedProviderIds.split(",").map((segment) => readProviderIdFrom(segment));
  return [...new Set(providerIds)];
}

export function readConversationIdForProviderUrl(request: {
  providerId: string;
  url: string;
}): string | null {
  const urlProviderId = readProviderIdForUrl(request.url);

  const isRequestNotChatGpt = request.providerId !== CHATGPT_PROVIDER_ID;
  if (isRequestNotChatGpt) return null;

  const isUrlNotChatGpt = urlProviderId !== CHATGPT_PROVIDER_ID;
  if (isUrlNotChatGpt) return null;

  return readChatGptConversationIdFromUrl(request.url);
}

function isHostOwnedBy(hostname: string, origin: string): boolean {
  const isExactHost = hostname === origin;
  if (isExactHost) return true;

  return hostname.endsWith(`.${origin}`);
}

function isPathOwnedBy(pathname: string, pathPrefix: string): boolean {
  const isExactPath = pathname === pathPrefix;
  if (isExactPath) return true;

  return pathname.startsWith(`${pathPrefix}/`);
}

function readOwnedPathLength(pathname: string, pathPrefix: string | undefined): number | null {
  if (pathPrefix == null) return 0;

  const isPathNotOwned = !isPathOwnedBy(pathname, pathPrefix);
  if (isPathNotOwned) return null;

  return pathPrefix.length;
}

// The most specific owner wins, so a claude.ai/design tab belongs to Design, not Claude.
export function readProviderIdForUrl(url: string): BridgeProviderId | undefined {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return undefined;

  const { hostname, pathname } = new URL(url);
  const owners = PROVIDER_IDS.flatMap((providerId) => {
    const { origin, pathPrefix } = PROVIDER_SETTINGS[providerId];

    const isHostNotOwned = !isHostOwnedBy(hostname, origin);
    if (isHostNotOwned) return [];

    const ownedPathLength = readOwnedPathLength(pathname, pathPrefix);
    if (ownedPathLength === null) return [];

    return [{ providerId, ownedPathLength }];
  });
  const longestOwner = owners.reduce<(typeof owners)[number] | undefined>(
    (best, owner) => (best && best.ownedPathLength >= owner.ownedPathLength ? best : owner),
    undefined,
  );
  return longestOwner?.providerId;
}
