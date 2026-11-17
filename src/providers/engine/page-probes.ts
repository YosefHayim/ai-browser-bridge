export const HTML_PARSED_WAIT = "domcontentloaded";
export const ESCAPE_KEY = "Escape";
export const VISIBLE_WAIT_MODE = "visible";

export const readFirstLine = (lines: string): string => {
  const line = lines.trim().split("\n")[0];

  const isLineMissing = line == null;
  if (isLineMissing) return "";

  return line.trim();
};
