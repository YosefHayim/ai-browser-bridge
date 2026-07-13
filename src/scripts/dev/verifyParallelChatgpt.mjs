#!/usr/bin/env node
// Dev-only FEASIBILITY e2e for the parallel-Conversations fan-out (ADR 0016).
//
// Proves the load-bearing assumptions of "one Chrome, N tabs" BEFORE the feature
// is built, by driving real concurrent ChatGPT tabs in the warm bridge Chrome
// over CDP (:9222):
//
//   1. INDEPENDENCE  — each tab gets its own answer (blue→BLUE, green→GREEN, …),
//                      so concurrent tabs on one profile never cross-talk.
//   2. CONCURRENCY   — a bounded pool overlaps generations (wall-time < serial sum).
//   3. RAM-BOUNDING  — the pool never holds more than `concurrency` tabs at once, and
//                      each closes on capture, so peak memory scales with the dial, not N.
//   4. NO LOCK       — all tabs attach to the single shared-profile Chrome; no second
//                      process, so no ProcessSingleton corruption.
//   5. LIMIT         — each reply is truncated to maxReplyChars for context safety.
//
// NOT read-only: it types + submits, creating a few THROWAWAY new conversations in
// the signed-in account (trivial to delete). It NEVER touches already-open tabs.
//
//   node dist/bridge.js chrome start   # ensure Chrome :9222 + signed into ChatGPT
//   node src/scripts/dev/verifyParallelChatgpt.mjs [--concurrency 2] [--max-reply 120]
//
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";
const COMPOSER = "#prompt-textarea, [contenteditable='true']";
const ASSISTANT = "[data-message-author-role='assistant']";
const USER_MSG = "[data-message-author-role='user']";
const STOP = "[data-testid='stop-button'], button[aria-label*='Stop']";

const TASK_TIMEOUT_MS = 120_000;

// Distinct one-word answers make cross-talk between tabs impossible to miss.
const TASKS = [
  {
    label: "blue",
    expect: "BLUE",
    prompt: "Reply with exactly one word in caps: BLUE. Nothing else.",
  },
  {
    label: "green",
    expect: "GREEN",
    prompt: "Reply with exactly one word in caps: GREEN. Nothing else.",
  },
  {
    label: "red",
    expect: "RED",
    prompt: "Reply with exactly one word in caps: RED. Nothing else.",
  },
];

const execFileAsync = promisify(execFile);
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const CONCURRENCY = Number(arg("--concurrency", "2"));
const MAX_REPLY = Number(arg("--max-reply", "120"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const truncate = (s, n) =>
  s.length > n
    ? { text: s.slice(0, n), truncated: true, replyChars: s.length }
    : { text: s, truncated: false, replyChars: s.length };
const trivialReply = (t) =>
  !t || /^thinking\b/i.test(t) || /^reasoning\b/i.test(t) || /^searching\b/i.test(t);

/** Sum RSS (MB) of every Google Chrome process — informational only (shared browser). */
const chromeRssMb = async () => {
  try {
    const { stdout } = await execFileAsync("ps", ["ax", "-o", "rss=,command="]);
    let kb = 0;
    for (const line of stdout.split("\n")) {
      if (!/Google Chrome|Chromium/.test(line) || /verifyParallelChatgpt/.test(line)) continue;
      const rss = Number.parseInt(line.trim().split(/\s+/)[0], 10);
      if (Number.isFinite(rss)) kb += rss;
    }
    return Math.round(kb / 1024);
  } catch {
    return -1;
  }
};

const lastAssistantText = (page) =>
  page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    const last = nodes[nodes.length - 1];
    return last ? (last.innerText || "").trim() : "";
  }, ASSISTANT);

/** Wait until the reply is DONE: stop-button gone, text non-trivial, stable ~1.2s. */
const waitForReply = async (page) => {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  let last = "";
  let stableMs = 0;
  while (Date.now() < deadline) {
    const streaming = (await page.locator(STOP).count()) > 0;
    const now = await lastAssistantText(page);
    if (!streaming && !trivialReply(now) && now === last) {
      stableMs += 400;
      if (stableMs >= 1_200) return now;
    } else {
      last = now;
      stableMs = 0;
    }
    await sleep(400);
  }
  return last;
};

