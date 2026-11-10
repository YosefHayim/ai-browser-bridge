import { basename } from "node:path";
import type { Page } from "playwright";
import { createClipUrl, type FlowClip, listClips, readClipIdFromUrl } from "./flow-assets.ts";

// Google Flow "Frames" image-to-video generation. Flow's Veo studio turns a Start keyframe
// + a shot prompt into a rendered clip; there is no generation API, so every step is
// DOM-driven and was LIVE-VERIFIED (2026-07-14) against a signed-in Flow project editor:
//   - the composer has a bare "Agent" mode (no slots) and a "Frames" mode showing Start ⇄
//     End slots; clicking the "Agent" pill reveals the slots (idempotent — skipped when
//     the slots already show);
//   - an empty slot is a ~50px element whose OWN text is "Start"/"End"; a SET Start slot
//     becomes a ~50px <img> whose src is the media.getMediaUrlRedirect endpoint (the same
//     signal listClips reads). A set frame is therefore detected by that thumbnail, NOT by
//     pixel position: an earlier region check floored at 0.66·vh missed the thumbnail at
//     ~0.64·vh and silently skipped generation, wasting the setup;
//   - the asset picker uploads through a hidden <input type=file> (filechooser events are
//     unreliable over a CDP-attached page) and commits the newest asset with "Add to
//     Prompt"; a disabled click is a no-op, so the row is re-selected and retried;
//   - clicking a FILLED thumbnail clears the frame (reverting it to the "Start" text slot),
//     so opening the picker retries — self-healing a dirty slot left by a prior scene;
//   - Create carries the "arrow_forward" Material ligature in the create bar's bottom-right;
//   - a finished render is a NEW <video> clip id in the grid, diffed against listClips.

// Frame-slot thumbnails render ~50px; the cap separates them from >150px grid clips.
const FRAME_THUMB_MAX_PX = 96;
// Ignore small imgs above this fraction of the viewport (avatars / toolbar icons).
const FRAME_THUMB_MIN_TOP_FRACTION = 0.4;
// A set frame / rendered clip src carries Flow's media redirect endpoint.
const MEDIA_REDIRECT_HINT = "media.getMediaUrlRedirect";
// Longest label prefix matched against a picker row (short so a truncated name still hits).
const UPLOAD_LABEL_PREFIX_LEN = 12;
const UPLOAD_READY_TIMEOUT_MS = 90_000;
const PICKER_OPEN_TIMEOUT_MS = 4_000;
// Veo renders take minutes; allow a long budget for a clip to finish.
const GENERATION_TIMEOUT_MS = 600_000;
const GENERATION_POLL_MS = 5_000;
// A fresh clip is only trusted after this settle window (guards a stale listClips read).
const CLIP_SETTLE_MS = 10_000;
// A failure banner must persist this long before it aborts a wait (ignores stray labels).
const RENDER_FAILURE_CONFIRM_MS = 25_000;
// A grid clip tile is wider than this; smaller <video> are previews/thumbnails, not clips.
const MIN_GRID_CLIP_PX = 100;
// A finished clip must hold the top-left slot this long before it is trusted as finished.
const CLIP_HOLD_MS = 3_000;

type ClickRegion = {
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
};

type Point = {
  readonly x: number;
  readonly y: number;
};

