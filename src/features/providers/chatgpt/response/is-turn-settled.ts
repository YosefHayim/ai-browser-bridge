import { ASSET_SETTLE_QUIET_MS, SETTLE_QUIET_MS } from "./settle-constants.ts";
import type { TurnSettledState } from "./turn-settled-state.ts";

/**
 * Decide whether the current assistant turn has finished producing output.
 *
 * Pure so the completion policy is unit-testable without a browser.
 */
export function isTurnSettled(state: TurnSettledState): boolean {
  if (state.streaming) return false;
  const requiredQuietMs = state.assetCount > 0 ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;
  if (state.stableForMs < requiredQuietMs) return false;
  return state.assetCount > 0 || (state.hasText && !state.isTransientText);
}
