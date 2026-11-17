export const ROUNDED_CARD_SELECTOR = "div.rounded-xl";

export const OPTION_ROLE_SELECTOR = '[role="option"]';

export const PROSE_SELECTOR = ".prose";

export const ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS = 5_000;

export const ARENA_SETTLE_MILLISECONDS = 600;

export const MODE_SWITCH_SETTLE_MILLISECONDS = 800;

export const ARENA_CHECK_TIMEOUT_MILLISECONDS = 3_000;

export const ARENA_QUICK_SETTLE_MILLISECONDS = 400;

export const millisecondsPerSecond = 1000;

export const minimumReplyWaitMilliseconds = 1000;

export const ARENA_CLICK_TIMEOUT_MILLISECONDS = 4_000;

export const streamCheckIntervalMilliseconds = 500;

export const modelSearchSettleMilliseconds = 500;

export const WAIT_TIMEOUT_MILLISECONDS = 15_000;

export const SELECTORS = {
  composer:
    'textarea[name="message"], [contenteditable="true"][role="textbox"], [contenteditable="true"]',
  send: 'button[aria-label="Send message"]',
  // Battle / Direct assistant prose lives in option cards; user bubble is raised/self-end.
  assistant: "div.rounded-xl .prose",
  assistantFallback: PROSE_SELECTOR,
  user: ".bg-surface-raised .prose, .self-end .prose",
  newChat: 'a[href="/code"], a[href$="/code"], a[href*="/direct"], a[href*="/agent"]',
  sidebarItem: 'a[href*="/c/"]',
  // Mode combobox shows Battle Mode / Direct / … (hidden + visible clones exist).
  modeTrigger: 'button[role="combobox"]',
  modeOption: OPTION_ROLE_SELECTOR,
  // Model trigger is a plain button labeled Max / glm-5.1 / … (not the mode combobox).
  modelSearch: 'input[placeholder="Search models"]',
  modelOption: OPTION_ROLE_SELECTOR,
  attach: 'input[type="file"]',
} as const;

export const MODEL_NAME_RE =
  /^(Max|gemini|glm|qwen|claude|gpt|kimi|minimax|deepseek|llama|mistral|sonar|o[13]|codex|flash|sonnet|opus|haiku)/i;
