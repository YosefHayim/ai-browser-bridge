/**
 * Forensic investigation tool that deeply probes ChatGPT conversations to
 * determine why the extractor reports 0 images when the user sees them.
 *
 * Hypotheses tested:
 *  (a) Selectors miss ChatGPT's actual image rendering (shadow DOM, <picture>, lazy-load, etc.)
 *  (b) ChatGPT virtualizes long history and we don't trigger hydration
 *  (c) Images are inside user-uploaded attachments, not assistant-generated
 *  (d) Some other cause
 *
 * Run with:
 *   pnpm tsx scripts/forensic-conv-investigation.ts <conv-id> [conv-id ...]
 */
import { BrowserManager } from "../src/browser/manager.ts";
import type { Page } from "playwright";

const NAVIGATE_WAIT_MS = 8_000;
const SCROLL_STEP_PX = 200;
const SCROLL_PAUSE_MS = 200;

/* ──────────────────────────── types ──────────────────────────── */

interface SelectorCandidate {
  selector: string;
  tagName: string;
  className: string;
  scrollHeight: number;
  clientHeight: number;
}

interface BlockDump {
  index: number;
  role: string;
  messageId: string;
  textLength: number;
  imgCount: number;
  pictureCount: number;
  sourceCount: number;
  anchorCount: number;
  videoCount: number;
  canvasCount: number;
  iframeCount: number;
  figureCount: number;
  classImageCount: number;
  testidImageCount: number;
  ariaLabelImageCount: number;
  ariaLabelAttachCount: number;
  roleImgCount: number;
  svgCount: number;
  relevantSrcs: string[];
  relevantHrefs: string[];
  relevantSrcsets: string[];
  backgroundImages: string[];
  shadowRootImgCount: number;
  outerHtmlPrefix: string;
}

interface GlobalImgMatch {
  src: string;
  closestRole: string | null;
  closestMessageId: string | null;
  tagName: string;
  alt: string;
  width: number;
  height: number;
  display: string;
  visibility: string;
}

interface HydrationSnapshot {
  pass: string;
  assistantCount: number;
  userCount: number;
  totalImgCount: number;
  scrollHeight: number;
}

interface HypothesisVerdict {
  virtualizationDetected: boolean;
  virtualizationDetails: string;
  shadowDomImageCount: number;
  userBlockImageCount: number;
  assistantBlockImageCount: number;
  globalImgCount: number;
  globalRealImgCount: number;
  hiddenImgCount: number;
  relevantGlobalSrcs: string[];
  relevantBlockSrcs: string[];
}

/* ──────────────────────────── main ──────────────────────────── */

