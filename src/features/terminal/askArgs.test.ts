import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskOptions } from "./cliTypes.ts";
import { registerCliCommands } from "./registerCli.ts";

const runAsk = vi.hoisted(() =>
  vi.fn<(prompt: string, options: AskOptions) => Promise<void>>(async () => {}),
);

vi.mock("./cliOperations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cliOperations.ts")>()),
  runAsk,
}));

const askCallFrom = async (argv: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerCliCommands(program);
  await program.parseAsync(["node", "bridge", "ask", ...argv]);
  const call = runAsk.mock.calls.at(-1);
  if (!call) throw new Error("Expected bridge ask to run");
  return { prompt: call[0], options: call[1] };
};

describe("bridge ask argument wiring", () => {
  beforeEach(() => runAsk.mockClear());

  it("passes a single-word prompt verbatim", async () => {
    await expect(askCallFrom(["hello"])).resolves.toMatchObject({ prompt: "hello" });
  });

  it("joins prompt words without including options", async () => {
    await expect(askCallFrom(["Reply", "with", "exactly:", "OK", "--json"])).resolves.toEqual({
      prompt: "Reply with exactly: OK",
      options: expect.objectContaining({ json: true }),
    });
  });

  it("keeps repository options out of the prompt", async () => {
    const call = await askCallFrom(["explain", "this", "repo", "--repo", "/tmp/x"]);
    expect(call.prompt).toBe("explain this repo");
    expect(call.prompt).not.toContain("[object Object]");
  });
});
