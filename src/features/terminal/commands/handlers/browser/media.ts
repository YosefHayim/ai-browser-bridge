import type { CommandContext } from "../../../../domain/types.ts";
import { assertImagePath, resolveRepoFilePath } from "../helpers/repo-file-path.ts";
import { captureUrlScreenshots } from "../helpers/capture-screenshots.ts";

/** Attach a repo image file to ChatGPT. */
export async function handleAttachImage(args: string, ctx: CommandContext): Promise<void> {
  const target = args.trim();
  if (!target) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }
  await attachRepoImage({ target, ctx });
}

/** Resolve, validate, and attach one repo image path. */
async function attachRepoImage(input: { target: string; ctx: CommandContext }): Promise<void> {
  const imagePath = resolveRepoFilePath({ repoRoot: input.ctx.config.repoPath, input: input.target });
  assertImagePath(imagePath);
  if (!input.ctx.orchestrator.attachFiles) {
    console.log("Browser file attachment is not available.");
    return;
  }
  await input.ctx.orchestrator.attachFiles([imagePath]);
  console.log(`Attached image: ${imagePath}`);
}

/** Capture desktop/mobile screenshots for a URL. */
export async function handleScreenshot(args: string, ctx: CommandContext): Promise<void> {
  const url = args.trim();
  if (!url) {
    console.log("Usage: /screenshot <url>");
    return;
  }
  const files = await captureUrlScreenshots({ url, repoPath: ctx.config.repoPath });
  printScreenshotPaths(files);
}

/** Capture UI screenshots and ask ChatGPT to review them. */
export async function handleUiQa(args: string, ctx: CommandContext): Promise<void> {
  const url = args.trim();
  if (!url) {
    console.log("Usage: /ui-qa <url>");
    return;
  }
  const files = await runUiQaCapture({ url, ctx });
  console.log(`UI QA requested with ${files.length} screenshots.`);
}

/** Capture screenshots, attach them, and send the review prompt. */
async function runUiQaCapture(input: { url: string; ctx: CommandContext }): Promise<string[]> {
  const files = await captureUrlScreenshots({ url: input.url, repoPath: input.ctx.config.repoPath });
  if (input.ctx.orchestrator.attachFiles) await input.ctx.orchestrator.attachFiles(files);
  await sendUiQaPrompt({ url: input.url, files, ctx: input.ctx });
  return files;
}

/** Print captured screenshot file paths. */
function printScreenshotPaths(files: string[]): void {
  console.log("Screenshots:");
  for (const file of files) console.log(`  ${file}`);
}

/** Inputs for sending a UI QA review prompt. */
interface SendUiQaPromptParams {
  /** Reviewed page URL. */
  url: string;
  /** Screenshot file paths. */
  files: string[];
  /** Active command context. */
  ctx: CommandContext;
}

/** Send UI QA review instructions with screenshot references. */
async function sendUiQaPrompt(params: SendUiQaPromptParams): Promise<void> {
  await params.ctx.sendMessage([
    `Review the UI at ${params.url}.`,
    "I attached desktop and mobile screenshots when the browser supports file attachment.",
    "Focus on layout breakage, overlapping text, responsive behavior, accessibility, and concrete fixes.",
    "",
    "Screenshot files:",
    ...params.files.map((file) => `- ${file}`),
  ].join("\n"));
}
