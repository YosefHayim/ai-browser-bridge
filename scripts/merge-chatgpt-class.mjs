#!/usr/bin/env node
/**
 * Merges all chatgpt/*.ts into chatgpt-page.class.ts:
 * one file, file-level helpers, one exported ChatGptPage class.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const CHATGPT_DIR = join(import.meta.dirname, "..", "src/features/providers/chatgpt");
const OUT = join(CHATGPT_DIR, "chatgpt-page.class.ts");

const SKIP = new Set(["chatgpt-page.class.ts", "chatgpt-page.ts"]);

const PUBLIC_METHODS = new Set([
  "assertSignedIn", "injectPrompt", "waitForResponse", "captureLastResponse",
  "countAssistantResponses", "captureAllMessages", "readSidebarConversations",
  "navigateToConversation", "newConversation", "detectCurrentModel",
  "listAvailableModels", "selectModel", "rewindLastUserPrompt", "stopGenerating",
  "attachFilesToPrompt", "isLikelyModelLabel", "isTurnSettled",
  "setupMcpConnectorInChatGpt",
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
  let out = text.replace(/^import\s+.*?from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+type\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  return out;
}

function transformModuleBody(text) {
  let out = text;
  out = out.replace(/^export\s+type\s+/gm, "type ");
  out = out.replace(/^export\s+interface\s+/gm, "interface ");
  out = out.replace(/^export\s+class\s+(\w+)/gm, "class $1");
  out = out.replace(/^export\s+const\s+/gm, "const ");
  out = out.replace(/^export\s+async\s+function\s+/gm, "async function ");
  out = out.replace(/^export\s+function\s+/gm, "function ");
  out = out.replace(/^export\s+\{[\s\S]*?\}\s*;?\s*$/gm, "");
  out = out.replace(/^type\s+\{[^}]*\}\s+from\s+.*?;\s*$/gm, "");
  return out;
}

const files = await walk(CHATGPT_DIR);
const chunks = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  const rel = relative(CHATGPT_DIR, file);
  let body = stripImports(text);
  body = transformModuleBody(body);
  if (!body.trim()) continue;
  chunks.push(`// --- ${rel} ---\n${body}`);
}

const classMethods = [...PUBLIC_METHODS].map((name) => {
  if (name === "setupMcpConnectorInChatGpt") {
    return `  /** Set up the ChatGPT MCP connector in Developer Mode. */\n  async setupMcpConnector(page: Page, url: string, options?: ConnectorSetupOptions): Promise<ConnectorSetupResult> {\n    return setupMcpConnectorInChatGpt(page, url, options);\n  }`;
  }
  const sig = name === "waitForResponse"
    ? "page: Page, options?: number | ResponseWaitOptions"
    : name === "injectPrompt"
      ? "page: Page, text: string"
      : name === "selectModel"
        ? "page: Page, query: string"
        : name === "rewindLastUserPrompt"
          ? "page: Page, replacement?: string"
          : name === "stopGenerating"
            ? "page: Page, timeout?: number"
            : name === "attachFilesToPrompt"
              ? "page: Page, paths: string[]"
              : name === "isLikelyModelLabel"
                ? "value: string"
                : name === "setupMcpConnectorInChatGpt"
                  ? "page: Page, url: string, options?: ConnectorSetupOptions"
                  : name === "navigateToConversation"
                    ? "page: Page, url: string"
                    : "page: Page";
  const ret = name === "isLikelyModelLabel" ? "boolean"
    : name === "stopGenerating" ? "Promise<boolean>"
      : name === "isTurnSettled" ? "boolean"
        : name.includes("capture") || name.includes("read") || name.includes("list") || name.includes("detect") || name.includes("select") ? "Promise<unknown>"
          : "Promise<void>";
  if (name === "isTurnSettled") {
    return `  /** Whether a response turn has settled. */\n  isTurnSettled(state: { hasText: boolean; isTransientText: boolean; streaming: boolean; stableForMs: number }): boolean {\n    return isTurnSettled(state);\n  }`;
  }
  return `  /** BrowserProvider: ${name}. */\n  async ${name}(${sig}): ${ret} {\n    return ${name}(page as Page${name === "injectPrompt" ? ", text" : name === "selectModel" ? ", query" : name === "rewindLastUserPrompt" ? ", replacement" : name === "stopGenerating" ? ", timeout" : name === "attachFilesToPrompt" ? ", paths" : name === "navigateToConversation" ? ", url" : name === "setupMcpConnectorInChatGpt" ? ", url, options" : ""});\n  }`;
}).filter((m) => !m.includes("setupMcpConnectorInChatGpt"));

const header = `import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "../../domain/types.ts";
import type { BrowserProvider, ResponseWaitOptions } from "../browser-provider.types.ts";

/** Thrown when ChatGPT shows the unauthenticated guest shell. */
export class GuestSessionError extends Error {
  constructor() {
    super(
      "ChatGPT is not signed in. "
        + "This is the bridge's isolated Chrome — not your daily browser. "
        + "Click Log in in that window, complete sign-in, leave it open, then run again.",
    );
    this.name = "GuestSessionError";
  }
}

`;

const classBlock = `
/** ChatGPT web UI automation — prompt, response, model, connector, attachments. */
export class ChatGptPage implements BrowserProvider {
  readonly id = "chatgpt" as const;
  readonly origin = "chatgpt.com";
  readonly defaultUrl = "https://chatgpt.com";
  readonly defaultModel = "ChatGPT";
  readonly displayName = "ChatGPT";
  readonly composerSelector = '#prompt-textarea, [contenteditable="true"]';
  readonly supportsMcpConnector = true;

${classMethods.join("\n\n")}
}
`;

const output = header + chunks.join("\n\n") + classBlock;
await writeFile(OUT, output);
console.log(`Wrote ${OUT} (${output.split("\n").length} lines) from ${files.length} files`);
