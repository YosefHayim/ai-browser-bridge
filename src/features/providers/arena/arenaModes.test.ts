import { describe, expect, it } from "vitest";
import { ARENA_MODE_URLS, arenaModeFromUrl, parseArenaMode } from "./arenaModes.ts";

describe("parseArenaMode", () => {
  it("resolves mode aliases", () => {
    expect(parseArenaMode("direct")).toBe("direct");
    expect(parseArenaMode("Battle Mode")).toBe("battle");
    expect(parseArenaMode("sbs")).toBe("side-by-side");
    expect(parseArenaMode("agent-mode")).toBe("agent");
  });

  it("returns null for model ids", () => {
    expect(parseArenaMode("glm-5.1")).toBeNull();
    expect(parseArenaMode("gpt-5.3-codex")).toBeNull();
  });
});

describe("arenaModeFromUrl", () => {
  it("maps live entry URLs", () => {
    expect(arenaModeFromUrl(ARENA_MODE_URLS.direct)).toBe("direct");
    expect(arenaModeFromUrl(ARENA_MODE_URLS.battle)).toBe("battle");
    expect(arenaModeFromUrl(ARENA_MODE_URLS.agent)).toBe("agent");
    expect(arenaModeFromUrl(ARENA_MODE_URLS["side-by-side"])).toBe("side-by-side");
  });
});
