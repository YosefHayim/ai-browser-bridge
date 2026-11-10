import type { ModelProfile } from "./model-profile-types.ts";
import { OPENAI_GPT_5_2_CHAT_URL, OPENAI_GPT_5_2_URL, OPENAI_MODELS_URL } from "./model-urls.ts";

const MODEL_TOKEN_LIMIT = 128_000;

const GPT_5_2_MODEL_ID = "gpt-5.2";

const CHATGPT_PICKER_LABEL_NOTE = "ChatGPT browser UI label observed from the model picker.";

const OPENAI_MAX_GENERATED_TOKENS = 16_384;

const OPENAI_PROVIDER_ID = "openai";

export const OPENAI_GPT5_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt-5.5 pro", "gpt 5.5 pro", "pro", "model-switcher-gpt-5-5-pro"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: OPENAI_MODELS_URL,
    note: CHATGPT_PICKER_LABEL_NOTE,
  },
  {
    id: "gpt-5.5-thinking",
    label: "GPT-5.5 Thinking",
    provider: OPENAI_PROVIDER_ID,
    aliases: [
      "gpt-5.5 thinking",
      "gpt 5.5 thinking",
      "thinking",
      "model-switcher-gpt-5-5-thinking",
    ],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: OPENAI_MODELS_URL,
    note: CHATGPT_PICKER_LABEL_NOTE,
  },
  {
    id: "gpt-5.3-instant",
    label: "GPT-5.3 Instant",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt-5.3 instant", "gpt 5.3 instant", "instant", "model-switcher-gpt-5-3"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: OPENAI_MODELS_URL,
    note: CHATGPT_PICKER_LABEL_NOTE,
  },
  {
    id: "gpt-5.2-chat-latest",
    label: "GPT-5.2 Chat",
    provider: OPENAI_PROVIDER_ID,
    aliases: [GPT_5_2_MODEL_ID, "gpt 5.2", "gpt-5.2 chat", "chatgpt gpt-5.2", "gpt-5-2"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: OPENAI_GPT_5_2_CHAT_URL,
    note: "ChatGPT browser model alias, not the larger API flagship context.",
  },
  {
    id: GPT_5_2_MODEL_ID,
    label: "GPT-5.2 API",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["api:gpt-5.2", "gpt-5.2 api", "openai gpt-5.2"],
    contextWindow: 400_000,
    maxOutputTokens: MODEL_TOKEN_LIMIT,
    sourceUrl: OPENAI_GPT_5_2_URL,
  },
  {
    id: "gpt-5.1-chat-latest",
    label: "GPT-5.1 Chat",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt-5.1", "gpt 5.1", "gpt-5.1 chat", "chatgpt gpt-5.1", "gpt-5-1"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-5.1-chat-latest",
  },
  {
    id: "gpt-5-chat-latest",
    label: "GPT-5 Chat",
    provider: OPENAI_PROVIDER_ID,
    aliases: ["gpt-5", "gpt 5", "gpt-5 chat", "chatgpt gpt-5", "gpt-5-0"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: OPENAI_MAX_GENERATED_TOKENS,
    sourceUrl: "https://platform.openai.com/docs/models/gpt-5-chat-latest",
  },
];
