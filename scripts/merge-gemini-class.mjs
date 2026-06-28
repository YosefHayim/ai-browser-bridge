#!/usr/bin/env node
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const GEMINI_DIR = join(import.meta.dirname, "..", "src/features/providers/gemini");
const OUT = join(GEMINI_DIR, "gemini-page.class.ts");
const SKIP = new Set(["gemini-page.class.ts", "gemini-page.ts"]);

const PUBLIC = new Set([
  "assertSignedIn", "injectPrompt", "waitForResponse", "captureLastResponse",
  "countAssistantResponses", "captureAllMessages", "readSidebarConversations",
  "navigateToConversation", "newConversation", "detectCurrentModel",
  "listAvailableModels", "selectModel", "rewindLastUserPrompt", "stopGenerating",
  "attachFilesToPrompt", "isLikelyModelLabel", "isTurnSettled", "isGuestSession",
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith(".ts") && !SKIP.has(entry.name)) files.push(path);
  }
  return files.sort();
}

function stripImports(text) {
  let out = text.replace(/^import\s+type\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+.*?from\s+.*?;\s*$/gm, "");
  return out;
}

function transform(text) {
  let out = text;
  out = out.replace(/^export\s+type\s+/gm, "type ");
  out = out.replace(/^export\s+interface\s+/gm, "interface ");
  out = out.replace(/^export\s+const\s+/gm, "const ");
  out = out.replace(/^export\s+async\s+function\s+/gm, "async function ");
  out = out.replace(/^export\s+function\s+/gm, "function ");
  out = out.replace(/^export\s+class\s+/gm, "class ");
  out = out.replace(/^export\s+\{[\s\S]*?\}\s*;?\s*$/gm, "");
  return out;
}

const files = await walk(GEMINI_DIR);
const chunks = [];
for (const file of files) {
  const body = transform(stripImports(await readFile(file, "utf8")));
  chunks.push(`// --- ${relative(GEMINI_DIR, file)} ---\n${body}`);
}

const header = `import type { Locator, Page } from "playwright";
import type { ModelOption } from "../../domain/types.ts";
import type { BrowserProvider, ResponseWaitOptions } from "../browser-provider.types.ts";

/** Thrown when Gemini shows the unauthenticated sign-in shell. */
export class GuestSessionError extends Error {
  constructor() {
    super(
      "Gemini is not signed in. "
        + "This is the bridge's isolated Chrome — not your daily browser. "
        + "Click Sign in in that window, complete Google sign-in, leave it open, then run again.",
    );
    this.name = "GuestSessionError";
  }
}

`;

const classBlock = `
export class GeminiPage implements BrowserProvider {
  readonly id = "gemini" as const;
  readonly origin = "gemini.google.com";
  readonly defaultUrl = "https://gemini.google.com/app";
  readonly defaultModel = "Gemini";
  readonly displayName = "Gemini";
  readonly composerSelector = 'div.ql-editor, [contenteditable="true"]';
  readonly supportsMcpConnector = false;

  async assertSignedIn(page: Page): Promise<void> { return assertSignedIn(page); }
  async injectPrompt(page: Page, text: string): Promise<void> { return injectPrompt(page, text); }
  async waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void> { return waitForResponse(page, options); }
  async captureLastResponse(page: Page): Promise<string> { return captureLastResponse(page); }
  async countAssistantResponses(page: Page): Promise<number> { return countAssistantResponses(page); }
  async captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> { return captureAllMessages(page); }
  async readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> { return readSidebarConversations(page); }
  async navigateToConversation(page: Page, url: string): Promise<void> { return navigateToConversation(page, url); }
  async newConversation(page: Page): Promise<void> { return newConversation(page); }
  async detectCurrentModel(page: Page): Promise<string> { return detectCurrentModel(page); }
  async listAvailableModels(page: Page): Promise<ModelOption[]> { return listAvailableModels(page); }
  async selectModel(page: Page, query: string): Promise<string> { return selectModel(page, query); }
  async rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> { return rewindLastUserPrompt(page, replacement); }
  async stopGenerating(page: Page, timeout?: number): Promise<boolean> { return stopGenerating(page, timeout); }
  async attachFilesToPrompt(page: Page, paths: string[]): Promise<void> { return attachFilesToPrompt(page, paths); }
  isLikelyModelLabel(value: string): boolean { return isLikelyModelLabel(value); }
}
`;

await writeFile(OUT, header + chunks.join("\n\n") + classBlock);
console.log(`Wrote ${OUT}`);
