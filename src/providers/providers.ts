import type { Page } from "playwright";
import { DEFAULT_PROVIDER } from "@/app-defaults.ts";
import { type BridgeProviderId, PROVIDER_IDS, PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { ArenaProvider, arenaProfile } from "@/providers/arena/arena-page.ts";
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

  const isUnknownProviderGiven =
    request.providerId !== CHATGPT_PROVIDER_ID || urlProviderId !== CHATGPT_PROVIDER_ID;
  if (isUnknownProviderGiven) return null;

  return readChatGptConversationIdFromUrl(request.url);
}

function isHostOwnedBy(hostname: string, origin: string): boolean {
  return hostname === origin || hostname.endsWith(`.${origin}`);
}

function isPathOwnedBy(pathname: string, pathPrefix: string): boolean {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

// The most specific owner wins, so a claude.ai/design tab belongs to Design, not Claude.
export function readProviderIdForUrl(url: string): BridgeProviderId | undefined {
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
}
