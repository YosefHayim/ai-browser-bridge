import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bridgeDir,
  chromeProfileDir,
  configPath,
  ensureBridgeDir,
  logsDir,
  sessionsDir,
} from "../../../src/features/store/paths.ts";

describe("repo-local path resolution", () => {
  it("scopes every state location under <repo>/.bridge", () => {
    const repo = "/tmp/example-repo";
    expect(bridgeDir(repo)).toBe("/tmp/example-repo/.bridge");
    expect(configPath(repo)).toBe("/tmp/example-repo/.bridge/config.json");
    expect(logsDir(repo)).toBe("/tmp/example-repo/.bridge/logs");
    expect(sessionsDir(repo)).toBe("/tmp/example-repo/.bridge/sessions");
    expect(chromeProfileDir(repo)).toBe("/tmp/example-repo/.bridge/chrome-profile");
    expect(chromeProfileDir(repo, "gemini")).toBe("/tmp/example-repo/.bridge/chrome-profile-gemini");
  });
});

describe("ensureBridgeDir self-ignore (the public-repo safety net)", () => {
  it("makes git ignore everything in .bridge — login cookies and transcripts included", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-ignore-"));
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: repo }).toString();
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");

    await ensureBridgeDir(repo);
    // The exact things the ADR says must never enter a public repo.
    await mkdir(chromeProfileDir(repo), { recursive: true });
    await writeFile(join(chromeProfileDir(repo), "Cookies"), "SECRET_SESSION_COOKIE");
    await mkdir(join(sessionsDir(repo), "s1"), { recursive: true });
    await writeFile(join(sessionsDir(repo), "s1", "events.jsonl"), '{"prompt":"private"}\n');
    await writeFile(join(repo, "README.md"), "# tracked\n");

    expect(await readFile(join(bridgeDir(repo), ".gitignore"), "utf-8")).toBe("*\n");

    git("add", "-A");
    const tracked = git("ls-files");
    expect(tracked).toContain("README.md");
    expect(tracked).not.toContain(".bridge/");

    // Even explicitly naming the ignored dir does not stage it; only `-f` could.
    try {
      git("add", ".bridge/");
    } catch {
      // git refuses to add ignored paths and exits non-zero — that is the point.
    }
    expect(git("ls-files")).not.toContain(".bridge/");

    const ignored = git(
      "check-ignore",
      "-v",
      join(".bridge", "chrome-profile", "Cookies"),
      join(".bridge", "sessions", "s1", "events.jsonl"),
    );
    expect(ignored).toContain(".bridge/chrome-profile/Cookies");
    expect(ignored).toContain(".bridge/sessions/s1/events.jsonl");
  });

  it("re-asserts the ignore file on every call so a deleted one heals", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-ignore-"));
    await ensureBridgeDir(repo);
    await writeFile(join(bridgeDir(repo), ".gitignore"), "# tampered\n");
    await ensureBridgeDir(repo);
    expect(await readFile(join(bridgeDir(repo), ".gitignore"), "utf-8")).toBe("*\n");
  });
});