/** Open a fresh tab, ask one prompt in a NEW chat, capture the reply, close the tab. */
const runOneTask = async (context, task, live) => {
  const start = Date.now();
  const page = await context.newPage();
  live.open += 1;
  live.maxOpen = Math.max(live.maxOpen, live.open);
  try {
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(COMPOSER, { timeout: 30_000 });
    live.peakRss = Math.max(live.peakRss, await chromeRssMb());

    const composer = page.locator(COMPOSER).first();
    await composer.click();
    await composer.pressSequentially(task.prompt, { delay: 5 });
    const prevUsers = await page.locator(USER_MSG).count();
    await page.keyboard.press("Enter");
    // Confirm the prompt actually submitted before waiting on a reply.
    await page.waitForFunction(
      ([sel, n]) => document.querySelectorAll(sel).length > n,
      [USER_MSG, prevUsers],
      { timeout: 20_000 },
    );

    const reply = await waitForReply(page);
    const idMatch = page.url().match(/\/c\/([0-9a-f-]+)/i); // …/c/<uuid>
    return {
      label: task.label,
      ok: reply.toUpperCase().includes(task.expect) && !trivialReply(reply),
      reply: truncate(reply, MAX_REPLY),
      crossTalk: TASKS.filter((t) => t !== task && reply.toUpperCase().includes(t.expect)).map(
        (t) => t.label,
      ),
      // Capture group 1 of /\/c\/([0-9a-f-]+)/ is the conversation uuid after /c/.
      conversationId: idMatch ? idMatch[1] : null,
      url: page.url(),
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      label: task.label,
      ok: false,
      error: String(err).split("\n")[0],
      elapsedMs: Date.now() - start,
    };
  } finally {
    await page.close().catch(() => {});
    live.open -= 1;
  }
};

/** Bounded pool: at most `limit` tasks in flight, preserving input order in results. */
const runPool = async (context, tasks, limit, live) => {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await runOneTask(context, tasks[i], live);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

const main = async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(
      `Could not attach to Chrome on ${CDP_URL}. Run \`node dist/bridge.js chrome start\` and sign into ChatGPT.`,
    );
    process.exit(1);
  }
  const [context] = browser.contexts();
  if (!context) {
    console.error("No browser context found.");
    process.exit(1);
  }

  const baseline = await chromeRssMb();
  const live = { open: 0, maxOpen: 0, peakRss: baseline };
  console.log(
    `\nParallel-ChatGPT feasibility e2e — concurrency=${CONCURRENCY}, tasks=${TASKS.length}, maxReply=${MAX_REPLY}`,
  );
  console.log(`Chrome RSS baseline (with your existing tabs): ${baseline} MB\n`);

  const wall0 = Date.now();
  const results = await runPool(context, TASKS, CONCURRENCY, live);
  const wallMs = Date.now() - wall0;
  await sleep(6_000);
  const afterClose = await chromeRssMb();
  const serialSum = results.reduce((n, r) => n + (r.elapsedMs || 0), 0);

  console.log("Results (ordered array — the real fan-out shape):");
  console.log(`${JSON.stringify(results, null, 2)}\n`);

  const allOk = results.every((r) => r.ok);
  const noCrossTalk = results.every((r) => !r.crossTalk || r.crossTalk.length === 0);
  const gotIds = results.every((r) => r.conversationId);
  const overlapped = wallMs < serialSum * 0.9;
  const ramBounded = live.maxOpen <= CONCURRENCY;

  const mark = (b) => (b ? "PASS" : "FAIL");
  console.log("Assertions:");
  console.log(`  [${mark(allOk)}] independence — each tab returned its own colour`);
  console.log(`  [${mark(noCrossTalk)}] no cross-talk between concurrent tabs`);
  console.log(`  [${mark(gotIds)}] resumable — each new chat reported a conversationId`);
  console.log(`  [${mark(overlapped)}] concurrency — wall ${wallMs}ms < serial-sum ${serialSum}ms`);
  console.log(
    `  [${mark(ramBounded)}] RAM-bounding — max ${live.maxOpen} tab(s) open at once (dial=${CONCURRENCY}), each closed on capture`,
  );
  console.log(
    `  [info] Chrome RSS baseline ${baseline} / peak ${live.peakRss} / after-close ${afterClose} MB (shared browser — indicative only)`,
  );

  const pass = allOk && noCrossTalk && ramBounded;
  console.log(`\n${pass ? "VERDICT: design is feasible ✓" : "VERDICT: needs a look ✗"}`);
  await browser.close().catch(() => {}); // CDP: disconnects socket, leaves Chrome running
  process.exit(pass ? 0 : 1);
};

await main();
