export function isBlankText(
  candidate: string | null | undefined,
): candidate is null | undefined | "" {
  const isMissing = candidate == null;
  if (isMissing) return true;

  return candidate === "";
}

export function isPresentText(candidate: string | null | undefined): candidate is string {
  return !isBlankText(candidate);
}
