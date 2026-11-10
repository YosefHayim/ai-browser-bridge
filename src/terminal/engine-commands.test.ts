import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCliCommands } from "@/terminal/register-cli.ts";

const terminateChromeOnDebugPort = vi.hoisted(() =>
  vi.fn<(debugPort: number, profileRoot: string) => Promise<boolean>>(async () => false),
);

vi.mock("@/browser/browser-session.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/browser/browser-session.ts")>()),
  terminateChromeOnDebugPort,
}));

const runCommandWithArgv = async (argv: string[]): Promise<void> => {
  const program = new Command();
  program.exitOverride();
  registerCliCommands(program);
  await program.parseAsync(["node", "bridge", ...argv]);
};

describe("runStop", () => {
  beforeEach(() => {
    terminateChromeOnDebugPort.mockClear();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the bridge Chrome on the debug port given to chrome stop", async () => {
    await runCommandWithArgv(["chrome", "stop", "--debug-port", "9223"]);

    expect(terminateChromeOnDebugPort).toHaveBeenCalledWith(9223, expect.any(String));
  });

  it("closes the Chrome that uses the profile given to chrome stop", async () => {
    await runCommandWithArgv([
      "chrome",
      "stop",
      "--debug-port",
      "9223",
      "--profile",
      "/bridge-test/profile",
    ]);

    expect(terminateChromeOnDebugPort).toHaveBeenCalledWith(9223, "/bridge-test/profile");
  });

  it("closes the bridge Chrome on port 9222 when no debug port is given", async () => {
    await runCommandWithArgv(["stop"]);

    expect(terminateChromeOnDebugPort).toHaveBeenCalledWith(9222, expect.any(String));
  });
});
