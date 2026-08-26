import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { chatTargetsFrom, scheduledTaskPrompt } from "./cliOperations.ts";
import { registerCliCommands } from "./registerCli.ts";

describe("scheduledTaskPrompt", () => {
  it("adds a recurring cadence with --every", () => {
    expect(scheduledTaskPrompt("summarize my inbox", { every: "day" })).toBe(
      "Set up a ChatGPT scheduled task: summarize my inbox. Schedule it to run every day.",
    );
  });

  it("adds a one-off time with --at", () => {
    expect(scheduledTaskPrompt("email the report", { at: "tomorrow 9am" })).toBe(
      "Set up a ChatGPT scheduled task: email the report. Schedule it to run at tomorrow 9am.",
    );
  });

  it("omits the schedule clause and trims when neither flag is set", () => {
    expect(scheduledTaskPrompt("  do a thing  ", {})).toBe(
      "Set up a ChatGPT scheduled task: do a thing.",
    );
  });
});

describe("chatTargetsFrom", () => {
  it("prefers the --id list over the positional title, trimming each id", () => {
    expect(chatTargetsFrom("Some Title", { id: ["a", " b "] })).toEqual(["a", "b"]);
  });

  it("falls back to the trimmed positional when no ids are given", () => {
    expect(chatTargetsFrom("  My Chat  ", {})).toEqual(["My Chat"]);
  });

  it("returns an empty list when neither ids nor a positional are supplied", () => {
    expect(chatTargetsFrom("   ", { id: [] })).toEqual([]);
  });
});

describe("workspace command registration", () => {
  const registeredProgram = () => {
    const program = new Command();
    registerCliCommands(program);
    return program;
  };
  const subNames = (program: Command, group: string): string[] => {
    const groupCommand = program.commands.find((c) => c.name() === group);
    if (groupCommand === undefined) return [];
    return groupCommand.commands.map((c) => c.name());
  };

  it("registers the project, chat, and task command groups", () => {
    const names = registeredProgram().commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["project", "chat", "task"]));
  });

  it("registers project, chat organization, and task subcommands", () => {
    const program = registeredProgram();
    expect(subNames(program, "project")).toEqual(
      expect.arrayContaining(["list", "create", "rename", "delete"]),
    );
    expect(subNames(program, "chat")).toEqual(
      expect.arrayContaining(["list", "search", "move", "archive", "organize"]),
    );
    expect(subNames(program, "task")).toEqual(expect.arrayContaining(["list", "create"]));
  });

  it("registers the flow group with clip, ingredient + project CRUD subcommands", () => {
    const program = registeredProgram();
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
