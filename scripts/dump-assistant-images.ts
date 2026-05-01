/**
 * Diagnostic dump for image-like content in rendered ChatGPT assistant messages.
 *
 * Run with:
 *   pnpm tsx scripts/dump-assistant-images.ts [conversationId]
 */
import { BrowserManager } from "../src/browser/manager.ts";

const DEFAULT_CONVERSATION_ID = "69f21d66-3d9c-8392-8f25-b331d1a922a2";
const INITIAL_RENDER_WAIT_MS = 5_000;
const SCROLL_WAIT_MS = 160;
const FINAL_RENDER_WAIT_MS = 1_000;
const SCROLL_STEP_PX = 700;
const REAL_IMAGE_URL_MARKERS = ["oaiusercontent", "files.oaiusercontent", "sandbox", "blob:"];

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface ElementMatchDump {
  tag: string;
  value: string;
}

interface AssistantImageDump {
  index: number;
  messageId: string;
  textLength: number;
  imgCount: number;
  pictureCount: number;
  sourceCount: number;
  canvasCount: number;
  imgSrcs: string[];
  imgSrcsets: string[];
  sourceSrcsets: string[];
  backgroundImages: string[];
  classImageMatches: ElementMatchDump[];
  testIdImageMatches: ElementMatchDump[];
  figureCount: number;
  imageAttachmentButtonLabels: string[];
}

