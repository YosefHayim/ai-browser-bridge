import { basename } from "node:path";
import type { Page } from "playwright";
import { probeOrFallback } from "@/providers/browser-provider.ts";
import { createClipUrl, type FlowClip, listClips, readClipIdFromUrl } from "./flow-assets.ts";

const SRC_ATTRIBUTE = "src";

const IMG_TAG = "img";

const START_LABEL = "Start";

const CLICKABLE_TAGS_SELECTOR = "div,button,span";

const CASE_INSENSITIVE_FLAG = "i";

const GO_BACK_REGION_EDGE = 0.2;

const PICKER_CLOSE_SETTLE_MILLISECONDS = 600;

const PICKER_RETRY_SETTLE_MILLISECONDS = 700;

const MINIMUM_TILE_WIDTH_PIXELS = 20;

const PICKER_POLL_INTERVAL_MILLISECONDS = 400;

const BOTTOM_REGION_YMIN = 0.85;

// Flow has no generation API, so every step drives the DOM.

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

// Smallest-area match wins, so the real leaf control is clicked, not an outer wrapper.
const clickByLabel = async (
  page: Page,
  pattern: string,
  settings: { avoid?: string; region?: ClickRegion; minWidth?: number } = {},
): Promise<boolean> => {
  const avoidPattern = settings.avoid ?? null;
  const region: ClickRegion = settings.region ?? {};
  const defaultMinimumWidthPixels = 8;

  const minWidth = settings.minWidth ?? defaultMinimumWidthPixels;

  const target = await page.evaluate(
    (request: {
      src: string;
      avoid: string | null;
      region: ClickRegion;
      minWidth: number;
    }): Point | null => {
      const requiredPattern = new RegExp(request.src, CASE_INSENSITIVE_FLAG);
      const avoidPattern = request.avoid ? new RegExp(request.avoid, CASE_INSENSITIVE_FLAG) : null;
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
        const hasAriaLabel = ariaLabel != null;
        if (hasNonEmptyLabel) {
          label = elementLabel.trim();
        } else if (hasAriaLabel) {
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
    [...document.querySelectorAll(CLICKABLE_TAGS_SELECTOR)].some((element) => {
      const own = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => {
          const isNodeLabelMissing = node.textContent == null;
          if (isNodeLabelMissing) return "";

          return node.textContent;
        })
        .join("")
        .trim();
      return own === "End" || own === START_LABEL;
    }),
  );

const ensureFramesMode = async (page: Page): Promise<void> => {
  const isComposerFrameReady = await isFramesComposerReady(page);
  if (isComposerFrameReady) return;

  // raw shape: the composer's "Agent" pill sits in the create bar's bottom-left.
  const agentRegionXMax = 0.45;

  await clickByLabel(page, "Agent$", {
    region: { yMin: BOTTOM_REGION_YMIN, xMax: agentRegionXMax },
  });

  const actionTimeoutMilliseconds = 6_000;

  const ready = await findPoll(() => isFramesComposerReady(page), {
    timeoutMs: actionTimeoutMilliseconds,
    intervalMs: PICKER_POLL_INTERVAL_MILLISECONDS,
  });

  const isNotReady = !ready;
  if (isNotReady) {
    throw new Error(
      "Flow: could not switch the composer into Frames (image-to-video) mode; switch it manually and retry.",
    );
  }
};

// Position-tolerant on purpose: the old pixel-region check silently missed a set frame.
const startFrameReady = (page: Page): Promise<boolean> =>
  page.evaluate(
    (request: { hint: string; maxPx: number; minTop: number }) =>
      [...document.querySelectorAll(IMG_TAG)].some((img) => {
        const rect = img.getBoundingClientRect();
        const imageFileUrl = img.getAttribute(SRC_ATTRIBUTE);

        const isImageFileUrlMissing = imageFileUrl === null;
        if (isImageFileUrlMissing) return false;

        return (
          imageFileUrl.includes(request.hint) &&
          rect.width >= MINIMUM_TILE_WIDTH_PIXELS &&
          rect.width <= request.maxPx &&
          rect.height <= request.maxPx &&
          rect.top > window.innerHeight * request.minTop
        );
      }),
    { hint: MEDIA_REDIRECT_HINT, maxPx: FRAME_THUMB_MAX_PX, minTop: FRAME_THUMB_MIN_TOP_FRACTION },
  );

const isPickerOpen = (page: Page): Promise<boolean> =>
  // biome-ignore lint/performance/useDomNodeTextContent: the picker label must match what the user sees
  page.evaluate(() => /Upload media/i.test(document.body.innerText));

// The first click clears a filled slot, so the retry is what opens the picker.
const openFramePicker = async (page: Page): Promise<void> => {
  const isPickerShown = await isPickerOpen(page);
  if (isPickerShown) return;

  const maxFramePickerOpenAttempts = 3;

  for (let attempt = 0; attempt < maxFramePickerOpenAttempts; attempt += 1) {
    const target = await page.evaluate(
      (request: { hint: string; maxPx: number; minTop: number }): Point | null => {
        const startSlot = [...document.querySelectorAll(CLICKABLE_TAGS_SELECTOR)].find(
          (element) => {
            const own = [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => {
                const isNodeLabelMissing = node.textContent == null;
                if (isNodeLabelMissing) return "";

                return node.textContent;
              })
              .join("")
              .trim();
            return own === START_LABEL;
          },
        );
        const thumb = [...document.querySelectorAll(IMG_TAG)]
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            const imageFileUrl = img.getAttribute(SRC_ATTRIBUTE);

            const isImageFileUrlMissing = imageFileUrl === null;
            if (isImageFileUrlMissing) return false;

            return (
              imageFileUrl.includes(request.hint) &&
              rect.width >= MINIMUM_TILE_WIDTH_PIXELS &&
              rect.width <= request.maxPx &&
              rect.top > window.innerHeight * request.minTop
            );
          })
          .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0];
        const pick = startSlot ?? thumb;

        const isPickNotFound = pick == null;

        if (isPickNotFound) return null;

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
      intervalMs: PICKER_POLL_INTERVAL_MILLISECONDS,
    });
    if (isPickerShownInTime) {
      return;
    }

    await sleep(PICKER_RETRY_SETTLE_MILLISECONDS);
  }
  throw new Error("Flow: the Start-frame asset picker did not open.");
};

