import { basename } from "node:path";
import type { Page } from "playwright";
import { type FlowClip, clipIdFromSrc, clipUrlFromId, listClips } from "./flowAssets.ts";

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

/** Frame-slot thumbnails render ~50px; the cap separates them from >150px grid clips. */
const FRAME_THUMB_MAX_PX = 96;
/** Ignore small imgs above this fraction of the viewport (avatars / toolbar icons). */
const FRAME_ROW_MIN_TOP_FRACTION = 0.4;
/** A set frame / rendered clip src carries Flow's media redirect endpoint. */
const MEDIA_REDIRECT_HINT = "media.getMediaUrlRedirect";
/** Longest label prefix matched against a picker row (short so a truncated name still hits). */
const UPLOAD_LABEL_PREFIX_LEN = 12;
/** Wait budget for the uploaded Start frame to finish processing. */
const UPLOAD_READY_TIMEOUT_MS = 90_000;
/** Wait budget for the asset picker to open after clicking the Start slot. */
const PICKER_OPEN_TIMEOUT_MS = 4_000;
/** Veo renders take minutes; allow a long budget for a clip to finish. */
const GENERATION_TIMEOUT_MS = 600_000;
/** Poll cadence while waiting for a rendered clip. */
const GENERATION_POLL_MS = 5_000;
/** A fresh clip is only trusted after this settle window (guards a stale listClips read). */
const CLIP_SETTLE_MS = 10_000;
/** A failure banner must persist this long before it aborts a wait (ignores stray labels). */
const RENDER_FAILURE_CONFIRM_MS = 25_000;
/** A grid clip tile is wider than this; smaller <video> are previews/thumbnails, not clips. */
const MIN_GRID_CLIP_PX = 100;
/** A finished clip must hold the top-left slot this long before it is trusted as the result. */
const CLIP_HOLD_MS = 3_000;

/** A viewport-relative region (0..1 fractions of width/height) to constrain a click. */
interface ClickRegion {
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

/** Screen point in CSS pixels. */
interface Point {
  x: number;
  y: number;
}

/** Parameters for {@link generateClipFromFrame}. */
export interface FlowGenerateParams {
  /** Local path to the Start keyframe image (image-to-video). */
  startFramePath: string;
  /** Shot / motion prompt typed into the composer. */
  prompt: string;
  /** Overall render wait budget in ms (default 10 minutes). */
  timeoutMs?: number;
  /** Optional progress sink for long-running steps (upload, render). */
  onProgress?: (message: string) => void;
}

/** Resolve after `ms` milliseconds. */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Poll `predicate` until it returns a truthy value or the timeout elapses.
 *
 * @param predicate - Async check returning a truthy value (kept) or falsy (retry).
 * @param options - Poll `timeoutMs` and `intervalMs`.
 * @returns The first truthy value, or null on timeout.
 */
const pollFor = async <T>(
  predicate: () => Promise<T>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<T | null> => {
  const startedAt = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - startedAt > options.timeoutMs) return null;
    await delay(options.intervalMs);
  }
};

/**
 * Click the smallest visible element whose text/aria-label matches `pattern`, optionally
 * within a viewport `region`. Smallest-area wins so the real leaf control is clicked, not
 * an outer wrapper whose center misses the button.
 */
const clickByText = async (
  page: Page,
  pattern: string,
  options: { avoid?: string; region?: ClickRegion; minWidth?: number } = {},
): Promise<boolean> => {
  const target = await page.evaluate(
    (input: {
      src: string;
      avoid: string | null;
      region: ClickRegion;
      minWidth: number;
    }): Point | null => {
      const rx = new RegExp(input.src, "i");
      const ax = input.avoid ? new RegExp(input.avoid, "i") : null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const matches = [
        ...document.querySelectorAll(
          "button,[role=button],[role=tab],[role=option],[role=menuitem],[role=menuitemradio],[role=radio],a,label,li,div",
        ),
      ].filter((el) => {
        const text = (el.textContent ?? el.getAttribute("aria-label") ?? "").trim();
        if (!rx.test(text)) return false;
        if (ax?.test(text)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < input.minWidth || rect.height <= 0) return false;
        const cx = (rect.x + rect.width / 2) / vw;
        const cy = (rect.y + rect.height / 2) / vh;
        if (input.region.xMin != null && cx < input.region.xMin) return false;
        if (input.region.xMax != null && cx > input.region.xMax) return false;
        if (input.region.yMin != null && cy < input.region.yMin) return false;
        if (input.region.yMax != null && cy > input.region.yMax) return false;
        return rect.top >= 0 && rect.left >= 0;
      });
      matches.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
      const el = matches[0];
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    },
    {
      src: pattern,
      avoid: options.avoid ?? null,
      region: options.region ?? {},
      minWidth: options.minWidth ?? 8,
    },
  );
  if (!target) return false;
  await page.mouse.click(target.x, target.y);
  return true;
};

