export interface ReplyParts {
  /** The "Thought for 12s" line some chat apps show above the answer, or null. */
  thoughtLine: string | null;
  /** The answer without the app name line and the thought line. */
  answerText: string;
  /** The first paragraphs of the answer, which the window types out. */
  paragraphs: string[];
}

const SHOWN_PARAGRAPH_COUNT = 3;

/** Splits a recorded reply for display. The recorded text itself is never changed. */
export function readReplyParts(replyText: string, providerLabel: string): ReplyParts {
  const lines = replyText.split("\n");
  const hasLabelLine = lines[0]?.trim() === providerLabel;
  if (hasLabelLine) lines.shift();

  const thoughtMatch = lines[0]?.match(/^Thought for .+$/);
  const thoughtLine = thoughtMatch == null ? null : thoughtMatch[0];
  if (thoughtLine != null) lines.shift();

  const answerText = lines.join("\n").trim();
  const paragraphs = answerText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .slice(0, SHOWN_PARAGRAPH_COUNT);

  return { thoughtLine, answerText, paragraphs };
}