// Close a picker left open by a prior failed attach so it cannot cascade into the next scene.
const closeOpenPicker = async (page: Page): Promise<void> => {
  const maxOpenPickerCloseAttempts = 3;

  for (let attempt = 0; attempt < maxOpenPickerCloseAttempts; attempt += 1) {
    const isPickerNotOpened = !(await isPickerOpen(page));
    if (isPickerNotOpened) return;

    await probeOrFallback(null, () => page.keyboard.press("Escape"));
    await sleep(PICKER_CLOSE_SETTLE_MILLISECONDS);

    const isPickerStillClosed = !(await isPickerOpen(page));
    if (isPickerStillClosed) return;

    // raw shape: the picker's back control reads "arrow_back Go Back" in the top-left.
    await clickByLabel(page, "Go Back", {
      region: { yMax: GO_BACK_REGION_EDGE, xMax: GO_BACK_REGION_EDGE },
    });
    await sleep(PICKER_CLOSE_SETTLE_MILLISECONDS);
  }
};

// A fresh upload is the newest asset, so it is matched by a short label prefix.
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
  const fileUploadCount = await fileUpload.count();

  const hasNoFileUpload = fileUploadCount === 0;
  if (hasNoFileUpload) throw new Error("Flow: no file input in the asset picker.");

  await fileUpload.setInputFiles(imagePath);
  onProgress?.(`uploaded ${basename(imagePath)}; waiting for it to process…`);

  const uploadReadyPollMilliseconds = 1_200;

  const targetPoint = await findPoll(
    () =>
      page.evaluate((prefix: string): Point | null => {
        const label = [...document.querySelectorAll("*")]
          .filter((element) => {
            const own = [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => {
                const isNodeLabelMissing = node.textContent == null;
                if (isNodeLabelMissing) return "";

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
        const maxLabelAncestorLevels = 5;

        for (
          let climbedLevels = 0;
          climbedLevels < maxLabelAncestorLevels &&
          labelContainer?.parentElement &&
          !labelContainer.querySelector(IMG_TAG);
          climbedLevels += 1
        ) {
          labelContainer = labelContainer.parentElement;
        }

        const isLabelContainerMissing = labelContainer === null;
        const img = isLabelContainerMissing ? null : labelContainer.querySelector(IMG_TAG);

        const isImageNotLoaded =
          !(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0;
        if (isImageNotLoaded) {
          return null;
        }

        const isLabelContainerAbsent = labelContainer === null;
        if (isLabelContainerAbsent) return null;

        const rect = labelContainer.getBoundingClientRect();
        const maxClickOffsetPixels = 90;

        return {
          x: Math.round(rect.x + Math.min(rect.width / 2, maxClickOffsetPixels)),
          y: Math.round(rect.y + rect.height / 2),
        };
      }, labelPrefix),
    { timeoutMs: UPLOAD_READY_TIMEOUT_MS, intervalMs: uploadReadyPollMilliseconds },
  );

  const isTargetPointMissing = !targetPoint;
  if (isTargetPointMissing)
    throw new Error("Flow: the uploaded Start frame never finished processing.");

  // A disabled Add to Prompt click is a no-op, so the row is re-selected and retried.
  const maxStartFrameAttachRounds = 2;

  for (let round = 0; round < maxStartFrameAttachRounds; round += 1) {
    await page.mouse.click(targetPoint.x, targetPoint.y);
    await sleep(PICKER_RETRY_SETTLE_MILLISECONDS);
    const maxStartFrameClicks = 5;

    for (let click = 0; click < maxStartFrameClicks; click += 1) {
      await clickByLabel(page, "Add to Prompt$");

      const startFrameControlPollMilliseconds = 500;

      const pollTimeoutMilliseconds = 3_000;

      const closed = await findPoll(
        // biome-ignore lint/performance/useDomNodeTextContent: the picker label must match what the user sees
        () => page.evaluate(() => !/Upload media/i.test(document.body.innerText)),
        { timeoutMs: pollTimeoutMilliseconds, intervalMs: startFrameControlPollMilliseconds },
      );
      if (closed) {
        const startFrameRetrySettleMilliseconds = 800;

        await sleep(startFrameRetrySettleMilliseconds);
        return;
      }
    }
    onProgress?.(`re-selecting the uploaded frame (round ${round + 1})…`);
  }
  throw new Error("Flow: could not assign the Start frame (picker stayed open).");
};

const typeShotPrompt = async (page: Page, prompt: string): Promise<void> => {
  const editor = await page.evaluateHandle(() => {
    const minimumCandidateHeightPixels = 10;

    const minimumCandidateWidthPixels = 200;

    const candidate = [
      ...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'),
    ]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.width > minimumCandidateWidthPixels && rect.height > minimumCandidateHeightPixels,
      )
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];

    const isCandidateMissing = candidate == null;
    if (isCandidateMissing) return null;

    return candidate.element;
  });

  const box = editor.asElement();

  const isBoxMissing = box == null;
  if (isBoxMissing) throw new Error("Flow: prompt input not found.");

  await box.click();
  const promptTypingSettleMilliseconds = 150;

  await sleep(promptTypingSettleMilliseconds);
  await probeOrFallback(null, () => page.keyboard.press("Meta+A"));
  await probeOrFallback(null, () => page.keyboard.press("Backspace"));
  const typingDelayMilliseconds = 3;

  await box.type(prompt, { delay: typingDelayMilliseconds });
  const promptSubmitSettleMilliseconds = 300;

  await sleep(promptSubmitSettleMilliseconds);
};

// raw shape: the submit button reads "arrow_forward Create" in the create bar's bottom-right.
const arrowRegionXMin = 0.55;

const clickCreate = (page: Page): Promise<boolean> =>
  clickByLabel(page, "arrow_forward", {
    region: { yMin: BOTTOM_REGION_YMIN, xMin: arrowRegionXMin },
  });

type RenderStatus = {
  readonly generating: boolean;
  readonly failed: boolean;
  readonly percent: string;
};

const readRenderStatus = (page: Page): Promise<RenderStatus> =>
  page.evaluate(() => {
    // biome-ignore lint/performance/useDomNodeTextContent: the page copy must match what the user sees
    const pageCopy = document.body.innerText;
    // A lone "Failed" label is not matched; it would abort a healthy render.
    const percentParts = pageCopy.match(/\b(?<percent>\d{1,2}%)/);
    const percent = percentParts?.groups?.percent;
    const isPercentMissing = percent == null;

    return {
      generating: /Generating|Rendering|Dreaming|in progress|\b\d{1,2}%/i.test(pageCopy),
      failed:
        /generation failed|failed to generate|couldn.?t generate|something went wrong|an error occurred/i.test(
          pageCopy,
        ),
      percent: isPercentMissing ? "" : percent,
    };
  });

// Only the top-left tile tells the finished clip apart from older clips re-entering the DOM.
const readTopLeftClipId = async (page: Page): Promise<string> => {
  const mediaUrl = await page.evaluate((minPixels: number) => {
    const tiles = [...document.querySelectorAll("video")]
      .map((video) => {
        const videoFileUrl = video.getAttribute(SRC_ATTRIBUTE);
        let videoUrl = "";

        const hasVideoFileUrl = videoFileUrl !== null;
        if (hasVideoFileUrl) {
          videoUrl = videoFileUrl;
        } else {
          const fallbackUrl = video.querySelector("source")?.getAttribute(SRC_ATTRIBUTE);

          const hasFallbackUrl = fallbackUrl != null;
          if (hasFallbackUrl) videoUrl = fallbackUrl;
        }

        const rect = video.getBoundingClientRect();
        return { source: videoUrl, top: rect.top, left: rect.left, width: rect.width };
      })
      .filter((tile) => tile.width > minPixels)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const topTile = tiles[0];

    const isTopTileMissing = topTile == null;
    if (isTopTileMissing) return "";

    return topTile.source;
  }, MIN_GRID_CLIP_PX);
  return readClipIdFromUrl(mediaUrl);
};

// Waits for a NEW clip id in the top-left tile, or the timeout or a failure banner.
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
    // Completion reads the top-left tile, since the generating text lingers after renders finish.
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

    // Only a persistent failure banner aborts, since a real render never shows one for long.
    const isFailedAfterSettle =
      status.failed && !status.generating && Date.now() - startedAt > CLIP_SETTLE_MS;
    if (isFailedAfterSettle) {
      const hasNoFailureStreak = failingSince === 0;
      const hasFailedTooLong = Date.now() - failingSince > RENDER_FAILURE_CONFIRM_MS;

      if (hasNoFailureStreak) failingSince = Date.now();
      else if (hasFailedTooLong) {
        throw new Error("Flow reported a failed generation.");
      }
    } else {
      failingSince = 0;
    }

    const isDeadlineReached = Date.now() - startedAt > settings.timeoutMs;
    if (isDeadlineReached) {
      throw new Error("Flow: timed out waiting for the clip to finish rendering.");
    }

    const logIntervalMilliseconds = 15_000;

    const isLogDue = Date.now() - lastLog > logIntervalMilliseconds;
    if (isLogDue) {
      const isPercentEmpty = status.percent === "";
      const progressLabel = isPercentEmpty ? "in progress" : status.percent;
      onProgress?.(`rendering… ${progressLabel}`);
      lastLog = Date.now();
    }

    await sleep(GENERATION_POLL_MS);
  }
};

export const generateClipFromFrame = async (
  page: Page,
  parameters: FlowGenerateParameters,
): Promise<FlowClip> => {
  const { startFramePath, prompt, onProgress } = parameters;
  const timeoutMs = parameters.timeoutMs ?? GENERATION_TIMEOUT_MS;
  await probeOrFallback(null, () => page.bringToFront());
  await ensureFramesMode(page);
  // Reset any picker a prior failed scene left open so it can't corrupt this attach.
  await closeOpenPicker(page);
  const clipIds = (await listClips(page)).map((clip) => clip.id);
  const knownIds = new Set(clipIds);
  // Uploads can flake under load, so the whole attach is retried.
  let attached = false;
  const maxClipIdsLookupAttempts = 2;

  for (let attempt = 0; attempt < maxClipIdsLookupAttempts && !attached; attempt += 1) {
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

  const isAttachedMissing = !attached;
  if (isAttachedMissing) {
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