async function main(): Promise<number> {
  const conversationId = process.argv[2] ?? DEFAULT_CONVERSATION_ID;
  const browser = new BrowserManager();

  try {
    console.log(`[INFO] Connecting to browser for conversation ${conversationId}...`);
    const page = await browser.launch();
    const url = `https://chatgpt.com/c/${conversationId}`;

    console.log(`[INFO] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(INITIAL_RENDER_WAIT_MS);

    console.log("[INFO] Scrolling conversation to trigger lazy-rendered content...");
    await scrollConversationForLazyContent(page);

    console.log("[INFO] Collecting assistant image diagnostics...");
    const dumps = await page.evaluate((): AssistantImageDump[] => {
      const assistantBlocks = Array.from(
        document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
      );

      return assistantBlocks.map((block, blockIndex) => {
        const imgElements = Array.from(block.querySelectorAll<HTMLImageElement>("img"));
        const sourceElements = Array.from(block.querySelectorAll<HTMLSourceElement>("source"));
        const backgroundImages = Array.from(block.querySelectorAll<HTMLElement>("*"))
          .map((element) => element.style.backgroundImage || getComputedStyle(element).backgroundImage)
          .filter((value) => value.length > 0 && value !== "none");

        const classImageMatches = Array.from(block.querySelectorAll<HTMLElement>('[class*="image" i]'))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            value: element.getAttribute("class") ?? "",
          }));
        const testIdImageMatches = Array.from(block.querySelectorAll<HTMLElement>('[data-testid*="image" i]'))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            value: element.getAttribute("data-testid") ?? "",
          }));
        const imageAttachmentButtonLabels = Array.from(block.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
          .map((button) => button.getAttribute("aria-label") ?? "")
          .filter((label) => /image|attachment/i.test(label));

        return {
          index: blockIndex + 1,
          messageId: block.getAttribute("data-message-id") ?? "",
          textLength: block.innerText.length,
          imgCount: imgElements.length,
          pictureCount: block.querySelectorAll("picture").length,
          sourceCount: sourceElements.length,
          canvasCount: block.querySelectorAll("canvas").length,
          imgSrcs: imgElements.map((img) => img.currentSrc || img.src || img.getAttribute("src") || ""),
          imgSrcsets: imgElements
            .map((img) => img.srcset || img.getAttribute("srcset") || "")
            .filter((value) => value.length > 0),
          sourceSrcsets: sourceElements
            .map((source) => source.srcset || source.getAttribute("srcset") || "")
            .filter((value) => value.length > 0),
          backgroundImages,
          classImageMatches,
          testIdImageMatches,
          figureCount: block.querySelectorAll("figure").length,
          imageAttachmentButtonLabels,
        };
      });
    });

    printAssistantDumps(dumps);
    printRealImageUrls(dumps);

    return 0;
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn(`[WARN] Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function scrollConversationForLazyContent(page: Awaited<ReturnType<BrowserManager["launch"]>>): Promise<void> {
  await page.evaluate((): void => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, [role='main'], div, section"))
      .filter((element) => element.scrollHeight > element.clientHeight + 20);
    const assistantBlocks = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    const containingCandidates = candidates.filter((candidate) => {
      return assistantBlocks.some((block) => candidate.contains(block));
    });
    const scrollTarget = containingCandidates.sort((a, b) => {
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    })[0] ?? document.scrollingElement;

    scrollTarget?.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(SCROLL_WAIT_MS);

  let state = await readScrollState(page);
  const maxIterations = Math.max(10, Math.ceil(state.scrollHeight / SCROLL_STEP_PX) + 20);

  for (let index = 0; index < maxIterations; index += 1) {
    const nextTop = Math.min(state.scrollTop + SCROLL_STEP_PX, state.scrollHeight);
    await setScrollTop(page, nextTop);
    await page.waitForTimeout(SCROLL_WAIT_MS);

    const nextState = await readScrollState(page);
    if (nextState.scrollTop === state.scrollTop && nextState.scrollHeight === state.scrollHeight) break;
    state = nextState;
  }

  state = await readScrollState(page);
  const reverseIterations = Math.max(10, Math.ceil(state.scrollHeight / SCROLL_STEP_PX) + 20);

  for (let index = 0; index < reverseIterations; index += 1) {
    const nextTop = Math.max(state.scrollTop - SCROLL_STEP_PX, 0);
    await setScrollTop(page, nextTop);
    await page.waitForTimeout(SCROLL_WAIT_MS);

    const nextState = await readScrollState(page);
    if (nextState.scrollTop === state.scrollTop && nextState.scrollTop === 0) break;
    state = nextState;
  }

  await page.waitForTimeout(FINAL_RENDER_WAIT_MS);
}

async function readScrollState(page: Awaited<ReturnType<BrowserManager["launch"]>>): Promise<ScrollState> {
  return page.evaluate((): ScrollState => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, [role='main'], div, section"))
      .filter((element) => element.scrollHeight > element.clientHeight + 20);
    const assistantBlocks = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    const containingCandidates = candidates.filter((candidate) => {
      return assistantBlocks.some((block) => candidate.contains(block));
    });
    const scrollTarget = containingCandidates.sort((a, b) => {
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    })[0] ?? document.scrollingElement;

    return {
      scrollTop: scrollTarget?.scrollTop ?? 0,
      scrollHeight: scrollTarget?.scrollHeight ?? document.documentElement.scrollHeight,
      clientHeight: scrollTarget?.clientHeight ?? document.documentElement.clientHeight,
    };
  });
}

async function setScrollTop(
  page: Awaited<ReturnType<BrowserManager["launch"]>>,
  scrollTop: number,
): Promise<void> {
  await page.evaluate((targetTop: number): void => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, [role='main'], div, section"))
      .filter((element) => element.scrollHeight > element.clientHeight + 20);
    const assistantBlocks = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    const containingCandidates = candidates.filter((candidate) => {
      return assistantBlocks.some((block) => candidate.contains(block));
    });
    const scrollTarget = containingCandidates.sort((a, b) => {
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    })[0] ?? document.scrollingElement;

    scrollTarget?.scrollTo({ top: targetTop, behavior: "instant" });
  }, scrollTop);
}

function printAssistantDumps(dumps: AssistantImageDump[]): void {
  for (const dump of dumps) {
    console.log(`--- assistant block #${dump.index} (data-message-id=${dump.messageId}) ---`);
    console.log(`text length: ${dump.textLength}`);
    console.log(`<img> count: ${dump.imgCount}`);
    console.log(`<picture> count: ${dump.pictureCount}`);
    console.log(`<source> count: ${dump.sourceCount}`);
    console.log(`<canvas> count: ${dump.canvasCount}`);
    console.log("<img> srcs (first 20):");
    printIndented(dump.imgSrcs.slice(0, 20));
    console.log("<img> srcsets (first 5):");
    printIndented(dump.imgSrcsets.slice(0, 5));
    console.log("<source> srcsets (first 5):");
    printIndented(dump.sourceSrcsets.slice(0, 5));
    console.log("background-image styles (first 10):");
    printIndented(dump.backgroundImages.slice(0, 10));
    console.log("elements matching [class*='image'] (first 10):");
    for (const match of dump.classImageMatches.slice(0, 10)) {
      console.log(`  tag=${match.tag} class=${match.value}`);
    }
    console.log("elements matching [data-testid*='image'] (first 10):");
    for (const match of dump.testIdImageMatches.slice(0, 10)) {
      console.log(`  tag=${match.tag} testid=${match.value}`);
    }
    console.log(`elements matching figure (count): ${dump.figureCount}`);
    console.log("buttons whose aria-label contains 'image' or 'attachment' (first 10):");
    for (const label of dump.imageAttachmentButtonLabels.slice(0, 10)) {
      console.log(`  label=${label}`);
    }
  }
}

function printRealImageUrls(dumps: AssistantImageDump[]): void {
  const urls = new Set<string>();
  for (const dump of dumps) {
    for (const src of dump.imgSrcs) {
      if (REAL_IMAGE_URL_MARKERS.some((marker) => src.includes(marker))) {
        urls.add(src);
      }
    }
  }

  console.log("--- real ChatGPT-generated image URLs ---");
  for (const url of urls) {
    console.log(url);
  }
}

function printIndented(values: string[]): void {
  for (const value of values) {
    console.log(`  ${value}`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
