#!/usr/bin/env node
// Dev-only live check for Claude Design through the REAL built CLI and `bridge serve`.
//
// Uses one scratch project and deletes it (and its duplicate) at the end, pass or fail.
// It spends two small turns: the first message from the home composer (Slides template,
// Sonnet 4.6 from "More models" / Low) and one MCP `design_send` on Haiku 4.5. Picking a
// model also sets the Claude Design default, so the default from before the run is
// restored at the end.
//
//   node dist/bridge.js chrome start --provider design   # signed in at claude.ai
//   node scripts/dev/verifyClaudeDesign.mjs
//
// Steps print PASS/FAIL; the exit code is 1 when any step failed.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = join(REPO_ROOT, "dist", "bridge.js");
const WORK_DIR = join(REPO_ROOT, ".bridge", "downloads", "design-verify");
const WORK_DIR_IN_REPO = ".bridge/downloads/design-verify";
const TURN_TIMEOUT_SECONDS = 600;
const STAMP = new Date().toISOString().replace(/[:.]/gu, "-");

const results = [];
const createdProjectIds = [];
const needsProject = new Set();
let projectId;
let conversationId;
let defaultModel;
let serveTransport;
let serveLog = "";

const record = (step, ok, detail) => {
  results.push({ step, ok });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  — ${detail}` : ""}\n`);
};

// Playwright appends its call log after the error; report the error line itself.
const failureLine = (stderr) => {
  const lines = stripVTControlCharacters(stderr)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errorLine = lines.find((line) => /error|failed|timeout|Claude Design/iu.test(line));
  if (errorLine !== undefined) return errorLine;
  return lines.at(-1);
};

const bridge = (args) => {
  const run = spawnSync("node", [BRIDGE, "design", ...args, "--repo", REPO_ROOT, "--json"], {
    encoding: "utf8",
    timeout: (TURN_TIMEOUT_SECONDS + 120) * 1000,
  });
  if (run.status !== 0) {
    throw new Error(`design ${args[0]} exited ${run.status}: ${failureLine(run.stderr)}`);
  }
  return JSON.parse(run.stdout.trim().split("\n").at(-1));
};