async function investigateConversation(browser: BrowserManager, convId: string): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log(`FORENSIC INVESTIGATION: ${convId}`);
  console.log("=".repeat(80));

  const page = await browser.launch();
  const url = `https://chatgpt.com/c/${convId}`;

  console.log(`\n[STEP 1] Navigating to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(NAVIGATE_WAIT_MS);

  // tsx/esbuild instruments named function declarations with a __name helper that
  // doesn't exist in the browser. Inject a noop before any other page.evaluate
  // call so transpiled bodies don't throw ReferenceError.
  await page.evaluate(() => {
    if (typeof (globalThis as { __name?: unknown }).__name === "undefined") {
      (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
    }
  });

  console.log("\n[STEP 2] Finding scrollable message thread container");
  const scrollContainer = await findScrollContainer(page);
  printContainerInfo(scrollContainer);

  console.log("\n[STEP 3] Force-hydrating via scroll passes");
  const snapshots = await performScrollHydration(page, scrollContainer);

  console.log("\n[STEP 4] Per-block forensic dump");
  const blockDumps = await collectBlockDumps(page);
  printBlockDumps(blockDumps);

  console.log("\n[STEP 5] Global <img> element sweep");
  const globalMatches = await collectGlobalImages(page);
  printGlobalMatches(globalMatches);

  console.log("\n[STEP 6] Hypothesis summary");
  const summary = buildSummary(blockDumps, globalMatches, snapshots);
  printSummary(summary);
}

/* ────────────── find scrollable container ────────────── */

async function findScrollContainer(page: Page): Promise<SelectorCandidate | null> {
  return page.evaluate((): SelectorCandidate | null => {
    const selectors = [
      "main [role='presentation']",
      "div[class*='thread']",
      "div[class*='Thread']",
      "div[class*='conversation']",
      "div[class*='Conversation']",
      "main",
      "[role='main']",
    ];

    const assistantBlocks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'),
    );

    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      if (assistantBlocks.length > 0 && !assistantBlocks.some((b) => el.contains(b))) continue;
      if (el.scrollHeight <= el.clientHeight + 20) continue;

      return {
        selector: sel,
        tagName: el.tagName.toLowerCase(),
        className: el.className ?? "",
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    }

    const sc = document.scrollingElement;
    if (sc && sc.scrollHeight > sc.clientHeight + 20) {
      return {
        selector: "document.scrollingElement",
        tagName: sc.tagName.toLowerCase(),
        className: sc.className ?? "",
        scrollHeight: sc.scrollHeight,
        clientHeight: sc.clientHeight,
      };
    }

    return null;
  });
}

/* ────────────── scroll hydration ────────────── */

async function performScrollHydration(
  page: Page,
  container: SelectorCandidate | null,
): Promise<HydrationSnapshot[]> {
  const snapshots: HydrationSnapshot[] = [];
  const selArg = container?.selector ?? "document.scrollingElement";

  const countBlocks = (passLabel: string): Promise<HydrationSnapshot> =>
    page.evaluate(
      (args: { selector: string; passLabel: string }): HydrationSnapshot => {
        const getTarget = (): Element | null => {
          if (args.selector === "document.scrollingElement") return document.scrollingElement;
          return document.querySelector<HTMLElement>(args.selector);
        };
        const target = getTarget();
        return {
          pass: args.passLabel,
          assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
          userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
          totalImgCount: document.querySelectorAll("img").length,
          scrollHeight: target?.scrollHeight ?? 0,
        };
      },
      { selector: selArg, passLabel },
    );

  const pre = await countBlocks("pre-scroll");
  snapshots.push(pre);

  const doScroll = async (direction: "down" | "up", passName: string): Promise<void> => {
    for (let i = 0; i < 500; i++) {
      const stuck = await page.evaluate(
        (args: { selector: string; step: number; dir: string }): boolean => {
          const getTarget = (): Element | null => {
            if (args.selector === "document.scrollingElement") return document.scrollingElement;
            return document.querySelector<HTMLElement>(args.selector);
          };
          const target = getTarget() as HTMLElement | null;
          if (!target) return true;
          const before = target.scrollTop;
          const next = args.dir === "down"
            ? Math.min(before + args.step, target.scrollHeight)
            : Math.max(before - args.step, 0);
          target.scrollTo({ top: next, behavior: "instant" });
          return target.scrollTop === before;
        },
        { selector: selArg, step: SCROLL_STEP_PX, dir: direction },
      );
      if (stuck) break;
      await page.waitForTimeout(SCROLL_PAUSE_MS);
    }
    const snap = await countBlocks(passName);
    snapshots.push(snap);
  };

  await doScroll("down", "scroll-down-1");
  await doScroll("up", "scroll-up");
  await doScroll("down", "scroll-down-2");

  console.log("  Hydration snapshots:");
  for (const s of snapshots) {
    console.log(
      `    ${s.pass}: assistants=${s.assistantCount} users=${s.userCount} imgs=${s.totalImgCount} scrollH=${s.scrollHeight}`,
    );
  }

  return snapshots;
}

/* ────────────── per-block dump ────────────── */

async function collectBlockDumps(page: Page): Promise<BlockDump[]> {
  return page.evaluate((): BlockDump[] => {
    const URL_MARKERS = [
      "oaiusercontent", "sandbox", "cdn.openai", "videos.openai",
      "files.oai", "blob:", "data:image", "/backend-api/files",
    ];

    const hasMarker = (value: string): boolean =>
      URL_MARKERS.some((m) => value.includes(m));

    const walkShadowRoots = (root: Element | ShadowRoot): number => {
      let count = 0;
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node = tw.currentNode as Element;
      while (node) {
        if (node.shadowRoot) {
          count += node.shadowRoot.querySelectorAll("img").length;
          count += walkShadowRoots(node.shadowRoot);
        }
        node = tw.nextNode() as Element;
      }
      return count;
    };

    const blocks = Array.from<HTMLElement>(
      document.querySelectorAll(
        '[data-message-author-role="assistant"], [data-message-author-role="user"]',
      ),
    );

    return blocks.map((block, index) => {
      const imgs = Array.from(block.querySelectorAll<HTMLImageElement>("img"));
      const sources = Array.from(block.querySelectorAll<HTMLSourceElement>("source"));
      const anchors = Array.from(block.querySelectorAll<HTMLAnchorElement>("a"));

      const relevantSrcs = imgs
        .map((img) => img.currentSrc || img.src || img.getAttribute("src") || "")
        .filter(hasMarker);

      const relevantHrefs = anchors
        .map((a) => a.href || a.getAttribute("href") || "")
        .filter(hasMarker);

      const relevantSrcsets = [
        ...imgs.map((img) => img.srcset || "").filter(hasMarker),
        ...sources.map((s) => s.srcset || "").filter(hasMarker),
      ];

      const bgImages = Array.from(block.querySelectorAll<HTMLElement>("*"))
        .map((el) => {
          const inline = el.style.backgroundImage;
          const computed = getComputedStyle(el).backgroundImage;
          return inline || computed || "";
        })
        .filter((v) => /url\(/i.test(v));

      return {
        index,
        role: block.getAttribute("data-message-author-role") ?? "unknown",
        messageId: block.getAttribute("data-message-id") ?? "",
        textLength: block.innerText.length,
        imgCount: imgs.length,
        pictureCount: block.querySelectorAll("picture").length,
        sourceCount: sources.length,
        anchorCount: anchors.length,
        videoCount: block.querySelectorAll("video").length,
        canvasCount: block.querySelectorAll("canvas").length,
        iframeCount: block.querySelectorAll("iframe").length,
        figureCount: block.querySelectorAll("figure").length,
        classImageCount: block.querySelectorAll('[class*="image" i]').length,
        testidImageCount: block.querySelectorAll('[data-testid*="image" i]').length,
        ariaLabelImageCount: block.querySelectorAll('[aria-label*="image" i]').length,
        ariaLabelAttachCount: block.querySelectorAll('[aria-label*="attachment" i]').length,
        roleImgCount: block.querySelectorAll('[role="img"]').length,
        svgCount: block.querySelectorAll("svg").length,
        relevantSrcs,
        relevantHrefs,
        relevantSrcsets,
        backgroundImages: bgImages,
        shadowRootImgCount: walkShadowRoots(block),
        outerHtmlPrefix: (block.outerHTML ?? "").slice(0, 3000),
      } as BlockDump;
    });
  });
}

/* ────────────── global img sweep ────────────── */

async function collectGlobalImages(page: Page): Promise<GlobalImgMatch[]> {
  return page.evaluate((): GlobalImgMatch[] => {
    const FILTER = ["oaiusercontent", "sandbox", "files.oai", "blob:"];

    return Array.from(document.querySelectorAll<HTMLImageElement>("img"))
      .filter((img) => {
        const src = img.currentSrc || img.src || "";
        return FILTER.some((f) => src.includes(f));
      })
      .map((img) => {
        let ancestor: HTMLElement | null = img.closest<HTMLElement>(
          '[data-message-author-role]',
        ) as HTMLElement | null;
        if (!ancestor) {
          let el: HTMLElement | null = img.parentElement;
          while (el && !ancestor) {
            ancestor = el.closest<HTMLElement>('[data-message-author-role]') as HTMLElement | null;
            el = el.parentElement;
          }
        }

        const style = getComputedStyle(img);
        return {
          src: img.currentSrc || img.src,
          closestRole: ancestor?.getAttribute("data-message-author-role") ?? null,
          closestMessageId: ancestor?.getAttribute("data-message-id") ?? null,
          tagName: img.tagName.toLowerCase(),
          alt: img.alt || "",
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          display: style.display,
          visibility: style.visibility,
        } as GlobalImgMatch;
      });
  });
}

/* ────────────── summary builder ────────────── */

function buildSummary(
  blockDumps: BlockDump[],
  globalMatches: GlobalImgMatch[],
  snapshots: HydrationSnapshot[],
): HypothesisVerdict {
  const pre = snapshots.find((s) => s.pass === "pre-scroll");
  const last = snapshots[snapshots.length - 1];

  const virtualizationDetected = pre !== undefined && last !== undefined
    && (last.assistantCount > pre.assistantCount || last.totalImgCount > pre.totalImgCount);

  const virtualizationDetails = virtualizationDetected
    ? [
        last.assistantCount > (pre?.assistantCount ?? 0)
          ? `assistant blocks grew from ${pre?.assistantCount} to ${last.assistantCount}`
          : null,
        last.totalImgCount > (pre?.totalImgCount ?? 0)
          ? `img count grew from ${pre?.totalImgCount} to ${last.totalImgCount}`
          : null,
      ].filter((line): line is string => line !== null).join("; ")
    : "no block/img count change across scroll passes";

  const userBlocks = blockDumps.filter((b) => b.role === "user");
  const assistantBlocks = blockDumps.filter((b) => b.role === "assistant");

  return {
    virtualizationDetected,
    virtualizationDetails,
    shadowDomImageCount: blockDumps.reduce((sum, b) => sum + b.shadowRootImgCount, 0),
    userBlockImageCount: userBlocks.reduce((sum, b) => sum + b.imgCount, 0),
    assistantBlockImageCount: assistantBlocks.reduce((sum, b) => sum + b.imgCount, 0),
    globalImgCount: globalMatches.length,
    globalRealImgCount: globalMatches.filter((m) => m.width > 0 && m.height > 0).length,
    hiddenImgCount: globalMatches.filter(
      (m) => m.display === "none" || m.visibility === "hidden",
    ).length,
    relevantGlobalSrcs: globalMatches.map((m) => m.src),
    relevantBlockSrcs: blockDumps.flatMap((b) => b.relevantSrcs),
  };
}

/* ────────────── printers ────────────── */

function printContainerInfo(container: SelectorCandidate | null): void {
  if (container) {
    console.log(`  selector: ${container.selector}`);
    console.log(`  tag: ${container.tagName}`);
    console.log(`  className: ${container.className.slice(0, 200)}`);
    console.log(`  scrollHeight: ${container.scrollHeight}`);
    console.log(`  clientHeight: ${container.clientHeight}`);
  } else {
    console.log("  NONE — no scrollable container detected");
  }
}

function printBlockDumps(dumps: BlockDump[]): void {
  console.log(`\n  Total blocks found: ${dumps.length}`);

  for (const dump of dumps) {
    console.log(`\n  [${dump.index}] role=${dump.role} id=${dump.messageId}`);
    console.log(`    textLength=${dump.textLength}`);

    console.log(
      `    counts: img=${dump.imgCount} picture=${dump.pictureCount} source=${dump.sourceCount}` +
      ` a=${dump.anchorCount} video=${dump.videoCount} canvas=${dump.canvasCount}` +
      ` iframe=${dump.iframeCount} figure=${dump.figureCount}` +
      ` [class*=image]=${dump.classImageCount} [data-testid*=image]=${dump.testidImageCount}` +
      ` [aria-label*=image]=${dump.ariaLabelImageCount} [aria-label*=attachment]=${dump.ariaLabelAttachCount}` +
      ` [role=img]=${dump.roleImgCount} svg=${dump.svgCount} shadowImgs=${dump.shadowRootImgCount}`,
    );

    if (dump.relevantSrcs.length > 0) {
      console.log(`    relevant img srcs (${dump.relevantSrcs.length}):`);
      for (const src of dump.relevantSrcs.slice(0, 30)) {
        console.log(`      ${src}`);
      }
    }
    if (dump.relevantHrefs.length > 0) {
      console.log(`    relevant anchor hrefs (${dump.relevantHrefs.length}):`);
      for (const href of dump.relevantHrefs.slice(0, 30)) {
        console.log(`      ${href}`);
      }
    }
    if (dump.relevantSrcsets.length > 0) {
      console.log(`    relevant srcsets (${dump.relevantSrcsets.length}):`);
      for (const srcset of dump.relevantSrcsets.slice(0, 10)) {
        console.log(`      ${srcset}`);
      }
    }
    if (dump.backgroundImages.length > 0) {
      console.log(`    background-image urls (${dump.backgroundImages.length}):`);
      for (const bg of dump.backgroundImages.slice(0, 10)) {
        console.log(`      ${bg}`);
      }
    }

    console.log("    outerHTML (first 3000 chars):");
    console.log("    " + dump.outerHtmlPrefix.replace(/\n/g, "\n    "));
  }
}

function printGlobalMatches(matches: GlobalImgMatch[]): void {
  console.log(`\n  Total document-level <img> with relevant src: ${matches.length}`);
  if (matches.length === 0) {
    console.log("    *** NO IMAGES FOUND ANYWHERE ON THE PAGE ***");
    return;
  }

  for (const match of matches) {
    console.log(
      `    src=${match.src} role=${match.closestRole} msgId=${match.closestMessageId}` +
      ` tag=${match.tagName} alt=${match.alt.slice(0, 60)}` +
      ` ${match.width}x${match.height} display=${match.display} visibility=${match.visibility}`,
    );
  }
}

function printSummary(v: HypothesisVerdict): void {
  console.log("\n" + "=".repeat(80));
  console.log("HYPOTHESIS ANALYSIS");
  console.log("=".repeat(80));

  console.log("\n  (b) VIRTUALIZATION:");
  console.log(`    detected: ${v.virtualizationDetected}`);
  console.log(`    details: ${v.virtualizationDetails}`);

  console.log("\n  (a) SHADOW DOM:");
  console.log(`    images inside shadow roots: ${v.shadowDomImageCount}`);
  if (v.shadowDomImageCount > 0) {
    console.log("    *** IMAGES EXIST INSIDE SHADOW DOM — standard selectors miss them ***");
  } else {
    console.log("    → shadow DOM is NOT hiding images");
  }

  console.log("\n  (c) USER vs ASSISTANT block images:");
  console.log(`    user block <img> count: ${v.userBlockImageCount}`);
  console.log(`    assistant block <img> count: ${v.assistantBlockImageCount}`);
  if (v.userBlockImageCount > 0 && v.assistantBlockImageCount === 0) {
    console.log("    *** ALL IMAGES IN USER BLOCKS — extractor scopes to assistant only ***");
  }

  console.log("\n  GLOBAL IMAGE SWEEP:");
  console.log(`    total relevant <img> on page: ${v.globalImgCount}`);
  console.log(`    with non-zero dimensions: ${v.globalRealImgCount}`);
  console.log(`    hidden (display:none or visibility:hidden): ${v.hiddenImgCount}`);

  if (v.relevantGlobalSrcs.length > 0) {
    console.log(`    all relevant global srcs (${v.relevantGlobalSrcs.length}):`);
    for (const src of v.relevantGlobalSrcs) {
      console.log(`      ${src}`);
    }
  }
  if (v.relevantBlockSrcs.length > 0) {
    console.log(`    all relevant block-level srcs (${v.relevantBlockSrcs.length}):`);
    for (const src of v.relevantBlockSrcs) {
      console.log(`      ${src}`);
    }
  }

  console.log("\n  ROOT CAUSE ASSESSMENT:");
  if (v.globalImgCount === 0) {
    console.log("    → No images exist anywhere on the page after full scroll hydration.");
    console.log("    → ChatGPT likely does NOT render these as <img> elements at all.");
    console.log("    → Possible: images via <canvas>, WebGL, CSS-only, or the conversation");
    console.log("      does not contain visible image content in the current browser session.");
  } else if (v.globalRealImgCount > 0 && v.relevantBlockSrcs.length === 0) {
    console.log("    → Images exist globally but NOT inside [data-message-author-role] blocks.");
    console.log("    → Block-scoped selector misses them — gallery/modal/sidebar container.");
  } else if (v.shadowDomImageCount > 0) {
    console.log("    → Images inside shadow DOM — standard querySelector cannot reach them.");
  } else if (v.hiddenImgCount > 0 && v.hiddenImgCount === v.globalImgCount) {
    console.log("    → Images exist but ALL are hidden — lazy-load not triggered or CSS hiding.");
  } else if (v.userBlockImageCount > 0 && v.assistantBlockImageCount === 0) {
    console.log("    → Images in user-uploaded attachments, not assistant responses.");
    console.log("    → Extractor must also scan user blocks.");
  } else {
    console.log("    → Images present and visible in assistant blocks.");
    console.log("    → Existing extractor should work — check for selector regressions.");
  }
}

/* ────────────── entry point ────────────── */

async function main(): Promise<number> {
  const convIds = process.argv.slice(2);
  if (convIds.length === 0) {
    console.error("Usage: pnpm tsx scripts/forensic-conv-investigation.ts <conv-id> [conv-id ...]");
    return 1;
  }

  const browser = new BrowserManager();

  try {
    for (const convId of convIds) {
      await investigateConversation(browser, convId);
    }
    return 0;
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn(
        `[WARN] Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
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
