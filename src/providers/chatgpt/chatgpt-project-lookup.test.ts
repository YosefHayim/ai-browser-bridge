import { describe, expect, it } from "vitest";
import { type ChatGptProject, lookUpProjectIds, projectIdNamed } from "./chatgpt-project-lookup.ts";

const FIXTURE_PROJECTS: ChatGptProject[] = [
  { id: "g-p-fixture-alpha", name: "Fixture Alpha" },
  { id: "g-p-fixture-beta", name: "Fixture Beta" },
];

describe("lookUpProjectIds", () => {
  it("returns the id of every planned Project when all of them exist", () => {
    const lookup = lookUpProjectIds(FIXTURE_PROJECTS, ["Fixture Alpha", "Fixture Beta"]);

    expect(lookup.problemMessage).toBeNull();
    expect(lookup.projectIdByName.get("Fixture Beta")).toBe("g-p-fixture-beta");
  });

  it("lists every planned name that no Project matches", () => {
    const lookup = lookUpProjectIds(FIXTURE_PROJECTS, ["Fixture Alpha", "Fixture Gamma"]);

    expect(lookup.problemMessage).toContain('"Fixture Gamma"');
    expect(lookup.projectIdByName.has("Fixture Gamma")).toBe(false);
  });

  it("reports a name that matches more than one Project as a problem", () => {
    const duplicatedProjects: ChatGptProject[] = [
      { id: "g-p-fixture-one", name: "Fixture Alpha" },
      { id: "g-p-fixture-two", name: "Fixture Alpha" },
    ];

    const lookup = lookUpProjectIds(duplicatedProjects, ["Fixture Alpha"]);

    expect(lookup.problemMessage).toContain('"Fixture Alpha"');
    expect(lookup.projectIdByName.has("Fixture Alpha")).toBe(false);
  });
});

describe("projectIdNamed", () => {
  it("returns the id that was looked up for the name", () => {
    const projectIdByName = new Map([["Fixture Alpha", "g-p-fixture-alpha"]]);

    const projectId = projectIdNamed(projectIdByName, "Fixture Alpha");

    expect(projectId).toBe("g-p-fixture-alpha");
  });

  it("throws when the name was never looked up", () => {
    const projectIdByName = new Map<string, string>();

    expect(() => projectIdNamed(projectIdByName, "Fixture Alpha")).toThrow(
      'No ChatGPT Project id was looked up for "Fixture Alpha".',
    );
  });
});
