import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCliCommands } from "../registerCli.ts";
import { buildTaskPrompt } from "./cliRunner.ts";

describe("buildTaskPrompt", () => {
  it("adds a recurring cadence with --every", () => {
    expect(buildTaskPrompt("summarize my inbox", { every: "day" })).toBe(
      "Set up a ChatGPT scheduled task: summarize my inbox. Schedule it to run every day.",
    );
  });

  it("adds a one-off time with --at", () => {
    expect(buildTaskPrompt("email the report", { at: "tomorrow 9am" })).toBe(
      "Set up a ChatGPT scheduled task: email the report. Schedule it to run at tomorrow 9am.",
    );
  });

  it("omits the schedule clause and trims when neither flag is set", () => {
    expect(buildTaskPrompt("  do a thing  ", {})).toBe(
      "Set up a ChatGPT scheduled task: do a thing.",
    );
  });
});

describe("workspace command registration", () => {
  const build = () => {
    const program = new Command();
    registerCliCommands(program);
    return program;
  };
  const subNames = (program: Command, group: string): string[] =>
    program.commands.find((c) => c.name() === group)?.commands.map((c) => c.name()) ?? [];

  it("registers the project, chat, and task command groups", () => {
    const names = build().commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["project", "chat", "task"]));
  });

  it("registers project list/create, chat list/move, task list/create subcommands", () => {
    const program = build();
    expect(subNames(program, "project")).toEqual(expect.arrayContaining(["list", "create"]));
    expect(subNames(program, "chat")).toEqual(expect.arrayContaining(["list", "move"]));
    expect(subNames(program, "task")).toEqual(expect.arrayContaining(["list", "create"]));
  });

  it("registers the flow group with clip, ingredient + project CRUD subcommands", () => {
    const program = build();
    expect(program.commands.map((c) => c.name())).toEqual(expect.arrayContaining(["flow"]));
    expect(subNames(program, "flow")).toEqual(
      expect.arrayContaining([
        "clips",
        "projects",
        "download",
        "delete",
        "rename",
        "extend",
        "reuse",
        "project-rename",
        "project-delete",
        "ingredients",
        "ingredient-remove",
        "ingredient-clear",
      ]),
    );
  });
});