/** True when the composer shows the Start/End frame slots (Frames image-to-video mode). */
const framesComposerReady = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    [...document.querySelectorAll("div,button,span")].some((el) => {
      const own = [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      return own === "End" || own === "Start";
    }),
  );

/** Ensure the composer is in Frames mode, revealing the Start/End slots via the Agent pill. */
const ensureFramesMode = async (page: Page): Promise<void> => {
  if (await framesComposerReady(page)) return;
  // raw shape: the composer's "Agent" pill sits in the create bar's bottom-left.
  await clickByText(page, "Agent$", { region: { yMin: 0.85, xMax: 0.45 } });
  const ready = await pollFor(() => framesComposerReady(page), {
    timeoutMs: 6_000,
    intervalMs: 400,
  });
  if (!ready) {
    throw new Error(
      "Flow: could not switch the composer into Frames (image-to-video) mode; switch it manually and retry.",
    );
  }
};

/**
 * True when a Start frame is set: a small (~50px) thumbnail whose src is Flow's media
 * redirect endpoint sits in the composer's lower half. Position-tolerant on purpose — this
 * replaces the brittle pixel-region check that silently missed a set frame.
 */
const startFrameReady = (page: Page): Promise<boolean> =>
  page.evaluate(
    (input: { hint: string; maxPx: number; minTop: number }) =>
      [...document.querySelectorAll("img")].some((img) => {
        const rect = img.getBoundingClientRect();
        return (
          (img.getAttribute("src") ?? "").includes(input.hint) &&
          rect.width >= 20 &&
          rect.width <= input.maxPx &&
          rect.height <= input.maxPx &&
          rect.top > window.innerHeight * input.minTop
        );
      }),
    { hint: MEDIA_REDIRECT_HINT, maxPx: FRAME_THUMB_MAX_PX, minTop: FRAME_ROW_MIN_TOP_FRACTION },
  );

/** True when the asset picker overlay is open (its "Upload media" control is present). */
const pickerOpen = (page: Page): Promise<boolean> =>
  page.evaluate(() => /Upload media/i.test(document.body.innerText));

/**
 * Open the Start-frame asset picker. Clicks the empty "Start" text slot; when the slot
 * already holds a thumbnail, the first click clears it (reverting to the text slot) and the
 * retry opens the picker — self-healing a dirty slot left by a prior scene.
 */
const openFramePicker = async (page: Page): Promise<void> => {
  if (await pickerOpen(page)) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await page.evaluate(
      (input: { hint: string; maxPx: number; minTop: number }): Point | null => {
        const startSlot = [...document.querySelectorAll("div,button,span")].find((el) => {
          const own = [...el.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? "")
            .join("")
            .trim();
          return own === "Start";
        });
        const thumb = [...document.querySelectorAll("img")]
          .filter((img) => {
            const rect = img.getBoundingClientRect();
            return (
              (img.getAttribute("src") ?? "").includes(input.hint) &&
              rect.width >= 20 &&
              rect.width <= input.maxPx &&
              rect.top > window.innerHeight * input.minTop
            );
          })
          .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0];
        const pick = startSlot ?? thumb;
        if (!pick) return null;
        const rect = pick.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      },
      { hint: MEDIA_REDIRECT_HINT, maxPx: FRAME_THUMB_MAX_PX, minTop: FRAME_ROW_MIN_TOP_FRACTION },
    );
    if (!target) throw new Error("Flow: Start frame slot not found in the composer.");
    await page.mouse.click(target.x, target.y);
    if (
      await pollFor(() => pickerOpen(page), { timeoutMs: PICKER_OPEN_TIMEOUT_MS, intervalMs: 400 })
    ) {
      return;
    }
    await delay(700);
  }
  throw new Error("Flow: the Start-frame asset picker did not open.");
};

/**
 * Close the asset picker if it is open, so a picker left open by a prior failed attach can't
 * cascade into every following scene. Tries Escape, then the picker's "Go Back" control.
 */
