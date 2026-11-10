import type { Message } from "@/domain/message-types.ts";

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

export type MessageRoleTheme = {
  color: string;
  backgroundColor: string;
  label: "You" | "ChatGPT";
  prefix: ">" | "<";
};

export const readMessageRoleTheme = (role: Message["role"]): MessageRoleTheme => {
  return MESSAGE_ROLE_THEMES[role];
};

/** True when a free-form prompt should be wrapped with project instructions. */
export const canAutoWrapProjectPrompt = (prompt: string): boolean => {
  const lowerCasePrompt = prompt.toLowerCase();

  const hasMention = /@[\w./-]+/.test(prompt);
  if (hasMention) return true;

  const hasProjectNoun =
    /\b(repo|repository|project|codebase|local|file|files|folder|folders|structure|src|test|tests|package|readme)\b/.test(
      lowerCasePrompt,
    );
  const hasAction =
    /\b(check|inspect|read|review|analyze|analyse|find|fix|debug|change|edit|update|add|implement|refactor|optimize|optimise|run|test|verify|qa|explain)\b/.test(
      lowerCasePrompt,
    );
  return hasProjectNoun && hasAction;
};
