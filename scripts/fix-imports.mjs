#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const SEGMENT_REPLACEMENTS = [
  ["types/types.ts", "domain/types.ts"],
  ["core/engine.ts", "bridge/create-engine.factory.ts"],
  ["core/config.ts", "bridge/load-config.ts"],
  ["core/orchestrator.ts", "bridge/orchestrator.ts"],
  ["core/context-counter.ts", "bridge/context-counter.ts"],
  ["core/paths.ts", "store/paths.ts"],
  ["core/session-store.ts", "store/session-store.ts"],
  ["core/checkpoints.ts", "store/checkpoints.ts"],
  ["core/logging.ts", "store/logging.ts"],
  ["core/file-resolver.ts", "store/file-resolver.ts"],
  ["core/permissions.ts", "domain/permissions.ts"],
  ["core/model-catalog.ts", "domain/models.config.ts"],
  ["core/errors.ts", "domain/errors.ts"],
  ["core/hooks.ts", "user-config/hooks.ts"],
  ["core/custom-commands.ts", "user-config/custom-commands.ts"],
  ["core/project-instructions.ts", "user-config/project-instructions.ts"],
  ["browser/provider.ts", "providers/create-provider.factory.ts"],
  ["browser/manager.ts", "providers/chrome/browser-manager.ts"],
  ["browser/chatgpt-page.ts", "providers/chatgpt/chatgpt-page.ts"],
  ["browser/gemini-page.ts", "providers/gemini/gemini-page.ts"],
  ["browser/attachments.ts", "providers/chatgpt/attachments/extract-messages.ts"],
  ["browser/attachment-downloader.ts", "providers/chatgpt/attachments/download-attachment.ts"],
  ["mcp/server.ts", "tools/server.ts"],
  ["mcp/sandbox.ts", "tools/sandbox.ts"],
  ["mcp/tools/", "tools/handlers/"],
  ["cli/headless.ts", "terminal/headless.ts"],
  ["cli/app.tsx", "terminal/tui/App.tsx"],
  ["cli/input-suggestions.ts", "terminal/tui/input-suggestions.ts"],
  ["cli/file-autocomplete.ts", "terminal/tui/file-autocomplete.ts"],
  ["cli/composer-history.ts", "terminal/tui/composer-history.ts"],
  ["cli/shortcuts.ts", "terminal/tui/shortcuts.ts"],
  ["cli/commands/", "terminal/commands/"],
  ["src/core/", "features/bridge/"],
  ["src/browser/", "features/providers/chatgpt/"],
  ["src/mcp/", "features/tools/"],
  ["src/cli/", "features/terminal/"],
  ["src/types/", "features/domain/"],
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && !["node_modules", "dist"].includes(e.name)) files.push(...await walk(p));
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) files.push(p);
  }
  return files;
}

function fixContent(text) {
  let next = text;
  for (const [from, to] of SEGMENT_REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  // Fix double features/features from src/core mapping
  next = next.replace(/features\/bridge\/paths\.ts/g, "features/store/paths.ts");
  next = next.replace(/features\/bridge\/session-store\.ts/g, "features/store/session-store.ts");
  next = next.replace(/features\/bridge\/checkpoints\.ts/g, "features/store/checkpoints.ts");
  next = next.replace(/features\/bridge\/logging\.ts/g, "features/store/logging.ts");
  next = next.replace(/features\/bridge\/file-resolver\.ts/g, "features/store/file-resolver.ts");
  next = next.replace(/features\/bridge\/permissions\.ts/g, "features/domain/permissions.ts");
  next = next.replace(/features\/bridge\/model-catalog\.ts/g, "features/domain/models.config.ts");
  next = next.replace(/features\/bridge\/errors\.ts/g, "features/domain/errors.ts");
  next = next.replace(/features\/bridge\/hooks\.ts/g, "features/user-config/hooks.ts");
  next = next.replace(/features\/bridge\/custom-commands\.ts/g, "features/user-config/custom-commands.ts");
  next = next.replace(/features\/bridge\/project-instructions\.ts/g, "features/user-config/project-instructions.ts");
  next = next.replace(/from "\.\.\/domain\/errors\.ts"/g, 'from "../../../domain/errors.ts"');
  // attachments folder wrong relative paths - fix after segment replace
  next = next.replace(
    /from "\.\.\/features\/providers\/chatgpt\/attachments\/extract-messages\.ts"/g,
    'from "./extract-messages.ts"',
  );
  return next;
}

let count = 0;
for (const dir of [join(ROOT, "src"), join(ROOT, "tests"), join(ROOT, "bin")]) {
  try {
    for (const file of await walk(dir)) {
      const text = await readFile(file, "utf8");
      const next = fixContent(text);
      if (next !== text) {
        await writeFile(file, next);
        count++;
      }
    }
  } catch {
    // bin may not exist
  }
}
console.log(`fix-imports v2: updated ${count} files`);
