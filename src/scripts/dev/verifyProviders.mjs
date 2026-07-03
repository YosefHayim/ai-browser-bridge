#!/usr/bin/env node
// Dev-only end-to-end smoke test for the non-ChatGPT browser providers.
//
// Drives each provider through the REAL built CLI (`node dist/bridge.js ask
// --provider <id> --json`) — the same code path a user hits — so it exercises the
// actual adapter (GenericWebChatPage / GeminiPage), the orchestrator turn, sign-in
// detection, and the CDP browser attach, not a hand-rolled selector probe. A PASS
// means the whole chain works against the live, signed-in DOM.
//
// It sends one trivial prompt ("reply with the word pong") per provider and
// classifies the outcome:
//   • PASS       exit 0 + non-empty reply captured (adapter verified)
//   • SIGNED_OUT exit≠0 + "not signed in / composer not found" — run `bridge login`
//   • EMPTY      exit 0 + empty reply — reached the page but captured nothing
//                (assistant selector likely drifted)
//   • TIMEOUT    the turn never settled within --timeout
//   • ATTACH     browser/CDP not connected
//   • FAIL       any other error
//
// Providers are verified SEQUENTIALLY, never fanned out: they share one Chrome
// debug port (:9222), and driving several at once would have them fight over it.
// With a warm Chrome already on :9222 each provider just attaches and opens its own
// tab (non-disruptive); cold, the bridge would spawn its own profile. Run AFTER
// `bridge login` for each provider you want a real PASS from:
//
//   node dist/bridge.js login --provider grok      # sign in once, per provider
//   node src/scripts/dev/verifyProviders.mjs           # verify the default five
//   node src/scripts/dev/verifyProviders.mjs grok claude --timeout=90
//
// The JSON report is written under downloads/ (gitignored) — nothing enters git.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = join(REPO_ROOT, "dist", "bridge.js");
const REPORT_DIR = join(REPO_ROOT, "downloads", "verify-providers");

// ChatGPT is excluded by default — it is already verified and pulls in the MCP
// tunnel. Gemini is ordered last because it is the only provider with its own
// Chrome profile, so it is the one that would cold-spawn a separate window.
const DEFAULT_PROVIDERS = ["claude", "deepseek", "grok", "perplexity", "gemini"];
const DEFAULT_TIMEOUT_SECONDS = 75;
const DEFAULT_PROMPT = "Respond with exactly one word: pong — and nothing else.";
// Hard wall-clock guard per provider, a margin above the in-turn --timeout, so a
// wedged browser attach can never hang the whole sweep.
const KILL_MARGIN_MS = 20_000;

/** Parse argv into { providers, timeoutSeconds, prompt }. */
function parseArgs(argv) {
  const providers = [];
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  let prompt = DEFAULT_PROMPT;
  for (const arg of argv) {
    if (arg.startsWith("--timeout=")) timeoutSeconds = Number(arg.slice("--timeout=".length));
    else if (arg.startsWith("--prompt=")) prompt = arg.slice("--prompt=".length);
    else if (!arg.startsWith("--")) providers.push(arg);
  }
  return {
    providers: providers.length > 0 ? providers : DEFAULT_PROVIDERS,
    timeoutSeconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : DEFAULT_TIMEOUT_SECONDS,
    prompt,
  };
}

/** Run one `bridge ask --provider <id> --json` and resolve its captured streams. */
function runAsk(provider, prompt, timeoutSeconds) {
  return new Promise((done) => {
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [
        BRIDGE,
        "ask",
        prompt,
        "--provider",
        provider,
        "--json",
        "--timeout",
        String(timeoutSeconds),
      ],
      { cwd: REPO_ROOT },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const killTimer = setTimeout(
      () => child.kill("SIGKILL"),
      timeoutSeconds * 1000 + KILL_MARGIN_MS,
    );
    child.on("close", (code) => {
      clearTimeout(killTimer);
      done({ code, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      done({
        code: -1,
        stdout,
        stderr: `${stderr}\n${String(err)}`,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

/** Pull the last brace-delimited JSON line out of stdout (the ask payload). */
function parseReplyJson(stdout) {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"))
    .at(-1);
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Last non-empty line of stderr — the `fail()` reason on a non-zero exit. */
function lastStderrLine(stderr) {
  return (
    stderr
      .split("\n")
      // biome-ignore lint: strip ANSI colour codes fail() wraps the message in.
      .map((l) => l.replace(/\[[0-9;]*m/g, "").trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

/** Classify a finished run into a status + human-readable detail. */
function classify(result) {
  const payload = result.code === 0 ? parseReplyJson(result.stdout) : null;
  if (result.code === 0 && payload) {
    const reply = String(payload.reply ?? "").trim();
    if (reply.length > 0) {
      return {
        status: "PASS",
        model: payload.model ?? "",
        detail: reply.replace(/\s+/g, " ").slice(0, 80),
      };
    }
    return { status: "EMPTY", model: payload.model ?? "", detail: "reply captured was empty" };
  }
  const reason = lastStderrLine(result.stderr);
  if (/not signed in|composer not found|logged in|\blog ?in\b|sign in/i.test(reason)) {
    return { status: "SIGNED_OUT", model: "", detail: reason };
  }
  if (/browser not connected/i.test(reason)) return { status: "ATTACH", model: "", detail: reason };
  if (/timed out|timeout/i.test(reason) || result.code === null) {
    return { status: "TIMEOUT", model: "", detail: reason || "killed by wall-clock guard" };
  }
  return { status: "FAIL", model: "", detail: reason || `exit ${result.code}` };
}

const ICON = {
  PASS: "✓",
  SIGNED_OUT: "○",
  EMPTY: "▵",
  TIMEOUT: "…",
  ATTACH: "⚠",
  FAIL: "✗",
};

function printRow(provider, verdict, elapsedMs) {
  const secs = `${(elapsedMs / 1000).toFixed(1)}s`.padStart(6);
  const icon = ICON[verdict.status] ?? "?";
  const model = verdict.model ? ` [${verdict.model}]` : "";
  console.log(
    `  ${icon} ${provider.padEnd(11)} ${verdict.status.padEnd(11)} ${secs}${model}  ${verdict.detail}`,
  );
}

async function main() {
  const { providers, timeoutSeconds, prompt } = parseArgs(process.argv.slice(2));
  console.log(
    `Verifying ${providers.length} provider(s) sequentially via \`bridge ask --json\` (timeout ${timeoutSeconds}s each).`,
  );
  console.log(`Prompt: ${JSON.stringify(prompt)}\n`);

  const rows = [];
  for (const provider of providers) {
    process.stdout.write(`  … ${provider} — asking\r`);
    const result = await runAsk(provider, prompt, timeoutSeconds);
    const verdict = classify(result);
    printRow(provider, verdict, result.elapsedMs);
    rows.push({ provider, ...verdict, elapsedMs: result.elapsedMs, exitCode: result.code });
  }

  const tally = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nSummary: ${Object.entries(tally)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}`,
  );

  const needLogin = rows.filter((r) => r.status === "SIGNED_OUT").map((r) => r.provider);
  if (needLogin.length > 0) {
    console.log("\nNot signed in (run once, then re-verify):");
    for (const p of needLogin) console.log(`  node dist/bridge.js login --provider ${p}`);
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, "report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify({ prompt, timeoutSeconds, rows }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`\nReport: ${reportPath}`);

  // Green when nothing is genuinely broken — SIGNED_OUT is a login gap, not a bug.
  const broken = rows.filter((r) => !["PASS", "SIGNED_OUT"].includes(r.status));
  process.exit(broken.length > 0 ? 1 : 0);
}

await main();
