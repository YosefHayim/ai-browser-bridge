import { MODEL_PROFILES, UNKNOWN_MODEL_PROFILE } from "./modelProfiles.ts";
import type { ModelProfile } from "./modelProfileTypes.ts";

const normalizeModelKey = (modelName: string): string => {
  return modelName
    .trim()
    .toLowerCase()
    .replace(/chatgpt/g, "chatgpt ")
    .replace(/[^a-z0-9.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const modelKeys = (profile: ModelProfile): string[] => {
  const keys = [profile.id, profile.label, ...profile.aliases];
  return keys.map(normalizeModelKey);
};

export const findModelProfile = (modelName: string | undefined): ModelProfile => {
  if (modelName === undefined) return UNKNOWN_MODEL_PROFILE;

  const trimmedName = modelName.trim();
  if (trimmedName === "") return UNKNOWN_MODEL_PROFILE;

  const normalizedKey = normalizeModelKey(trimmedName);
  if (modelKeys(UNKNOWN_MODEL_PROFILE).includes(normalizedKey)) {
    return UNKNOWN_MODEL_PROFILE;
  }

  for (const profile of MODEL_PROFILES) {
    if (modelKeys(profile).includes(normalizedKey)) return profile;
  }

  return { ...UNKNOWN_MODEL_PROFILE, label: trimmedName };
};

export const listModelProfiles = (): ModelProfile[] => {
  return [...MODEL_PROFILES];
};
