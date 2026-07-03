import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOOK_LIFECYCLE_EVENTS,
  hookConfigPaths,
  isHookLifecycleEvent,
  loadHooksConfig,
  parseHooksConfig,
  runHooks,
} from "./hooks.ts";

describe("hook lifecycle events", () => {
  it("exposes the supported event names", () => {
    expect(HOOK_LIFECYCLE_EVENTS).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "SessionEnd",
    ]);
  });

  it("validates lifecycle event names", () => {
    expect(isHookLifecycleEvent("PreToolUse")).toBe(true);
    expect(isHookLifecycleEvent("Unknown")).toBe(false);
  });
});

describe("parseHooksConfig", () => {
  it("parses object-style hook configs keyed by event", () => {
    const result = parseHooksConfig(
      {
        hooks: {
          SessionStart: [{ name: "hello", command: "echo hello" }],
          Stop: [{ command: ["node", "script.js"], enabled: false }],
        },
      },
      "inline",
    );

    expect(result.errors).toEqual([]);
    expect(result.hooks).toEqual([
      {
        source: "inline",
        event: "SessionStart",
        name: "hello",
        command: "echo hello",
        enabled: true,
      },
      {
        source: "inline",
        event: "Stop",
        command: ["node", "script.js"],
        enabled: false,
      },
    ]);
  });

  it("parses array-style hook configs", () => {
    const result = parseHooksConfig(
      {
        hooks: [{ event: "PreToolUse", command: "npm test" }],
      },
      "inline",
    );

    expect(result.errors).toEqual([]);
    expect(result.hooks[0]).toMatchObject({
      event: "PreToolUse",
      command: "npm test",
      enabled: true,
    });
  });

  it("reports invalid hook configs without throwing", () => {
    const result = parseHooksConfig(
      {
        hooks: {
          BadEvent: [{ command: "echo bad" }],
          SessionEnd: [{ command: 42 }],
        },
      },
      "inline",
    );

    expect(result.hooks).toEqual([]);
    expect(result.errors).toEqual([
      "inline: unsupported hook event BadEvent",
      "inline: SessionEnd[0].command must be a string or string array",
    ]);
  });
});

describe("loadHooksConfig", () => {
  it("loads local and user hook configs in deterministic order", async () => {
    const base = await mkdtemp(join(tmpdir(), "bridge-hooks-"));
    const repoRoot = join(base, "repo");
    const homeDir = join(base, "home");
    await mkdir(join(repoRoot, ".bridge"), { recursive: true });
    await mkdir(join(homeDir, ".ai-browser-bridge"), { recursive: true });
    await writeFile(
      join(repoRoot, ".bridge", "hooks.json"),
      JSON.stringify({ hooks: [{ event: "SessionStart", command: "local" }] }),
    );
    await writeFile(
      join(homeDir, ".ai-browser-bridge", "hooks.json"),
      JSON.stringify({ hooks: [{ event: "SessionEnd", command: "user" }] }),
    );

    expect(hookConfigPaths(repoRoot, homeDir)).toEqual([
      join(repoRoot, ".bridge", "hooks.json"),
      join(homeDir, ".ai-browser-bridge", "hooks.json"),
    ]);

    const loaded = await loadHooksConfig({ repoRoot, homeDir });

    expect(loaded.errors).toEqual([]);
    expect(loaded.hooks.map((hook) => [hook.event, hook.command])).toEqual([
      ["SessionStart", "local"],
      ["SessionEnd", "user"],
    ]);
  });
});

describe("runHooks", () => {
  it("returns skipped results because command execution is disabled", async () => {
    const result = parseHooksConfig({
      hooks: [
        { event: "PreToolUse", command: "npm test" },
        { event: "PreToolUse", command: "echo disabled", enabled: false },
      ],
    });

    const hookResults = await runHooks("PreToolUse", result.hooks);

    expect(hookResults).toEqual([
      {
        event: "PreToolUse",
        command: "npm test",
        status: "skipped",
        reason: "hook-command-execution-disabled",
      },
      {
        event: "PreToolUse",
        command: "echo disabled",
        status: "disabled",
        reason: "hook-disabled",
      },
    ]);
  });
});
