import { MODEL_PROFILES, UNKNOWN_MODEL_PROFILE } from "./modelProfiles.ts";
import type { ModelProfile } from "./modelProfileTypes.ts";

/** Normalize a model name for alias lookup. */
const normalizeModelKey = (modelName: string): string => {
  return modelName
    .trim()
    .toLowerCase()
    .replace(/chatgpt/g, "chatgpt ")
    .replace(/[^a-z0-9.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/** Normalized lookup keys for a profile (id, label, aliases). */
const modelKeys = (profile: ModelProfile): string[] => {
  const keys = [profile.id, profile.label, ...profile.aliases];
  return keys.map(normalizeModelKey);
};

/** Resolve a model profile from a browser label or config alias. */
export const findModelProfile = (modelName: string | undefined): ModelProfile => {
  if (modelName === undefined) return UNKNOWN_MODEL_PROFILE;

  const trimmedName = modelName.trim();
  if (trimmedName === "") return UNKNOWN_MODEL_PROFILE;

  const query = normalizeModelKey(trimmedName);
  if (modelKeys(UNKNOWN_MODEL_PROFILE).includes(query)) {
    return UNKNOWN_MODEL_PROFILE;
  }

  for (const profile of MODEL_PROFILES) {
    if (modelKeys(profile).includes(query)) return profile;
  }

  return { ...UNKNOWN_MODEL_PROFILE, label: trimmedName };
};

/** Return a shallow copy of all registered model profiles. */
export const listModelProfiles = (): ModelProfile[] => {
  return [...MODEL_PROFILES];
};
