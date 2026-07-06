export { DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
export type { BridgeProviderId } from "@/config";
export type { BrowserProvider, ResponseWaitOptions } from "./browserProviderTypes.ts";
export { UnknownProviderError } from "./unknownProviderError.ts";

import {
  type BridgeProviderId,
  DEFAULT_PROVIDER,
  PROVIDER_ALIASES,
  PROVIDER_CONFIG,
  PROVIDER_IDS,
} from "@/config";
import type { BrowserProvider } from "./browserProviderTypes.ts";
import { CHATGPT_PROVIDER } from "./chatgpt/index.ts";
import { setupMcpConnectorInClaude } from "./claude/index.ts";
import { GEMINI_PROVIDER } from "./gemini/index.ts";
import { type ConnectorSetupFn, GenericWebChatPage } from "./genericWebChatPage.ts";
import { UnknownProviderError } from "./unknownProviderError.ts";

/** Build a generic selector-driven adapter, optionally with a bespoke connector flow. */
const genericProvider = (
  id: BridgeProviderId,
  connectorSetup?: ConnectorSetupFn,
): BrowserProvider => {
  return new GenericWebChatPage({ id, ...PROVIDER_CONFIG[id] }, connectorSetup);
};

/**
 * Browser adapters keyed by id. Metadata + selectors come from `@/config` (the SSOT);
 * this binds each id to behavior — a bespoke `*Page` class for ChatGPT/Gemini, the
 * generic adapter otherwise. The `Record<BridgeProviderId, …>` annotation makes a
 * missing adapter a compile error.
 */
export const PROVIDERS: Record<BridgeProviderId, BrowserProvider> = {
  chatgpt: CHATGPT_PROVIDER,
  gemini: GEMINI_PROVIDER,
  claude: genericProvider("claude", setupMcpConnectorInClaude),
  deepseek: genericProvider("deepseek"),
  grok: genericProvider("grok"),
  perplexity: genericProvider("perplexity"),
};

const unwrapProvider = (input: unknown): string | undefined => {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const record = input as { value?: unknown; id?: unknown };
    const raw = record.value ?? record.id;
    if (typeof raw === "string") return raw;
  }
  return undefined;
};

/**
 * Normalize a CLI/config provider string to a supported id.
 * Empty or absent → the default provider; an explicit unknown value throws
 * {@link UnknownProviderError} listing the valid ids (never silently coerced).
 *
 * @param input - Input values for the operation.
 * @returns The `normalizeProvider` result.
 * @example
 * ```ts
 * const result = normalizeProvider(input);
 * ```
 */
export const normalizeProvider = (
  input: string | { value?: string } | { id?: string } | undefined,
): BridgeProviderId => {
  const value = unwrapProvider(input)?.trim().toLowerCase();
  if (!value) return DEFAULT_PROVIDER;
  const resolved = PROVIDER_ALIASES[value] ?? value;
  if (resolved in PROVIDER_CONFIG) return resolved as BridgeProviderId;
  throw new UnknownProviderError(value, PROVIDER_IDS);
};

/**
 * Resolve the browser adapter for a provider id/alias.
 *
 * @param input - Input values for the operation.
 * @returns The `getBrowserProvider` result.
 * @example
 * ```ts
 * const result = getBrowserProvider(input);
 * ```
 */
export const getBrowserProvider = (
  input: string | { id?: string } | undefined,
): BrowserProvider => {
  return PROVIDERS[normalizeProvider(input)];
};

/**
 * Parse a `--provider` value into a deduped id list. Accepts a comma-separated list
 * (`claude,deepseek,grok`) for fan-out; empty/absent → the default provider. Each part
 * is normalized, so an unknown provider throws {@link UnknownProviderError}.
 *
 * @param spec - Spec value.
 * @returns The `parseProviderList` result.
 * @example
 * ```ts
 * const result = parseProviderList(spec);
 * ```
 */
export const parseProviderList = (spec: string | undefined): BridgeProviderId[] => {
  if (!spec?.trim()) return [DEFAULT_PROVIDER];
  const ids = spec.split(",").map((part) => normalizeProvider(part));
  return [...new Set(ids)];
};
