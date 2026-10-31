import { describe, expect, it, vi } from "vitest";
import { applyAskPreflight } from "./cliOperations.ts";

type PreflightEngine = Parameters<typeof applyAskPreflight>[0]["engine"];

const engineWithSwitch = (switchModel: () => Promise<string>): PreflightEngine => {
  const orchestrator = { switchModel };
  return { getOrchestrator: () => orchestrator } as unknown as PreflightEngine;
};

describe("applyAskPreflight model switch", () => {
  it("switches to the requested model", async () => {
    const switchModel = vi.fn().mockResolvedValue("GPT-5");
    await applyAskPreflight({ engine: engineWithSwitch(switchModel), options: { model: "gpt-5" } });
    expect(switchModel).toHaveBeenCalledWith("gpt-5");
  });

  it("reports a failed switch with the model and the reason", async () => {
    const switchModel = vi.fn().mockRejectedValue(new Error("The model menu showed: GPT-5."));
    const attempt = applyAskPreflight({
      engine: engineWithSwitch(switchModel),
      options: { model: "o9" },
    });
    await expect(attempt).rejects.toThrow(
      'Could not switch to model "o9": The model menu showed: GPT-5.',
    );
  });

  it("does nothing when no model is requested", async () => {
    const switchModel = vi.fn();
    await applyAskPreflight({ engine: engineWithSwitch(switchModel), options: {} });
    expect(switchModel).not.toHaveBeenCalled();
  });
});
