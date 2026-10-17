import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.ts";
import { cliFailureMessage } from "./cliFailure.ts";

// Thrown by the fake exit so assertions can observe process.exit without ending the test process.
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

const captureStderr = (): string[] => {
  const stderrWrites: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  return stderrWrites;
};

const fakeExit = (): void => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitSignal(Number(code));
  });
};

describe("runCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a thrown error as one line and exits 1", async () => {
    const stderrWrites = captureStderr();
    fakeExit();
    const run = runCli(["node", "bridge", "download", "--provider", "foo", "--json"]);
    await expect(run).rejects.toMatchObject({ code: 1 });
    expect(stderrWrites).toHaveLength(1);
    expect(stderrWrites[0]).toMatch(/^Unknown provider "foo"\. Valid providers: chatgpt, .+\n$/);
  });
});

describe("cliFailureMessage", () => {
  it("uses the error message without the stack", () => {
    expect(cliFailureMessage(new Error("Unsupported image type: notes.txt"))).toBe(
      "Unsupported image type: notes.txt",
    );
  });

  it("prints non-Error values as text", () => {
    expect(cliFailureMessage("Chrome closed")).toBe("Chrome closed");
  });
});
