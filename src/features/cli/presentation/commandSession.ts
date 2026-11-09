import type { BridgeEngine } from "@/features/bridge/engine/bridgeEngine.ts";

// undefined for absent/invalid so the browser layer uses its default wait.
export const timeoutMsFromSeconds = (seconds: string | undefined): number | undefined => {
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
};

// Ctrl-C / kill: stop generating before tear-down so warm tabs do not burn quota.
export const abortAndExit = async (
  engine: BridgeEngine,
  code: number,
  exit: (code: number) => never,
): Promise<void> => {
  await Promise.allSettled([engine.getBrowserConversation().stopResponse()]);
  await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
  exit(code);
};
