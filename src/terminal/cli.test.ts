import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.ts";
import { readCliFailureMessage } from "./cli-failure.ts";

const captureStderr = (): string[] => {
  const stderrWrites: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  return stderrWrites;
};

describe("runCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a thrown error as one line and returns exit code 1", async () => {
    const stderrWrites = captureStderr();
    const exitCode = await runCli(["node", "bridge", "download", "--provider", "foo", "--json"]);
    expect(exitCode).toBe(1);
    expect(stderrWrites).toHaveLength(1);
    expect(stderrWrites[0]).toMatch(/^Unknown provider "foo"\. Valid providers: chatgpt, .+\n$/);
  });

  it("offers --debug-port and --profile on chatgpt inspect and returns exit code 0", async () => {
    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    const exitCode = await runCli(["node", "bridge", "chatgpt", "inspect", "--help"]);
    expect(exitCode).toBe(0);
    const helpPage = stdoutWrites.join("");
    expect(helpPage).toContain("--debug-port <number>");
    expect(helpPage).toContain("--profile <path>");
  });
});

describe("cliFailureMessage", () => {
  it("uses the error message without the stack", () => {
    expect(readCliFailureMessage(new Error("Unsupported image type: notes.txt"))).toBe(
      "Unsupported image type: notes.txt",
    );
  });

  it("prints non-Error values as text", () => {
    expect(readCliFailureMessage("Chrome closed")).toBe("Chrome closed");
  });
});
