import type { Message } from "@/domain/message-types.ts";

const ROLE_FOREGROUND_COLOR = "white";

export type MessageRoleTheme = {
  color: string;
  backgroundColor: string;
  label: "You" | "ChatGPT";
  prefix: ">" | "<";
};

export const readMessageRoleTheme = (role: Message["role"]): MessageRoleTheme => {
  const messageRoleThemes = {
    user: {
      color: ROLE_FOREGROUND_COLOR,
      backgroundColor: "blue",
      label: "You",
      prefix: ">",
    },
    assistant: {
      color: ROLE_FOREGROUND_COLOR,
      backgroundColor: "blackBright",
      label: "ChatGPT",
      prefix: "<",
    },
  } satisfies Record<Message["role"], MessageRoleTheme>;

  return messageRoleThemes[role];
};

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
