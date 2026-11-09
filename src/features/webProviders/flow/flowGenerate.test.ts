import { afterEach, describe, expect, it, vi } from "vitest";
import { findFlowPromptEditor, readTopLeftClipSource } from "./flowGenerate.ts";

type VideoTile = {
  width: number;
  top: number;
  left: number;
  source: string | null;
  nestedSource?: string;
};

const showEditors = (sizes: Array<{ width: number; height: number }>) => {
  const editors = sizes.map((bounds) => ({ getBoundingClientRect: () => bounds }));
  vi.stubGlobal("document", { querySelectorAll: () => editors });
  return editors;
};

const showClips = (tiles: VideoTile[]) => {
  const videos = tiles.map((tile) => ({
    getBoundingClientRect: () => tile,
    getAttribute: () => tile.source,
    querySelector: () => {
      if (tile.nestedSource === undefined) return null;
      return { getAttribute: () => tile.nestedSource };
    },
  }));
  vi.stubGlobal("document", { querySelectorAll: () => videos });
};

afterEach(() => vi.unstubAllGlobals());

describe("Flow prompt editor selection", () => {
  it("chooses the largest usable editor and ignores narrow and collapsed inputs", () => {
    const editors = showEditors([
      { width: 100, height: 1000 },
      { width: 600, height: 5 },
      { width: 300, height: 50 },
      { width: 400, height: 100 },
    ]);
    const promptEditor = findFlowPromptEditor();
    expect(promptEditor).toBe(editors[3]);
  });

  it("keeps the first editor when two editors have equal area", () => {
    const editors = showEditors([
      { width: 300, height: 100 },
      { width: 600, height: 50 },
    ]);
    const promptEditor = findFlowPromptEditor();
    expect(promptEditor).toBe(editors[0]);
  });

  it("reports an absent editor when every input is too small", () => {
    showEditors([
      { width: 200, height: 100 },
      { width: 300, height: 10 },
    ]);
    const promptEditor = findFlowPromptEditor();
    expect(promptEditor).toBeNull();
  });
});

describe("Flow rendered clip selection", () => {
  it("chooses the top-left grid clip regardless of DOM order and skips thumbnails", () => {
    showClips([
      { width: 300, top: 200, left: 0, source: "lower" },
      { width: 300, top: 100, left: 100, source: "right" },
      { width: 50, top: 0, left: 0, source: "thumbnail" },
      { width: 300, top: 100, left: 0, source: "first" },
    ]);
    const clipSource = readTopLeftClipSource(100);
    expect(clipSource).toBe("first");
  });

  it("keeps a source-less first tile instead of mistaking an older clip for a new render", () => {
    showClips([
      { width: 300, top: 0, left: 0, source: null },
      { width: 300, top: 0, left: 400, source: "older-clip" },
    ]);
    const clipSource = readTopLeftClipSource(100);
    expect(clipSource).toBe("");
  });

  it("reads a nested source element and keeps the first tile when positions tie", () => {
    showClips([
      { width: 300, top: 0, left: 0, source: null, nestedSource: "nested-clip" },
      { width: 300, top: 0, left: 0, source: "second-clip" },
    ]);
    const clipSource = readTopLeftClipSource(100);
    expect(clipSource).toBe("nested-clip");
  });
});
