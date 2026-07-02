import type { ModelProfile } from "./modelProfileTypes.ts";
import { ZAI_GLM_5_1_URL, ZAI_MODELS_URL } from "./modelUrls.ts";

/** Z.AI GLM model profiles. */
export const ZAI_MODEL_PROFILES: ModelProfile[] = [
  {
    id: "glm-5.1",
    label: "GLM-5.1",
    provider: "zai",
    aliases: ["z.ai", "zai", "glm", "glm-5.1", "glm 5.1"],
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    sourceUrl: ZAI_GLM_5_1_URL,
  },
  {
    id: "glm-5",
    label: "GLM-5",
    provider: "zai",
    aliases: ["glm-5", "glm 5"],
    contextWindow: 200_000,
    sourceUrl: ZAI_MODELS_URL,
  },
  {
    id: "glm-4.5",
    label: "GLM-4.5",
    provider: "zai",
    aliases: ["glm-4.5", "glm 4.5", "glm-4.5-air", "glm 4.5 air"],
    contextWindow: 128_000,
    maxOutputTokens: 96_000,
    sourceUrl: "https://docs.z.ai/guides/llm/glm-4.5",
  },
];
