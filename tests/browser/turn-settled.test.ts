import { describe, expect, it } from "vitest";
import { isTurnSettled } from "../../src/browser/chatgpt-page.ts";

describe("isTurnSettled", () => {
  it("never settles while streaming, even after a long quiet window", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        assetCount: 0,
        streaming: true,
        stableForMs: 10_000,
      }),
    ).toBe(false);
  });

  it("settles a text turn once it holds past the short quiet window", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        assetCount: 0,
        streaming: false,
        stableForMs: 1_600,
      }),
    ).toBe(true);
  });

  it("does not settle a text turn before the short quiet window elapses", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        assetCount: 0,
        streaming: false,
        stableForMs: 1_000,
      }),
    ).toBe(false);
  });

  it("never settles on transient placeholder text", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: true,
        assetCount: 0,
        streaming: false,
        stableForMs: 5_000,
      }),
    ).toBe(false);
  });

  it("settles a multi-image turn once it holds past the longer asset window", () => {
    expect(
      isTurnSettled({
        hasText: false,
        isTransientText: false,
        assetCount: 2,
        streaming: false,
        stableForMs: 2_600,
      }),
    ).toBe(true);
  });

  it("keeps waiting on an image turn until the longer asset window is met", () => {
    expect(
      isTurnSettled({
        hasText: false,
        isTransientText: false,
        assetCount: 2,
        streaming: false,
        stableForMs: 2_000,
      }),
    ).toBe(false);
  });

  it("never settles an empty, asset-less turn", () => {
    expect(
      isTurnSettled({
        hasText: false,
        isTransientText: false,
        assetCount: 0,
        streaming: false,
        stableForMs: 9_999,
      }),
    ).toBe(false);
  });
});
