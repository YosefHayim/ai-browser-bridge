import { describe, expect, it } from "vitest";
import { DESIGN_TEMPLATES, findDesignLabel } from "./design-composer.ts";

describe("matchDesignLabel", () => {
  const models = ["Fable 5.1", "Opus 5.5", "Sonnet 5.5", "Haiku 4.5"];

  it("prefers an exact label, then a prefix, then a substring", () => {
    expect(findDesignLabel("Haiku 4.5", models)).toBe("Haiku 4.5");
    expect(findDesignLabel("haiku", models)).toBe("Haiku 4.5");
    expect(findDesignLabel("5.5", models)).toBe("Opus 5.5");
  });

  it("ignores case, accents, and punctuation in template names", () => {
    expect(findDesignLabel("resume", DESIGN_TEMPLATES)).toBe("Résumé");
    expect(findDesignLabel("color + type", DESIGN_TEMPLATES)).toBe("Color + type pairing");
    expect(findDesignLabel("Blank", ["Blank — start from scratch", "Slides"])).toBe(
      "Blank — start from scratch",
    );
  });

  it("finds nothing for an unknown or empty query", () => {
    expect(findDesignLabel("gpt-5", models)).toBeUndefined();
    expect(findDesignLabel("  ", models)).toBeUndefined();
  });
});