const closeOpenPicker = async (page: Page): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await pickerOpen(page))) return;
    await page.keyboard.press("Escape").catch(() => {});
    await delay(600);
    if (!(await pickerOpen(page))) return;
    // raw shape: the picker's back control reads "arrow_back Go Back" in the top-left.
    await clickByText(page, "Go Back", { region: { yMax: 0.2, xMax: 0.2 } });
    await delay(600);
  }
};

/**
 * Upload `imagePath` fresh and assign it as the Start frame. A fresh upload becomes the
 * newest asset (top of the picker), matched by a short label prefix so a truncated display
 * name still hits; the picker is confirmed closed after "Add to Prompt".
 */
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
  const input = page.locator('input[type="file"]').first();
  if ((await input.count()) === 0) throw new Error("Flow: no file input in the asset picker.");
  await input.setInputFiles(imagePath);
  onProgress?.(`uploaded ${basename(imagePath)}; waiting for it to process…`);
  const rowTarget = await pollFor(
    () =>
      page.evaluate((prefix: string): Point | null => {
        const label = [...document.querySelectorAll("*")]
          .filter((el) => {
            const own = [...el.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? "")
              .join("")
              .trim();
            return prefix.length > 0 && own.startsWith(prefix);
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
        if (!label) return null;
        let row: Element | null = label;
        for (let up = 0; up < 5 && row?.parentElement && !row.querySelector("img"); up += 1) {
          row = row.parentElement;
        }
        const img = row?.querySelector("img") ?? null;
        if (!(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0)
          return null;
        const rect = (row as Element).getBoundingClientRect();
        return {
          x: Math.round(rect.x + Math.min(rect.width / 2, 90)),
          y: Math.round(rect.y + rect.height / 2),
        };
      }, labelPrefix),
    { timeoutMs: UPLOAD_READY_TIMEOUT_MS, intervalMs: 1_200 },
  );
  if (!rowTarget) throw new Error("Flow: the uploaded Start frame never finished processing.");
  // A disabled "Add to Prompt" click is a no-op; re-select the row and retry until the
  // picker closes. Two rounds cover both the auto-selected and needs-selecting states.
  for (let round = 0; round < 2; round += 1) {
    await page.mouse.click(rowTarget.x, rowTarget.y);
    await delay(700);
    for (let click = 0; click < 5; click += 1) {
      await clickByText(page, "Add to Prompt$");
      const closed = await pollFor(
        () => page.evaluate(() => !/Upload media/i.test(document.body.innerText)),
        { timeoutMs: 3_000, intervalMs: 500 },
      );
      if (closed) {
        await delay(800);
        return;
      }
    }
    onProgress?.(`re-selecting the uploaded frame (round ${round + 1})…`);
  }
  throw new Error("Flow: could not assign the Start frame (picker stayed open).");
};

/** Type the shot prompt into the largest visible editor, replacing any existing text. */
const typeShotPrompt = async (page: Page, text: string): Promise<void> => {
  const editor = await page.evaluateHandle(() => {
    const candidate = [
      ...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'),
    ]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 200 && rect.height > 10)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
    return candidate ? candidate.el : null;
  });
  const box = editor.asElement();
  if (!box) throw new Error("Flow: prompt input not found.");
  await box.click();
  await delay(150);
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await box.type(text, { delay: 3 });
  await delay(300);
};

/** Submit the render via the create bar's "arrow_forward Create" button. */
const clickCreate = (page: Page): Promise<boolean> =>
  // raw shape: the submit button reads "arrow_forward Create" in the create bar's bottom-right.
  clickByText(page, "arrow_forward", { region: { yMin: 0.85, xMin: 0.55 } });

/** Snapshot of Flow's render state scraped from the page body. */
interface RenderState {
  generating: boolean;
  failed: boolean;
  percent: string;
}

/** Read whether Flow is mid-render, has failed, and the current progress percent. */
const readRenderState = (page: Page): Promise<RenderState> =>
  page.evaluate(() => {
    const text = document.body.innerText;
    // raw shape: Flow shows progress as "N%"; failures use multi-word phrases (a lone
    // "Failed" clip label is deliberately NOT matched — it would abort a healthy render).
    return {
      generating: /Generating|Rendering|Dreaming|in progress|\b\d{1,2}%/i.test(text),
      failed:
        /generation failed|failed to generate|couldn.?t generate|something went wrong|an error occurred/i.test(
          text,
        ),
      percent: (text.match(/\b\d{1,2}%/) ?? [""])[0],
    };
  });

/**
 * Return the clip id of the TOP-LEFT clip tile, or "" when that tile is a render placeholder
 * (no media src) or absent. Flow places the current render top-left, so reading ONLY that
 * tile identifies the finished clip the instant its media src lands — without being fooled by
 * an older clip that re-enters the virtualized DOM further down (which a DOM-order set-diff
 * wrongly picks up), and without depending on Flow's flaky "generating"/"in progress" text.
 */
const topLeftClipId = async (page: Page): Promise<string> => {
  const src = await page.evaluate((minPx: number) => {
    const tiles = [...document.querySelectorAll("video")]
      .map((video) => {
        const source =
          video.getAttribute("src") ?? video.querySelector("source")?.getAttribute("src") ?? "";
        const rect = video.getBoundingClientRect();
        return { source, top: rect.top, left: rect.left, width: rect.width };
      })
      .filter((tile) => tile.width > minPx)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    return tiles[0]?.source ?? "";
  }, MIN_GRID_CLIP_PX);
  return clipIdFromSrc(src);
};

/**
 * Wait until the finished render — a NEW clip id in the top-left tile that holds steady —
 * appears, or the timeout / a persistent failure banner ends the wait.
 */
const waitForNewClip = async (
  page: Page,
  knownIds: Set<string>,
  options: { timeoutMs: number },
  onProgress?: (message: string) => void,
): Promise<FlowClip> => {
  const startedAt = Date.now();
  let lastLog = 0;
  let failingSince = 0;
  let candidateId = "";
  let candidateSince = 0;
  for (;;) {
    // Completion = the top-left tile shows a NEW clip id that holds. Independent of the
    // "generating" text (which lingers as "in progress" after some renders finish).
    const topId = await topLeftClipId(page);
    const fresh = topId !== "" && !knownIds.has(topId);
    if (fresh && topId === candidateId) {
      if (Date.now() - candidateSince > CLIP_HOLD_MS && Date.now() - startedAt > CLIP_SETTLE_MS) {
        return { id: topId, url: clipUrlFromId(topId), index: 0 };
      }
    } else if (fresh) {
      candidateId = topId;
      candidateSince = Date.now();
    } else {
      candidateId = "";
    }
    const state = await readRenderState(page);
    // Only trust a failure banner that PERSISTS (a real render never produces a fresh
    // top-left clip on failure) so a stray label or a pre-render flicker never aborts.
    if (state.failed && !state.generating && Date.now() - startedAt > CLIP_SETTLE_MS) {
      if (failingSince === 0) failingSince = Date.now();
      else if (Date.now() - failingSince > RENDER_FAILURE_CONFIRM_MS) {
        throw new Error("Flow reported a failed generation.");
      }
    } else {
      failingSince = 0;
    }
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error("Flow: timed out waiting for the clip to finish rendering.");
    }
    if (Date.now() - lastLog > 15_000) {
      onProgress?.(`rendering… ${state.percent || "in progress"}`);
      lastLog = Date.now();
    }
    await delay(GENERATION_POLL_MS);
  }
};

