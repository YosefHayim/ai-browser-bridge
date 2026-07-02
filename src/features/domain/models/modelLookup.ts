import type { ModelProfile } from "./modelProfileTypes.ts";
import { MODEL_PROFILES, UNKNOWN_MODEL_PROFILE } from "./modelProfiles.ts";

interface NormalizeKeyInput {
  /** Raw model name or alias from the UI or config. */
  value: string;
}

/** Normalize a model name for alias lookup. */
function normalizeModelKey(input: NormalizeKeyInput): string {
  return input.value
    .trim()
    .toLowerCase()
    .replace(/chatgpt/g, "chatgpt ")
    .replace(/[^a-z0-9.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ModelKeysInput {
  /** Profile whose id, label, and aliases become lookup keys. */
  profile: ModelProfile;
}

/** Build normalized lookup keys for a profile. */
function modelKeys(input: ModelKeysInput): string[] {
  const keys = [input.profile.id, input.profile.label, ...input.profile.aliases];
  return keys.map((value) => normalizeModelKey({ value }));
}

/** Resolve a model profile from a browser label or config alias. */
export function findModelProfile(modelName: string | undefined): ModelProfile {
  if (!modelName?.trim()) return UNKNOWN_MODEL_PROFILE;

  const query = normalizeModelKey({ value: modelName });
  if (modelKeys({ profile: UNKNOWN_MODEL_PROFILE }).includes(query)) {
    return UNKNOWN_MODEL_PROFILE;
  }

  for (const profile of MODEL_PROFILES) {
    if (modelKeys({ profile }).includes(query)) return profile;
  }

  return { ...UNKNOWN_MODEL_PROFILE, label: modelName.trim() };
}

/** Return a copy of all registered model profiles. */
export function listModelProfiles(): ModelProfile[] {
  return [...MODEL_PROFILES];
}
