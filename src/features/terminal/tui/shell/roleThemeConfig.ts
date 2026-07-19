import type { Message } from "@/features/domain";

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

/**
 * Returns the terminal theme for a message role.
 *
 * @param role - Role value.
 * @returns The `getMessageRoleTheme` result.
 * @example
 * ```ts
 * const result = getMessageRoleTheme(role);
 * ```
 */
export const getMessageRoleTheme = (role: Message["role"]): MessageRoleTheme => {
  return MESSAGE_ROLE_THEMES[role];
};

/**
 * Returns true when a free-form prompt should be wrapped with project instructions.
 *
 * @param input - Input values for the operation.
 * @returns The `shouldAutoWrapProjectPrompt` result.
 * @example
 * ```ts
 * const result = shouldAutoWrapProjectPrompt(input);
 * ```
 */
export const shouldAutoWrapProjectPrompt = (input: string): boolean => {
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
};