/**
 * Generate one Veo clip from a Start keyframe + a shot prompt, end to end: switch to Frames
 * mode, set the Start frame, type the prompt, press Create, and wait for the rendered clip.
 *
 * @param page - Playwright page on a signed-in Flow project editor.
 * @param params - Start keyframe path, shot prompt, and optional timeout / progress sink.
 * @returns The newly rendered {@link FlowClip} (id + cookie-fetchable mp4 URL).
 * @example
 * ```ts
 * const clip = await generateClipFromFrame(page, {
 *   startFramePath: "/abs/scene-01.png",
 *   prompt: "slow push-in, cold mist, a single ember flickers",
 * });
 * ```
 */
export const generateClipFromFrame = async (
  page: Page,
  params: FlowGenerateParams,
): Promise<FlowClip> => {
  const { startFramePath, prompt, onProgress } = params;
  const timeoutMs = params.timeoutMs ?? GENERATION_TIMEOUT_MS;
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
    } catch (err) {
      onProgress?.(
        `attach attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!attached) await closeOpenPicker(page);
  }
  if (!attached) {
    throw new Error(
      "Flow: the Start frame did not attach after retries; aborting before generation.",
    );
  }
  await typeShotPrompt(page, prompt);
  onProgress?.("submitting the render…");
  if (!(await clickCreate(page))) throw new Error("Flow: could not find the Create button.");
  return waitForNewClip(page, knownIds, { timeoutMs }, onProgress);
};
