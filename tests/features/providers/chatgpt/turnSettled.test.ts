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
});
