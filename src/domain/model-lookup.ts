import type { ModelProfile } from "./model-profile-types.ts";
import { MODEL_PROFILES, UNKNOWN_MODEL_PROFILE } from "./model-profiles.ts";

const cleanModelKey = (modelName: string): string => {
  return modelName
    .trim()
    .toLowerCase()
    .replace(/chatgpt/g, "chatgpt ")
    .replace(/[^a-z0-9.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const listModelKeys = (profile: ModelProfile): string[] => {
  const keys = [profile.id, profile.label, ...profile.aliases];
  return keys.map(cleanModelKey);
};

export const findModelProfile = (modelName: string | undefined): ModelProfile => {
  const isModelNameMissing = modelName === undefined;
  if (isModelNameMissing) return UNKNOWN_MODEL_PROFILE;

  const trimmedName = modelName.trim();
  const isTrimmedNameEmpty = trimmedName === "";
  if (isTrimmedNameEmpty) return UNKNOWN_MODEL_PROFILE;

  const normalizedKey = cleanModelKey(trimmedName);
  const isUnknownModelKey = listModelKeys(UNKNOWN_MODEL_PROFILE).includes(normalizedKey);
  if (isUnknownModelKey) {
    return UNKNOWN_MODEL_PROFILE;
  }

  for (const profile of MODEL_PROFILES) {
    const hasModelKey = listModelKeys(profile).includes(normalizedKey);
    if (hasModelKey) return profile;
  }

  return { ...UNKNOWN_MODEL_PROFILE, label: trimmedName };
};

export const listModelProfiles = (): ModelProfile[] => {
  return [...MODEL_PROFILES];
};
