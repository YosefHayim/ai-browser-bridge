import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { screenshotsDir } from "../../../../store/paths.ts";

/** Inputs for capturing desktop and mobile URL screenshots. */
export interface CaptureUrlScreenshotsParams {
  /** HTTP or HTTPS URL to capture. */
  url: string;
  /** Repository root for storing screenshots. */
  repoPath: string;
}

/** Capture full-page desktop + mobile screenshots of a URL into a timestamped dir. */
export async function captureUrlScreenshots(params: CaptureUrlScreenshotsParams): Promise<string[]> {
  const parsed = parseCaptureUrl(params.url);
  const dir = await prepareScreenshotDir(params.repoPath);
  return await captureWithPlaywright({ parsed, dir });
}

/** Validate and normalize a screenshot target URL. */
function parseCaptureUrl(url: string): string {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return parsed.toString();
}

/** Create a timestamped screenshot output directory. */
async function prepareScreenshotDir(repoPath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(screenshotsDir(repoPath), stamp);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Playwright capture inputs. */
interface CaptureWithPlaywrightParams {
  /** Normalized URL string. */
  parsed: string;
  /** Output directory for PNG files. */
  dir: string;
}

/** Launch Playwright and write viewport screenshots. */
async function captureWithPlaywright(params: CaptureWithPlaywrightParams): Promise<string[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const outputs: string[] = [];
  try {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      outputs.push(await captureViewport({ browser, viewport, parsed: params.parsed, dir: params.dir }));
    }
  } finally {
    await browser.close();
  }
  return outputs;
}

/** Single viewport capture inputs. */
interface CaptureViewportParams {
  /** Playwright browser instance. */
  browser: Awaited<ReturnType<Awaited<typeof import("playwright")>["chromium"]["launch"]>>;
  /** Viewport name and dimensions. */
  viewport: { name: string; width: number; height: number };
  /** URL to navigate to. */
  parsed: string;
  /** Output directory. */
  dir: string;
}

/** Capture one viewport screenshot and return its file path. */
async function captureViewport(params: CaptureViewportParams): Promise<string> {
  const page = await params.browser.newPage({
    viewport: { width: params.viewport.width, height: params.viewport.height },
  });
  await page.goto(params.parsed, { waitUntil: "networkidle", timeout: 45_000 });
  const file = await writeViewportScreenshot({ page, viewport: params.viewport, dir: params.dir });
  await page.close();
  return file;
}

/** Write a full-page screenshot for one viewport. */
async function writeViewportScreenshot(input: {
  page: Awaited<ReturnType<CaptureViewportParams["browser"]["newPage"]>>;
  viewport: CaptureViewportParams["viewport"];
  dir: string;
}): Promise<string> {
  const file = join(input.dir, `${input.viewport.name}.png`);
  await input.page.screenshot({ path: file, fullPage: true });
  return file;
}
