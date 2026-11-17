import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/app-defaults.ts";
import type { ReplyWaitSettings } from "@/providers/engine/browser-provider.ts";

export function readReplyWaitSettings(
  waitSettings: number | ReplyWaitSettings | undefined,
): ReplyWaitSettings {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) {
    return { timeout: waitSettings };
  }

  const isWaitMissing = waitSettings == null;
  if (isWaitMissing) {
    return {};
  }

  return waitSettings;
}

export function readWaitTimeoutMilliseconds(waitSettings: ReplyWaitSettings): number {
  const actionTimeoutMilliseconds = 1000;

  return waitSettings.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * actionTimeoutMilliseconds;
}

export function readPreviousAssistantCount(waitSettings: ReplyWaitSettings): number {
  return waitSettings.previousAssistantCount ?? 0;
}

export function readPreviousLastAssistantReply(waitSettings: ReplyWaitSettings): string {
  return waitSettings.previousLastAssistantText ?? "";
}

export function stopControlSelector(stopSelector: string | undefined): string {
  const isStopSelectorMissing = stopSelector == null;
  if (isStopSelectorMissing) {
    return "";
  }

  return stopSelector;
}
