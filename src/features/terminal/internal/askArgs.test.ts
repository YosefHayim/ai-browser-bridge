import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCliCommands } from "../registerCli.ts";
import type { CliRunner } from "./cliRunner.ts";

/**
 * Guards the variadic `ask <prompt...>` wiring. Commander hands the action
 * `(promptParts, options, command)`; an earlier `args.slice(0, -1).join(" ")`
 * swept the options object into the prompt, sending ChatGPT a literal trailing
 * `[object Object]`. These tests assert the prompt reaching `runAsk` is exactly
 * the user's words, options excluded.
 */

/** Captured arguments from the most recent `runAsk` call. */
interface AskCall {
  prompt: string;
  options: { json?: boolean; repo?: string };
}

/** Build a CliRunner stub that records the prompt/options passed to runAsk. */
function stubRunner(calls: AskCall[]): CliRunner {
  return {
    runAsk: async (prompt: string, options: AskCall["options"]): Promise<void> => {
      calls.push({ prompt, options });
    },
  } as unknown as CliRunner;
}

/** Parse a fake `bridge ask ...` argv through the real command registration. */
function parseAsk(argv: string[]): AskCall {
  const calls: AskCall[] = [];
  const program = new Command();
  program.exitOverride();
  registerCliCommands(program, stubRunner(calls));
  program.parse(["node", "bridge", "ask", ...argv]);
  const [call] = calls;
  if (!call) throw new Error("expected runAsk to be invoked exactly once");
  return call;
}

describe("bridge ask argument wiring", () => {
  it("passes a single-word prompt verbatim", () => {
    expect(parseAsk(["hello"]).prompt).toBe("hello");
  });

  it("joins multi-word prompts with single spaces and drops options", () => {
    const call = parseAsk(["Reply", "with", "exactly:", "OK", "--json"]);
    expect(call.prompt).toBe("Reply with exactly: OK");
    expect(call.options.json).toBe(true);
  });

  it("never appends a stringified options object to the prompt", () => {
    const call = parseAsk(["explain", "this", "repo", "--repo", "/tmp/x"]);
    expect(call.prompt).toBe("explain this repo");
    expect(call.prompt).not.toContain("[object Object]");
  });
});
