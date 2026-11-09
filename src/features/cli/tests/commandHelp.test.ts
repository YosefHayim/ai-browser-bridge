import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCliCommands } from "../registerCli.ts";

describe("command help", () => {
  it("prints available commands when invoked without a subcommand", async () => {
    let output = "";
    const program = new Command();
    program.configureOutput({ writeOut: (text) => (output += text) });
    registerCliCommands(program);

    await program.parseAsync(["node", "bridge"]);

    expect(output).toContain("Usage: bridge");
    expect(output).toContain("ask");
    expect(output).toContain("serve");
    expect(output).toContain("flow");
    expect(output).toContain("design");
    expect(output).not.toContain("--no-browser");
  });

  it("rejects the removed interactive browser flag", async () => {
    let errorOutput = "";
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: (text) => (errorOutput += text) });
    registerCliCommands(program);

    await expect(program.parseAsync(["node", "bridge", "--no-browser"])).rejects.toMatchObject({
      code: "commander.unknownOption",
      exitCode: 1,
    });
    expect(errorOutput).toContain("unknown option '--no-browser'");
  });
});
