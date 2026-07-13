import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  clipIdFromSrc,
  clipUrlFromId,
  listClips,
  listIngredients,
  projectIdFromHref,
} from "./flowAssets.ts";

describe("clipIdFromSrc", () => {
  it("extracts the name uuid from a media redirect src", () => {
    expect(clipIdFromSrc("/fx/api/trpc/media.getMediaUrlRedirect?name=abc-123")).toBe("abc-123");
    expect(
      clipIdFromSrc(
        "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=e45b557f-abf1&x=1",
      ),
    ).toBe("e45b557f-abf1");
  });

  it("returns empty for non-media srcs", () => {
    expect(clipIdFromSrc("blob:https://labs.google/xyz")).toBe("");
    expect(clipIdFromSrc("")).toBe("");
  });

  it("url-decodes the id", () => {
    expect(clipIdFromSrc("?name=a%2Fb")).toBe("a/b");
  });
});

describe("projectIdFromHref", () => {
  it("extracts the project id from project and in-project scene hrefs", () => {
    expect(projectIdFromHref("/fx/tools/flow/project/abc")).toBe("abc");
    expect(projectIdFromHref("/fx/tools/flow/project/abc/edit/def")).toBe("abc");
    expect(projectIdFromHref("https://labs.google/fx/tools/flow/project/abc?x=1")).toBe("abc");
  });

  it("returns empty when there is no project segment", () => {
    expect(projectIdFromHref("/fx/tools/flow")).toBe("");
    expect(projectIdFromHref("")).toBe("");
  });
});

describe("clipUrlFromId", () => {
  it("builds an absolute media url", () => {
    expect(clipUrlFromId("abc-123")).toBe(
      "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=abc-123",
    );
  });

  it("encodes the id", () => {
    expect(clipUrlFromId("a b")).toContain("name=a%20b");
  });
});

describe("listClips", () => {
  it("dedups by id, skips non-media srcs, and preserves DOM order + index", async () => {
    const srcs = [
      "/fx/api/trpc/media.getMediaUrlRedirect?name=one",
      "/fx/api/trpc/media.getMediaUrlRedirect?name=two",
      "/fx/api/trpc/media.getMediaUrlRedirect?name=one", // duplicate id
      "blob:https://labs.google/skip-me", // not a media url
    ];
    // listClips maps document videos to srcs via page.evaluate; the fake returns them directly.
    const page = { evaluate: async () => srcs } as unknown as Page;

    const clips = await listClips(page);

    expect(clips.map((c) => c.id)).toEqual(["one", "two"]);
    expect(clips.map((c) => c.index)).toEqual([0, 1]);
    expect(clips.map((c) => c.url)).toEqual([
      "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=one",
      "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=two",
    ]);
  });
});

describe("listIngredients", () => {
  it("dedups by id and maps composer ingredient thumbnails to media ids", async () => {
    // listIngredients filters composer <img> by alt in-page; the fake returns the srcs.
    const srcs = [
      "/fx/api/trpc/media.getMediaUrlRedirect?name=ing-a",
      "/fx/api/trpc/media.getMediaUrlRedirect?name=ing-b",
      "/fx/api/trpc/media.getMediaUrlRedirect?name=ing-a", // duplicate id
    ];
    const page = { evaluate: async () => srcs } as unknown as Page;

    const ingredients = await listIngredients(page);

    expect(ingredients.map((i) => i.id)).toEqual(["ing-a", "ing-b"]);
    expect(ingredients.map((i) => i.index)).toEqual([0, 1]);
    expect(ingredients[0]?.url).toBe(
      "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=ing-a",
    );
  });
});
