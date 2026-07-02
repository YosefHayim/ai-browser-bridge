import type { Message } from "../../domain/types.ts";

/** Visual theme applied to a terminal message by role. */
export type MessageRoleTheme = {
  /** Foreground ink color. */
  color: string;
  /** Background ink color. */
  backgroundColor: string;
  /** Human-readable role label. */
  label: "You" | "ChatGPT";
  /** Prefix glyph shown before the label. */
  prefix: ">" | "<";
};

const MESSAGE_ROLE_THEMES: Record<Message["role"], MessageRoleTheme> = {
  user: {
    color: "white",
    backgroundColor: "blue",
    label: "You",
    prefix: ">",
  },
  assistant: {
    color: "white",
    backgroundColor: "blackBright",
    label: "ChatGPT",
    prefix: "<",
  },
};

/** Returns the terminal theme for a message role. */
export function getMessageRoleTheme(role: Message["role"]): MessageRoleTheme {
  return MESSAGE_ROLE_THEMES[role];
}

/** Returns true when a free-form prompt should be wrapped with project instructions. */
export function shouldAutoWrapProjectPrompt(input: string): boolean {
  const text = input.toLowerCase();
  if (/@[\w./-]+/.test(input)) return true;

  const hasProjectNoun =
    /\b(repo|repository|project|codebase|local|file|files|folder|folders|structure|src|test|tests|package|readme)\b/.test(
      text,
    );
  const hasAction =
    /\b(check|inspect|read|review|analyze|analyse|find|fix|debug|change|edit|update|add|implement|refactor|optimize|optimise|run|test|verify|qa|explain)\b/.test(
      text,
    );
  return hasProjectNoun && hasAction;
}
