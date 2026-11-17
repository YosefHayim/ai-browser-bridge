import type { ReplyWaitSettings } from "@/providers/engine/browser-provider.ts";

export interface ParsedWaitSettings {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}

interface TurnSettlement {
  hasText: boolean;
  isTransientText: boolean;
  streaming: boolean;
  stableForMilliseconds: number;
}

export function cleanVisibleCopy(visibleCopy: string): string {
  // Turns every non-breaking space into a plain space.
  const plainSpaces = visibleCopy.replace(/ /g, " ");
  // Squeezes every run of spaces, tabs and new lines into one space.
  const singleSpaced = plainSpaces.replace(/\s+/g, " ");
  return singleSpaced.trim();
}

export function stripGeminiReplyHeading(reply: string): string {
  // Cuts the "Gemini said" heading Google puts in front of a reply.
  return reply.replace(/^Gemini said\s*/i, "").trim();
}

export function isLikelyModelLabel(label: string): boolean {
  // Finds a whole Gemini model word anywhere in the label, ignoring case.
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(label);
}

export function readModelId(label: string): string {
  // Turns every run of spaces into one hyphen.
  return label.toLowerCase().replace(/\s+/g, "-");
}

export function readConversationLink(href: string, title: string) {
  const isAbsoluteHref = href.startsWith("http");
  const url = isAbsoluteHref ? href : `https://gemini.google.com${href}`;
  const pathSegment = href.split("/").filter(Boolean).pop();
  const isPathSegmentMissing = pathSegment == null;
  const id = isPathSegmentMissing ? href : pathSegment;

  return { id, title, url };
}

export function parseWaitSettings(waitSettings: number | ReplyWaitSettings): ParsedWaitSettings {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return { timeout: waitSettings };

  const defaultTimeoutMilliseconds = 300_000;
  const timeout = waitSettings.timeout ?? defaultTimeoutMilliseconds;
  const previousLastAssistantReply = waitSettings.previousLastAssistantText ?? "";

  return {
    timeout,
    previousAssistantCount: waitSettings.previousAssistantCount,
    previousLastAssistantText: cleanVisibleCopy(previousLastAssistantReply),
  };
}

export function readRemainingTimeout(startedAt: number, timeout: number): number {
  const minimumReplyWaitMilliseconds = 1000;
  const elapsedMilliseconds = Date.now() - startedAt;
  return Math.max(minimumReplyWaitMilliseconds, timeout - elapsedMilliseconds);
}

export function isTransientAssistantReply(reply: string): boolean {
  const normalizedReply = reply.trim().toLowerCase();

  const isThinkingOnly = normalizedReply === "thinking";
  if (isThinkingOnly) return true;

  const endsWithThinking = normalizedReply.endsWith(" thinking");
  if (endsWithThinking) return true;

  const endsWithThinkingDots = normalizedReply.endsWith(" thinking...");
  if (endsWithThinkingDots) return true;

  // Finds a reply that is the word thinking plus only dots or spaces.
  return /^thinking[.\s]*$/.test(normalizedReply);
}

export function isTurnSettled(turn: TurnSettlement): boolean {
  const settleQuietMilliseconds = 1_500;

  const isStreaming = turn.streaming;
  if (isStreaming) return false;

  const isStillSettling = turn.stableForMilliseconds < settleQuietMilliseconds;
  if (isStillSettling) return false;

  const isTextMissing = !turn.hasText;
  if (isTextMissing) return false;

  return !turn.isTransientText;
}
