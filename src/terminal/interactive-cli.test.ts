import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartEngineSettings } from "@/bridge/bridge-engine-types.ts";
import { registerCliCommands } from "@/terminal/register-cli.ts";

const ENGINE_START_STOPPED_BY_TEST = "engine start stopped by test";

const startEngine = vi.hoisted(() =>
  vi.fn<(settings: StartEngineSettings) => Promise<never>>(async () => {
    throw new Error(ENGINE_START_STOPPED_BY_TEST);
  }),
);

vi.mock("@/bridge/bridge-engine.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/bridge/bridge-engine.ts")>()),
  startEngine,
}));

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

const setTerminal = (isTerminal: boolean): void => {
  Object.defineProperty(process.stdin, "isTTY", { value: isTerminal, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: isTerminal, configurable: true });
};

const readEngineStartSettings = async (argv: string[]): Promise<StartEngineSettings> => {
  const program = new Command();
  program.exitOverride();
  registerCliCommands(program);

  const attempt = program.parseAsync(["node", "bridge", ...argv]);
  await expect(attempt).rejects.toThrow(ENGINE_START_STOPPED_BY_TEST);

  const call = startEngine.mock.calls.at(-1);

  const isCallMissing = call == null;
  if (isCallMissing) throw new Error("Expected the TUI to start the engine");

  return call[0];
};

describe("runInteractiveCli", () => {
  beforeEach(() => {
    setTerminal(true);
    startEngine.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTty,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTty,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("starts the engine on the debug port and profile given to the root command", async () => {
    const settings = await readEngineStartSettings([
      "--debug-port",
      "9223",
      "--profile",
      "/bridge-test/profile",
    ]);

    expect(settings).toMatchObject({
      debugPort: 9223,
      profileRoot: "/bridge-test/profile",
    });
  });

  it("starts the engine with the default debug port when --debug-port is not given", async () => {
    const settings = await readEngineStartSettings([]);

    expect(settings.debugPort).toBeUndefined();
    expect(settings.profileRoot).toBeNull();
  });
});