const step = async (name, check) => {
  if (needsProject.has(name) && projectId === undefined) {
    record(name, false, "skipped — no scratch project");
    return;
  }
  try {
    const detail = await check();
    record(name, true, detail);
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const toolJson = (toolCall) => {
  const text = toolCall.content?.[0]?.text;
  if (toolCall.isError) throw new Error(text);
  return JSON.parse(text);
};

await rm(WORK_DIR, { recursive: true, force: true });
await mkdir(WORK_DIR, { recursive: true });
await writeFile(join(WORK_DIR, "note.txt"), "first version\n");
await writeFile(join(WORK_DIR, "brief.txt"), "Brand color: #0A84FF\n");

const projectStep = (name, check) => {
  needsProject.add(name);
  return step(name, check);
};

const mcpClient = new Client({ name: "verify-claude-design", version: "0.0.0" });
try {
  await step("catalog lists templates, models with effort, design systems", () => {
    const catalog = bridge(["catalog"]);
    expect(catalog.templates.includes("Slides"), "no Slides template");
    defaultModel = catalog.models.find((model) => model.isDefault)?.label;
    const sonnet = catalog.models.find((model) => model.label === "Sonnet 4.6");
    expect(sonnet?.efforts.includes("Low"), "no Sonnet 4.6 with Low effort");
    expect(
      catalog.models.some((model) => model.label === "Haiku 4.5"),
      "no Haiku 4.5",
    );
    return `${catalog.models.length} models, ${catalog.designSystems.length} design systems`;
  });

  await step("create from the home composer (Slides, Sonnet 4.6 via More models, Low)", () => {
    const created = bridge([
      "create",
      "--name",
      `bridge-verify-${STAMP}`,
      "--template",
      "Slides",
      "--prompt",
      "a single title slide that says Bridge verify. Keep it minimal; no questions.",
      "--model",
      "Sonnet 4.6",
      "--effort",
      "Low",
      "--auto-decide",
      "--timeout",
      String(TURN_TIMEOUT_SECONDS),
    ]);
    projectId = created.projectId;
    createdProjectIds.push(projectId);
    expect(created.status === "replied", `status ${created.status}`);
    expect(created.model?.includes("Sonnet 4.6"), `model ${created.model}`);
    expect(
      created.messages.some((message) => message.role === "assistant"),
      "no assistant reply",
    );
    return `project ${projectId}`;
  });

  await projectStep("projects finds the new project by name", () => {
    const projects = bridge(["projects", "--query", `bridge-verify-${STAMP}`]);
    expect(
      projects.some((project) => project.id === projectId),
      "not listed",
    );
  });

  await projectStep("put, replace, download, and remove a file", async () => {
    bridge(["put", "--project", projectId, "--file", join(WORK_DIR, "note.txt")]);
    await writeFile(join(WORK_DIR, "note.txt"), "second version\n");
    bridge(["put", "--project", projectId, "--file", join(WORK_DIR, "note.txt")]);
    const files = bridge(["files", "--project", projectId]);
    expect(
      files.some((file) => file.path === "note.txt"),
      "note.txt not listed",
    );
    const downloaded = bridge([
      "download",
      "--project",
      projectId,
      "--path",
      "note.txt",
      "--out",
      join(WORK_DIR, "downloaded"),
    ]);
    const content = await readFile(downloaded.files[0], "utf8");
    expect(content === "second version\n", `downloaded ${JSON.stringify(content)}`);
    bridge(["rm", "--project", projectId, "--path", "note.txt", "--yes"]);
    const after = bridge(["files", "--project", projectId]);
    expect(!after.some((file) => file.path === "note.txt"), "note.txt still listed");
    return `${files.length} files before removal`;
  });

  await projectStep("MCP: bridge serve lists design_* and reads the Conversation", async () => {
    serveTransport = new StdioClientTransport({
      command: "node",
      args: [BRIDGE, "serve", "--repo", REPO_ROOT],
      stderr: "pipe",
    });
    serveTransport.stderr.on("data", (chunk) => {
      serveLog += chunk.toString();
    });
    await mcpClient.connect(serveTransport);
    const tools = (await mcpClient.listTools()).tools.map((tool) => tool.name);
    expect(tools.includes("design_send") && tools.includes("design_state"), "tools missing");
    const read = toolJson(
      await mcpClient.callTool({ name: "design_read_conversation", arguments: { projectId } }),
    );
    expect(read.messages.length >= 2, `only ${read.messages.length} messages`);
    conversationId = read.conversation.id;
    return `${tools.filter((tool) => tool.startsWith("design_")).length} design tools`;
  });

  await projectStep("MCP: design_send on Haiku 4.5 with an attachment", async () => {
    const sent = toolJson(
      await mcpClient.callTool(
        {
          name: "design_send",
          arguments: {
            projectId,
            message: "Reply with the single word OK. Do not change any files.",
            model: "Haiku 4.5",
            attachments: [`${WORK_DIR_IN_REPO}/brief.txt`],
            autoDecide: true,
            timeoutSeconds: TURN_TIMEOUT_SECONDS,
          },
        },
        undefined,
        { timeout: (TURN_TIMEOUT_SECONDS + 60) * 1000 },
      ),
    );
    expect(sent.status === "replied", `status ${sent.status}`);
    expect(sent.model?.includes("Haiku 4.5"), `model ${sent.model}`);
    const reply = sent.messages.findLast((message) => message.role === "assistant");
    expect(reply !== undefined, "no assistant reply");
    return reply.content.slice(0, 60);
  });

  await projectStep("new Conversation, rename it, read it back", () => {
    const created = bridge(["new-conversation", "--project", projectId]);
    expect(created.conversationId !== conversationId, "same conversation id");
    bridge([
      "rename-conversation",
      "--project",
      projectId,
      "--conversation",
      created.conversationId,
      "--title",
      "Verify chat",
    ]);
    const read = bridge(["read", "--project", projectId, "--conversation", created.conversationId]);
    expect(read.conversation.title === "Verify chat", `title ${read.conversation.title}`);
    expect(read.conversations.length >= 2, `${read.conversations.length} conversations`);
  });

  await projectStep("export the project zip", async () => {
    const exported = bridge(["export", "--project", projectId, "--out", WORK_DIR]);
    const archive = await readFile(exported.files[0]);
    expect(archive.subarray(0, 2).toString() === "PK", "not a zip");
    return `${archive.length} bytes`;
  });

  await projectStep("share access, rename, favorite, duplicate", () => {
    const shared = bridge([
      "share",
      "--project",
      projectId,
      "--access",
      "private",
      "--permission",
      "view",
    ]);
    expect(shared.sharing?.access === "private", `access ${shared.sharing?.access}`);
    const renamed = bridge([
      "rename",
      "--project",
      projectId,
      "--name",
      `bridge-verify-${STAMP}-renamed`,
    ]);
    expect(renamed.name.endsWith("-renamed"), `name ${renamed.name}`);
    bridge(["favorite", "--project", projectId]);
    bridge(["favorite", "--project", projectId, "--off"]);
    const duplicated = bridge(["duplicate", "--project", projectId]);
    createdProjectIds.push(duplicated.projectId);
  });

  await projectStep("state describes the open project tab", () => {
    const state = bridge(["state"]);
    expect(
      state.tabs.some((tab) => tab.projectId === projectId),
      "project tab not listed",
    );
    expect(state.manual.includes("Publish as artifact"), "manual destinations missing");
  });
} finally {
  await mcpClient.close().catch(() => undefined);
  if (results.some((result) => !result.ok) && serveLog.length > 0) {
    process.stdout.write(
      `\nbridge serve stderr (tail):\n${serveLog.split("\n").slice(-15).join("\n")}\n`,
    );
  }
  for (const createdProjectId of createdProjectIds) {
    await step(`delete ${createdProjectId}`, () => {
      bridge(["delete", "--project", createdProjectId, "--yes"]);
    });
  }
  if (defaultModel !== undefined) {
    await step(`restore the default model (${defaultModel})`, () => {
      bridge(["model", "--model", defaultModel]);
    });
  }
  await step("scratch projects are gone", () => {
    const left = bridge(["projects"]).filter((project) => createdProjectIds.includes(project.id));
    expect(left.length === 0, `${left.map((project) => project.id).join(", ")} left`);
  });
  await rm(WORK_DIR, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} steps passed\n`);
process.exit(failed === 0 ? 0 : 1);
