import type { ModelProfile } from "./model-profile-types.ts";
import { ZAI_GLM_5_1_URL, ZAI_MODELS_URL } from "./model-urls.ts";

const MODEL_TOKEN_LIMIT = 128_000;

const ZAI_TOKEN_WINDOW = 200_000;

const GLM_4_5_MODEL_ID = "glm-4.5";

const GLM_5_MODEL_ID = "glm-5";

const GLM_5_1_MODEL_ID = "glm-5.1";

const ZAI_PROVIDER_ID = "zai";

export const ZAI_MODEL_PROFILES: ModelProfile[] = [
  {
    id: GLM_5_1_MODEL_ID,
    label: "GLM-5.1",
    provider: ZAI_PROVIDER_ID,
    aliases: ["z.ai", ZAI_PROVIDER_ID, "glm", GLM_5_1_MODEL_ID, "glm 5.1"],
    contextWindow: ZAI_TOKEN_WINDOW,
    maxOutputTokens: MODEL_TOKEN_LIMIT,
    sourceUrl: ZAI_GLM_5_1_URL,
  },
  {
    id: GLM_5_MODEL_ID,
    label: "GLM-5",
    provider: ZAI_PROVIDER_ID,
    aliases: [GLM_5_MODEL_ID, "glm 5"],
    contextWindow: ZAI_TOKEN_WINDOW,
    sourceUrl: ZAI_MODELS_URL,
  },
  {
    id: GLM_4_5_MODEL_ID,
    label: "GLM-4.5",
    provider: ZAI_PROVIDER_ID,
    aliases: [GLM_4_5_MODEL_ID, "glm 4.5", "glm-4.5-air", "glm 4.5 air"],
    contextWindow: MODEL_TOKEN_LIMIT,
    maxOutputTokens: 96_000,
    sourceUrl: "https://docs.z.ai/guides/llm/glm-4.5",
  },
];
