import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CommandSession } from "@/command-types.ts";
import { readScreenshotsDirectory } from "@/repo-files/paths.ts";
import { NEWLINE } from "@/terminal/cli/cli-text.ts";
import { assertImagePath, createRepositoryFilePath } from "@/terminal/cli/repository-file-paths.ts";

type CaptureUrlScreenshotsParameters = {
  url: string;
  repoPath: string;
};

async function captureUrlScreenshots(
  parameters: CaptureUrlScreenshotsParameters,
): Promise<string[]> {
  const parsed = parseCaptureUrl(parameters.url);
  const dir = await prepareScreenshotDir(parameters.repoPath);
  return await captureWithPlaywright({ parsed, dir });
}

function parseCaptureUrl(url: string): string {
  const parsed = new URL(url);

  const isNotHttpProtocol = !["http:", "https:"].includes(parsed.protocol);
  if (isNotHttpProtocol) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
}

async function prepareScreenshotDir(repoPath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(readScreenshotsDirectory(repoPath), stamp);
  await mkdir(dir, { recursive: true });
  return dir;
}

type CaptureWithPlaywrightParameters = {
  parsed: string;
  dir: string;
};

async function captureWithPlaywright(
  parameters: CaptureWithPlaywrightParameters,
): Promise<string[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const printouts: string[] = [];

  try {
    const mobileViewportHeight = 844;

    const mobileViewportWidth = 390;

    const desktopViewportHeight = 1000;

    const desktopViewportWidth = 1440;

    const viewports = [
      { name: "desktop", width: desktopViewportWidth, height: desktopViewportHeight },
      { name: "mobile", width: mobileViewportWidth, height: mobileViewportHeight },
    ];
    for (const viewport of viewports) {
      printouts.push(
        await captureViewport({
          browser,
          viewport,
          parsed: parameters.parsed,
          dir: parameters.dir,
        }),
      );
    }
  } finally {
    await browser.close();
  }

  return printouts;
}

type CaptureViewportParameters = {
  browser: Awaited<ReturnType<Awaited<typeof import("playwright")>["chromium"]["launch"]>>;
  viewport: { name: string; width: number; height: number };
  parsed: string;
  dir: string;
};

async function captureViewport(parameters: CaptureViewportParameters): Promise<string> {
  const page = await parameters.browser.newPage({
    viewport: { width: parameters.viewport.width, height: parameters.viewport.height },
  });

  const screenshotNavigationTimeoutMilliseconds = 45_000;

  await page.goto(parameters.parsed, {
    waitUntil: "networkidle",
    timeout: screenshotNavigationTimeoutMilliseconds,
  });

  const file = await writeViewportScreenshot({
    page,
    viewport: parameters.viewport,
    dir: parameters.dir,
  });

  await page.close();

  return file;
}

async function writeViewportScreenshot(details: {
  page: Awaited<ReturnType<CaptureViewportParameters["browser"]["newPage"]>>;
  viewport: CaptureViewportParameters["viewport"];
  dir: string;
}): Promise<string> {
  const file = join(details.dir, `${details.viewport.name}.png`);
  await details.page.screenshot({ path: file, fullPage: true });
  return file;
}

export async function attachImageCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const target = argumentList.trim();

  const isTargetEmpty = !target;
  if (isTargetEmpty) {
    console.log("Usage: /attach-image <repo-relative-image-path>");
    return;
  }

  await attachRepoImage({ target, commandSession: commandSession });
}

async function attachRepoImage(details: {
  target: string;
  commandSession: CommandSession;
}): Promise<void> {
  const imagePath = createRepositoryFilePath({
    repoRoot: details.commandSession.bridgeSettings.repoPath,
    input: details.target,
  });
  assertImagePath(imagePath);

  const { orchestrator } = details.commandSession;
  const attachFilesInBrowser = orchestrator.attachFiles?.bind(orchestrator);
  const isAttachFilesMissing = attachFilesInBrowser == null;

  if (isAttachFilesMissing) {
    console.log("Browser file attachment is not available.");
    return;
  }

  await attachFilesInBrowser([imagePath]);
  console.log(`Attached image: ${imagePath}`);
}

export async function captureScreenshotCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const url = argumentList.trim();

  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /screenshot <url>");
    return;
  }

  const files = await captureUrlScreenshots({
    url,
    repoPath: commandSession.bridgeSettings.repoPath,
  });
  printScreenshotPaths(files);
}

export async function runUiQaCommand(
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> {
  const url = argumentList.trim();

  const isUrlEmpty = !url;
  if (isUrlEmpty) {
    console.log("Usage: /ui-qa <url>");
    return;
  }

  const files = await runUiQaCapture({ url, commandSession: commandSession });
  console.log(`UI QA requested with ${files.length} screenshots.`);
}

async function runUiQaCapture(details: {
  url: string;
  commandSession: CommandSession;
}): Promise<string[]> {
  const files = await captureUrlScreenshots({
    url: details.url,
    repoPath: details.commandSession.bridgeSettings.repoPath,
  });

  await details.commandSession.orchestrator.attachFiles?.(files);

  await sendUiQaPrompt({ url: details.url, files, commandSession: details.commandSession });
  return files;
}

function printScreenshotPaths(files: string[]): void {
  console.log("Screenshots:");
  for (const file of files) console.log(`  ${file}`);
}

type SendUiQaPromptParameters = {
  url: string;
  files: string[];
  commandSession: CommandSession;
};

async function sendUiQaPrompt(parameters: SendUiQaPromptParameters): Promise<void> {
  await parameters.commandSession.sendMessage(
    [
      `Review the UI at ${parameters.url}.`,
      "I attached desktop and mobile screenshots when the browser supports file attachment.",
      "Focus on layout breakage, overlapping text, responsive behavior, accessibility, and concrete fixes.",
      "",
      "Screenshot files:",
      ...parameters.files.map((file) => `- ${file}`),
    ].join(NEWLINE),
  );
}
