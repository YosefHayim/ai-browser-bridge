import { describe, expect, it } from "vitest";
import {
  countExpectedImageMarkers,
  isTurnSettled,
} from "../../../../src/features/providers/chatgpt/chatgptPage.ts";

function settledState(overrides: Partial<Parameters<typeof isTurnSettled>[0]> = {}) {
  return {
    hasText: false,
    isTransientText: false,
    assetCount: 0,
    loadedAssetCount: 0,
    pendingAssetCount: 0,
    expectedImageMarkerCount: 0,
    streaming: false,
    stableForMs: 0,
    expectImages: 0,
    sawImageActivity: false,
    msSinceImageActivity: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

describe("countExpectedImageMarkers", () => {
  it("counts image markers in assistant text", () => {
    expect(countExpectedImageMarkers("[image-12][image-13]")).toBe(2);
  });
});

describe("isTurnSettled", () => {
  it("never settles while streaming, even after a long quiet window", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          streaming: true,
          stableForMs: 10_000,
        }),
      ),
    ).toBe(false);
  });

  it("settles a text turn once it holds past the short quiet window", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          stableForMs: 1_600,
        }),
      ),
    ).toBe(true);
  });

  it("does not settle a text turn before the short quiet window elapses", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          stableForMs: 1_000,
        }),
      ),
    ).toBe(false);
  });

  it("never settles on transient placeholder text", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          isTransientText: true,
          stableForMs: 5_000,
        }),
      ),
    ).toBe(false);
  });

  it("does not settle when image markers appear before images finish loading", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          expectedImageMarkerCount: 2,
          loadedAssetCount: 0,
          stableForMs: 20_000,
        }),
      ),
    ).toBe(false);
  });

  it("does not settle while generated images are still pending", () => {
    expect(
      isTurnSettled(
        settledState({
          assetCount: 2,
          loadedAssetCount: 1,
          pendingAssetCount: 1,
          stableForMs: 20_000,
        }),
      ),
    ).toBe(false);
  });

  it("settles a loaded image turn once it holds past the longer asset window", () => {
    expect(
      isTurnSettled(
        settledState({
          assetCount: 2,
          loadedAssetCount: 2,
          expectedImageMarkerCount: 2,
          stableForMs: 12_600,
        }),
      ),
    ).toBe(true);
  });

  it("keeps waiting on an image turn until the longer asset window is met", () => {
    expect(
      isTurnSettled(
        settledState({
          assetCount: 2,
          loadedAssetCount: 2,
          stableForMs: 11_999,
        }),
      ),
    ).toBe(false);
  });

  it("never settles an empty, asset-less turn", () => {
    expect(
      isTurnSettled(
        settledState({
          stableForMs: 9_999,
        }),
      ),
    ).toBe(false);
  });

  it("does not bail to text before requested images (--images) appear", () => {
    expect(
      isTurnSettled(
        settledState({
          hasText: true,
          expectImages: 10,
          loadedAssetCount: 0,
          stableForMs: 2_000,
        }),
      ),
    ).toBe(false);
  });

  it("holds a requested-image turn until every tile has loaded", () => {
    expect(
      isTurnSettled(
        settledState({
          expectImages: 10,
          assetCount: 4,
          loadedAssetCount: 4,
          stableForMs: 20_000,
        }),
      ),
    ).toBe(false);
  });

  it("keeps waiting while image tiles are still arriving on the network", () => {
    expect(
      isTurnSettled(
        settledState({
          expectImages: 10,
          assetCount: 10,
          loadedAssetCount: 10,
          stableForMs: 12_600,
          sawImageActivity: true,
          msSinceImageActivity: 3_000,
        }),
      ),
    ).toBe(false);
  });

  it("settles once all requested tiles have loaded and the image network is quiet", () => {
    expect(
      isTurnSettled(
        settledState({
          expectImages: 10,
          assetCount: 10,
          loadedAssetCount: 10,
          stableForMs: 12_600,
          sawImageActivity: true,
          msSinceImageActivity: 13_000,
        }),
      ),
    ).toBe(true);
  });

  it("settles a stopped-short image turn after the stall window instead of hanging", () => {
    expect(
      isTurnSettled(
        settledState({
          expectImages: 10,
          assetCount: 6,
          loadedAssetCount: 6,
          stableForMs: 46_000,
          sawImageActivity: true,
          msSinceImageActivity: 46_000,
        }),
      ),
    ).toBe(true);
  });
});
