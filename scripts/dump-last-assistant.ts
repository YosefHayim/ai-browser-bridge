/**
 * One-shot diagnostic dump for the last rendered ChatGPT assistant message.
 *
 * Run with:
 *   pnpm tsx scripts/dump-last-assistant.ts
 */
import { BrowserManager } from "../src/browser/manager.ts";
import { SELECTORS } from "../src/browser/chatgpt-page.ts";

interface AssistantDump {
  innerText: string;
  imgSrcs: string[];
  downloadAnchors: Array<{
    href: string;
    download: string;
  }>;
  outerHTML: string;
}

interface PageDiagnostics {
  title: string;
  bodyInnerText: string;
  counts: Array<{
    selector: string;
    count: number;
  }>;
  mainOuterHTML: string | null;
}

const INNER_TEXT_LIMIT = 2_000;
const OUTER_HTML_LIMIT = 8_000;
const BODY_INNER_TEXT_LIMIT = 500;
const MAIN_OUTER_HTML_LIMIT = 4_000;
const DEFAULT_CONVERSATION_ID = "69f40d73-0044-8384-a1bb-7a1b95e64a5c";
const DIAGNOSTIC_SELECTORS = [
  "[data-message-author-role]",
  '[data-message-author-role="assistant"]',
  '[data-message-author-role="user"]',
  "main",
  "article",
  "img",
];

async function main(): Promise<number> {
  const conversationId = process.argv[2] ?? DEFAULT_CONVERSATION_ID;
  const browser = new BrowserManager();

  try {
    const page = await browser.launch();
    console.log("AVAILABLE TABS:");
    for (const contextPage of page.context().pages()) {
      console.log(contextPage.url());
    }

    await page.goto(`https://chatgpt.com/c/${conversationId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);

    const diagnostics = await page.evaluate((selectors: string[]): PageDiagnostics => {
      const bodyInnerText = document.body.innerText;
      const main = document.querySelector("main");

      return {
        title: document.title,
        bodyInnerText,
        counts: selectors.map((selector) => {
          return {
            selector,
            count: document.querySelectorAll(selector).length,
          };
        }),
        mainOuterHTML: main?.outerHTML ?? null,
      };
    }, DIAGNOSTIC_SELECTORS);

    console.log(`--- URL: ${page.url()} ---`);
    console.log(`--- TITLE: ${diagnostics.title} ---`);
    console.log(`--- BODY INNER TEXT LENGTH: ${diagnostics.bodyInnerText.length} ---`);
    console.log("--- BODY INNER TEXT (first 500 chars) ---");
    console.log(diagnostics.bodyInnerText.slice(0, BODY_INNER_TEXT_LIMIT));
    console.log("--- ELEMENT COUNTS ---");
    for (const { selector, count } of diagnostics.counts) {
      console.log(`${selector}: ${count}`);
    }
    if (diagnostics.mainOuterHTML !== null) {
      console.log("--- MAIN OUTER HTML (truncated to 4000 chars) ---");
      console.log(diagnostics.mainOuterHTML.slice(0, MAIN_OUTER_HTML_LIMIT));
    }

    const assistantBlocks = page.locator(SELECTORS.responseBlock);
    const assistantBlockCount = await assistantBlocks.count();

    if (assistantBlockCount === 0) {
      console.error("No assistant messages found on the current ChatGPT page.");
      return 1;
    }

    const dump = await assistantBlocks.last().evaluate((element: Element): AssistantDump => {
      const innerText = element instanceof HTMLElement ? element.innerText : element.textContent ?? "";
      const imgSrcs = Array.from(element.querySelectorAll<HTMLImageElement>("img"), (img) => {
        return img.currentSrc || img.src || img.getAttribute("src") || "";
      });
      const downloadAnchors = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[download]"), (anchor) => {
        return {
          href: anchor.href || anchor.getAttribute("href") || "",
          download: anchor.getAttribute("download") ?? "",
        };
      });

      return {
        innerText,
        imgSrcs,
        downloadAnchors,
        outerHTML: element.outerHTML,
      };
    });

    console.log("--- INNER TEXT (first 2000 chars) ---");
    console.log(dump.innerText.slice(0, INNER_TEXT_LIMIT));
    console.log("--- IMG SRCS ---");
    for (const src of dump.imgSrcs) {
      console.log(src);
    }
    console.log("--- ANCHOR HREFS (download attrs) ---");
    for (const anchor of dump.downloadAnchors) {
      console.log(`${anchor.href}\tdownload="${anchor.download}"`);
    }
    console.log("--- OUTER HTML (truncated to 8000 chars) ---");
    console.log(dump.outerHTML.slice(0, OUTER_HTML_LIMIT));

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn(`Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
