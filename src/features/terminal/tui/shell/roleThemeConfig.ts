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
  color: string;
  backgroundColor: string;
  label: "You" | "ChatGPT";
  prefix: ">" | "<";
};

/** Theme for a message role in the Ink message pane. */
export const messageRoleTheme = (role: Message["role"]): MessageRoleTheme => {
  return MESSAGE_ROLE_THEMES[role];
};

/** True when a free-form prompt should be wrapped with project instructions. */
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