export type FlowGenerateParameters = {
  readonly startFramePath: string;
  readonly prompt: string;
  readonly timeoutMs?: number;
  readonly onProgress?: (message: string) => void;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((fulfill) => {
    setTimeout(fulfill, milliseconds);
  });

const findPoll = async <Found>(
  predicate: () => Promise<Found>,
  settings: { timeoutMs: number; intervalMs: number },
): Promise<Found | null> => {
  const startedAt = Date.now();
  for (;;) {
    const found = await predicate();
    if (found) return found;

    const isTimeoutPassed = Date.now() - startedAt > settings.timeoutMs;
    if (isTimeoutPassed) return null;

    await sleep(settings.intervalMs);
  }
};

// Click the smallest visible element whose text/aria-label matches `pattern`, optionally
// within a viewport `region`. Smallest-area wins so the real leaf control is clicked, not
// an outer wrapper whose center misses the button.
const clickByLabel = async (
  page: Page,
  pattern: string,
  settings: { avoid?: string; region?: ClickRegion; minWidth?: number } = {},
): Promise<boolean> => {
  const avoidPattern = settings.avoid === undefined ? null : settings.avoid;
  const region: ClickRegion = settings.region === undefined ? {} : settings.region;
  const minWidth = settings.minWidth === undefined ? 8 : settings.minWidth;

  const target = await page.evaluate(
    (request: {
      src: string;
      avoid: string | null;
      region: ClickRegion;
      minWidth: number;
    }): Point | null => {
      const requiredPattern = new RegExp(request.src, "i");
      const avoidPattern = request.avoid ? new RegExp(request.avoid, "i") : null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hits = [
        ...document.querySelectorAll(
          "button,[role=button],[role=tab],[role=option],[role=menuitem],[role=menuitemradio],[role=radio],a,label,li,div",
        ),
      ].filter((element) => {
        const elementLabel = element.textContent;
        const ariaLabel = element.getAttribute("aria-label");
        let label = "";

        const hasNonEmptyLabel = elementLabel !== null && elementLabel.trim() !== "";
        if (hasNonEmptyLabel) {
          label = elementLabel.trim();
        } else if (ariaLabel !== null) {
          label = ariaLabel.trim();
        }

        const isLabelOutsidePattern = !requiredPattern.test(label);
        if (isLabelOutsidePattern) return false;

        const isLabelAvoided = avoidPattern?.test(label);
        if (isLabelAvoided) return false;

        const rect = element.getBoundingClientRect();
        const isRectTooSmall = rect.width < request.minWidth || rect.height <= 0;
        if (isRectTooSmall) return false;

        const cx = (rect.x + rect.width / 2) / vw;
        const cy = (rect.y + rect.height / 2) / vh;

        const isLeftOfRegion = request.region.xMin != null && cx < request.region.xMin;
        if (isLeftOfRegion) return false;

        const isRightOfRegion = request.region.xMax != null && cx > request.region.xMax;
        if (isRightOfRegion) return false;

        const isAboveRegion = request.region.yMin != null && cy < request.region.yMin;
        if (isAboveRegion) return false;

        const isBelowRegion = request.region.yMax != null && cy > request.region.yMax;
        if (isBelowRegion) return false;

        return rect.top >= 0 && rect.left >= 0;
      });
      hits.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });

      const element = hits[0];
      const isElementMissing = element == null;
      if (isElementMissing) return null;

      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    },
    {
      src: pattern,
      avoid: avoidPattern,
      region,
      minWidth,
    },
  );
  const isTargetEmpty = !target;
  if (isTargetEmpty) return false;

  await page.mouse.click(target.x, target.y);
  return true;
};

const isFramesComposerReady = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    [...document.querySelectorAll("div,button,span")].some((element) => {
      const own = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => {
          if (node.textContent === null) return "";

          return node.textContent;
        })
        .join("")
        .trim();
      return own === "End" || own === "Start";
    }),
  );

const ensureFramesMode = async (page: Page): Promise<void> => {
  const isComposerFrameReady = await isFramesComposerReady(page);
  if (isComposerFrameReady) return;

  // raw shape: the composer's "Agent" pill sits in the create bar's bottom-left.
  await clickByLabel(page, "Agent$", { region: { yMin: 0.85, xMax: 0.45 } });

  const ready = await findPoll(() => isFramesComposerReady(page), {
    timeoutMs: 6_000,
    intervalMs: 400,
  });
  const isNotReady = !ready;
  if (isNotReady) {
    throw new Error(
      "Flow: could not switch the composer into Frames (image-to-video) mode; switch it manually and retry.",
    );
  }
};

// True when a Start frame is set: a small (~50px) thumbnail whose src is Flow's media
// redirect endpoint sits in the composer's lower half. Position-tolerant on purpose —
// replaces the brittle pixel-region check that silently missed a set frame.
const startFrameReady = (page: Page): Promise<boolean> =>
  page.evaluate(
    (request: { hint: string; maxPx: number; minTop: number }) =>
      [...document.querySelectorAll("img")].some((img) => {
        const rect = img.getBoundingClientRect();
        const imageFileUrl = img.getAttribute("src");

        const isImageFileUrlMissing = imageFileUrl === null;
        if (isImageFileUrlMissing) return false;

        return (
          imageFileUrl.includes(request.hint) &&
          rect.width >= 20 &&
          rect.width <= request.maxPx &&
          rect.height <= request.maxPx &&
          rect.top > window.innerHeight * request.minTop
        );
      }),
    { hint: MEDIA_REDIRECT_HINT, maxPx: FRAME_THUMB_MAX_PX, minTop: FRAME_THUMB_MIN_TOP_FRACTION },
  );

const isPickerOpen = (page: Page): Promise<boolean> =>
  page.evaluate(() => /Upload media/i.test(document.body.innerText));

