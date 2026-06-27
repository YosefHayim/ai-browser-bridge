import { parseFrontmatter } from "./custom-commands.frontmatter.ts";
import { trimOuterBlankLines } from "./custom-commands.text.helpers.ts";
import type { ParsedCommandFile } from "./custom-commands.types.ts";

/** Parse markdown with YAML-like frontmatter into metadata and body. */
export function parseFrontmatterMarkdown(normalized: string): ParsedCommandFile {
  const lines = normalized.split("\n");
  const endIndex = findFrontmatterEnd(lines);
  if (endIndex === -1) return { metadata: {}, body: trimOuterBlankLines(normalized) };
  return {
    metadata: parseFrontmatter(lines.slice(1, endIndex)),
    body: trimOuterBlankLines(lines.slice(endIndex + 1).join("\n")),
  };
}

function findFrontmatterEnd(lines: string[]): number {
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") return index;
  }
  return -1;
}