// Open the Start-frame asset picker. Clicks the empty "Start" text slot; when the slot
// already holds a thumbnail, the first click clears it and the retry opens the picker —
// self-healing a dirty slot left by a prior scene.
const openFramePicker = async (page: Page): Promise<void> => {
  const isPickerShown = await isPickerOpen(page);
  if (isPickerShown) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await page.evaluate(
      (request: { hint: string; maxPx: number; minTop: number }): Point | null => {
        const startSlot = [...document.querySelectorAll("div,button,span")].find((element) => {
          const own = [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => {
              if (node.textContent === null) return "";

              return node.textContent;
            })
            .join("")
            .trim();
          return own === "Start";
        });
        const thumb = [...document.querySelectorAll("img")]
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            const imageFileUrl = img.getAttribute("src");

            const isImageFileUrlMissing = imageFileUrl === null;
            if (isImageFileUrlMissing) return false;

            return (
              imageFileUrl.includes(request.hint) &&
              rect.width >= 20 &&
              rect.width <= request.maxPx &&
              rect.top > window.innerHeight * request.minTop
            );
          })
          .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0];
        let pick: Element | undefined = startSlot;

        const isPickMissing = pick === undefined;
        if (isPickMissing) pick = thumb;

        if (pick === undefined) return null;

        const rect = pick.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      },
      {
        hint: MEDIA_REDIRECT_HINT,
        maxPx: FRAME_THUMB_MAX_PX,
        minTop: FRAME_THUMB_MIN_TOP_FRACTION,
      },
    );
    const isTargetEmpty = !target;
    if (isTargetEmpty) throw new Error("Flow: Start frame slot not found in the composer.");

    await page.mouse.click(target.x, target.y);

    const isPickerShownInTime = await findPoll(() => isPickerOpen(page), {
      timeoutMs: PICKER_OPEN_TIMEOUT_MS,
      intervalMs: 400,
    });
    if (isPickerShownInTime) {
      return;
    }

    await sleep(700);
  }
  throw new Error("Flow: the Start-frame asset picker did not open.");
};

// Close a picker left open by a prior failed attach so it cannot cascade into the next scene.
const closeOpenPicker = async (page: Page): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const isPickerNotOpened = !(await isPickerOpen(page));
    if (isPickerNotOpened) return;

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(600);

    const isPickerStillClosed = !(await isPickerOpen(page));
    if (isPickerStillClosed) return;

    // raw shape: the picker's back control reads "arrow_back Go Back" in the top-left.
    await clickByLabel(page, "Go Back", { region: { yMax: 0.2, xMax: 0.2 } });
    await sleep(600);
  }
};

// Upload `imagePath` fresh and assign it as the Start frame. A fresh upload becomes the
// newest asset (top of the picker), matched by a short label prefix so a truncated display
// name still hits; the picker is confirmed closed after "Add to Prompt".
const attachStartFrame = async (
  page: Page,
  imagePath: string,
  onProgress?: (message: string) => void,
): Promise<void> => {
  await openFramePicker(page);
  // raw shape: <name>.<ext> → up to UPLOAD_LABEL_PREFIX_LEN chars of <name>, truncation-safe.
  const labelPrefix = basename(imagePath)
    .replace(/\.[^.]+$/, "")
    .slice(0, UPLOAD_LABEL_PREFIX_LEN);

  const fileUpload = page.locator('input[type="file"]').first();
  const hasNoFileUpload = (await fileUpload.count()) === 0;
  if (hasNoFileUpload) throw new Error("Flow: no file input in the asset picker.");

  await fileUpload.setInputFiles(imagePath);
  onProgress?.(`uploaded ${basename(imagePath)}; waiting for it to process…`);

  const targetPoint = await findPoll(
    () =>
      page.evaluate((prefix: string): Point | null => {
        const label = [...document.querySelectorAll("*")]
          .filter((element) => {
            const own = [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => {
                if (node.textContent === null) return "";

                return node.textContent;
              })
              .join("")
              .trim();
            return prefix.length > 0 && own.startsWith(prefix);
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
        const isLabelEmpty = !label;
        if (isLabelEmpty) return null;

        let labelContainer: Element | null = label;
        for (
          let up = 0;
          up < 5 && labelContainer?.parentElement && !labelContainer.querySelector("img");
          up += 1
        ) {
          labelContainer = labelContainer.parentElement;
        }

        const isLabelContainerMissing = labelContainer === null;
        const img = isLabelContainerMissing ? null : labelContainer.querySelector("img");
        const isImageNotLoaded =
          !(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0;
        if (isImageNotLoaded) {
          return null;
        }

        const isLabelContainerAbsent = labelContainer === null;
        if (isLabelContainerAbsent) return null;

        const rect = labelContainer.getBoundingClientRect();
        return {
          x: Math.round(rect.x + Math.min(rect.width / 2, 90)),
          y: Math.round(rect.y + rect.height / 2),
        };
      }, labelPrefix),
    { timeoutMs: UPLOAD_READY_TIMEOUT_MS, intervalMs: 1_200 },
  );
  if (!targetPoint) throw new Error("Flow: the uploaded Start frame never finished processing.");

  // A disabled "Add to Prompt" click is a no-op; re-select the row and retry until the
  // picker closes. Two rounds cover both the auto-selected and needs-selecting states.
  for (let round = 0; round < 2; round += 1) {
    await page.mouse.click(targetPoint.x, targetPoint.y);
    await sleep(700);
    for (let click = 0; click < 5; click += 1) {
      await clickByLabel(page, "Add to Prompt$");

      const closed = await findPoll(
        () => page.evaluate(() => !/Upload media/i.test(document.body.innerText)),
        { timeoutMs: 3_000, intervalMs: 500 },
      );
      if (closed) {
        await sleep(800);
        return;
      }
    }
    onProgress?.(`re-selecting the uploaded frame (round ${round + 1})…`);
  }
  throw new Error("Flow: could not assign the Start frame (picker stayed open).");
};

const typeShotPrompt = async (page: Page, prompt: string): Promise<void> => {
  const editor = await page.evaluateHandle(() => {
    const candidate = [
      ...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'),
    ]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 200 && rect.height > 10)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];

    const isCandidateMissing = candidate == null;
    if (isCandidateMissing) return null;

    return candidate.element;
  });

  const box = editor.asElement();
  const isBoxMissing = box == null;
  if (isBoxMissing) throw new Error("Flow: prompt input not found.");

  await box.click();
  await sleep(150);
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await box.type(prompt, { delay: 3 });
  await sleep(300);
};

// raw shape: the submit button reads "arrow_forward Create" in the create bar's bottom-right.
const clickCreate = (page: Page): Promise<boolean> =>
  clickByLabel(page, "arrow_forward", { region: { yMin: 0.85, xMin: 0.55 } });

type RenderStatus = {
  readonly generating: boolean;
  readonly failed: boolean;
  readonly percent: string;
};

const readRenderStatus = (page: Page): Promise<RenderStatus> =>
  page.evaluate(() => {
    const pageCopy = document.body.innerText;
    // raw shape: Flow shows progress as "N%"; failures use multi-word phrases (a lone
    // "Failed" clip label is deliberately NOT matched — it would abort a healthy render).
    const percentParts = pageCopy.match(/\b(?<percent>\d{1,2}%)/);
    const percent = percentParts?.groups?.percent;
    const isPercentMissing = percent === undefined;
    return {
      generating: /Generating|Rendering|Dreaming|in progress|\b\d{1,2}%/i.test(pageCopy),
      failed:
        /generation failed|failed to generate|couldn.?t generate|something went wrong|an error occurred/i.test(
          pageCopy,
        ),
      percent: isPercentMissing ? "" : percent,
    };
  });

// Return the clip id of the TOP-LEFT clip tile, or "" when that tile is a render placeholder
// (no media src) or absent. Flow places the current render top-left, so reading ONLY that
// tile identifies the finished clip the instant its media src lands — without being fooled by
// an older clip that re-enters the virtualized DOM further down (which a DOM-order set-diff
// wrongly picks up), and without depending on Flow's flaky "generating"/"in progress" text.
const readTopLeftClipId = async (page: Page): Promise<string> => {
  const mediaUrl = await page.evaluate((minPixels: number) => {
    const tiles = [...document.querySelectorAll("video")]
      .map((video) => {
        const videoFileUrl = video.getAttribute("src");
        let videoUrl = "";

        const hasVideoFileUrl = videoFileUrl !== null;
        if (hasVideoFileUrl) {
          videoUrl = videoFileUrl;
        } else {
          const fallbackUrl = video.querySelector("source")?.getAttribute("src");
          const hasFallbackUrl = fallbackUrl != null;
          if (hasFallbackUrl) videoUrl = fallbackUrl;
        }

        const rect = video.getBoundingClientRect();
        return { source: videoUrl, top: rect.top, left: rect.left, width: rect.width };
      })
      .filter((tile) => tile.width > minPixels)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const topTile = tiles[0];

    const isTopTileMissing = topTile === undefined;
    if (isTopTileMissing) return "";

    return topTile.source;
  }, MIN_GRID_CLIP_PX);
  return readClipIdFromUrl(mediaUrl);
};

// Wait until the finished render — a NEW clip id in the top-left tile that holds steady —
// appears, or the timeout / a persistent failure banner ends the wait.
interface WaitForNewClipDetails {
  page: Page;
  knownIds: Set<string>;
  options: { timeoutMs: number };
  onProgress?: (message: string) => void;
}

const waitForNewClip = async ({
  page,
  knownIds,
  options: settings,
  onProgress,
}: WaitForNewClipDetails): Promise<FlowClip> => {
  const startedAt = Date.now();
  let lastLog = 0;
  let failingSince = 0;
  let candidateId = "";
  let candidateSince = 0;
  for (;;) {
    // Completion = the top-left tile shows a NEW clip id that holds. Independent of the
    // "generating" text (which lingers as "in progress" after some renders finish).
    const topId = await readTopLeftClipId(page);

    const fresh = topId !== "" && !knownIds.has(topId);
    const isFreshCandidateTop = fresh && topId === candidateId;
    if (isFreshCandidateTop) {
      const isCandidateHeldLongEnough =
        Date.now() - candidateSince > CLIP_HOLD_MS && Date.now() - startedAt > CLIP_SETTLE_MS;
      if (isCandidateHeldLongEnough) {
        return { id: topId, url: createClipUrl(topId), index: 0 };
      }
    } else if (fresh) {
      candidateId = topId;
      candidateSince = Date.now();
    } else {
      candidateId = "";
    }

    const status = await readRenderStatus(page);
    // Only trust a failure banner that PERSISTS (a real render never produces a fresh
    // top-left clip on failure) so a stray label or a pre-render flicker never aborts.
    const isFailedAfterSettle =
      status.failed && !status.generating && Date.now() - startedAt > CLIP_SETTLE_MS;
    if (isFailedAfterSettle) {
      const hasNoFailureStreak = failingSince === 0;
      if (hasNoFailureStreak) failingSince = Date.now();
      else if (Date.now() - failingSince > RENDER_FAILURE_CONFIRM_MS) {
        throw new Error("Flow reported a failed generation.");
      }
    } else {
      failingSince = 0;
    }

    const isDeadlineReached = Date.now() - startedAt > settings.timeoutMs;
    if (isDeadlineReached) {
      throw new Error("Flow: timed out waiting for the clip to finish rendering.");
    }

    const isLogDue = Date.now() - lastLog > 15_000;
    if (isLogDue) {
      const isPercentEmpty = status.percent === "";
      const progressLabel = isPercentEmpty ? "in progress" : status.percent;
      onProgress?.(`rendering… ${progressLabel}`);
      lastLog = Date.now();
    }

    await sleep(GENERATION_POLL_MS);
  }
};

// Generate one Veo clip from a Start keyframe + shot prompt end to end: Frames mode,
// set Start frame, type prompt, press Create, wait for the rendered clip.
export const generateClipFromFrame = async (
  page: Page,
  parameters: FlowGenerateParameters,
): Promise<FlowClip> => {
  const { startFramePath, prompt, onProgress } = parameters;
  const timeoutMs =
    parameters.timeoutMs === undefined ? GENERATION_TIMEOUT_MS : parameters.timeoutMs;
  await page.bringToFront().catch(() => {});
  await ensureFramesMode(page);
  // Reset any picker a prior failed scene left open so it can't corrupt this attach.
  await closeOpenPicker(page);
  const knownIds = new Set((await listClips(page)).map((clip) => clip.id));
  // Uploads/selection can flake under load; retry the whole attach (resetting the picker
  // between tries) before giving up, so one bad upload never sinks the scene.
  let attached = false;
  for (let attempt = 0; attempt < 2 && !attached; attempt += 1) {
    try {
      await attachStartFrame(page, startFramePath, onProgress);
      attached = await startFrameReady(page);
    } catch (error) {
      const isErrorObject = error instanceof Error;
      const message = isErrorObject ? error.message : String(error);
      onProgress?.(`attach attempt ${attempt + 1} failed: ${message}`);
    }

    const isNotAttached = !attached;
    if (isNotAttached) await closeOpenPicker(page);
  }

  if (!attached) {
    throw new Error(
      "Flow: the Start frame did not attach after retries; aborting before generation.",
    );
  }

  await typeShotPrompt(page, prompt);
  onProgress?.("submitting the render…");

  const isCreateNotClicked = !(await clickCreate(page));
  if (isCreateNotClicked) throw new Error("Flow: could not find the Create button.");

  return waitForNewClip({ page, knownIds, options: { timeoutMs }, onProgress });
};
