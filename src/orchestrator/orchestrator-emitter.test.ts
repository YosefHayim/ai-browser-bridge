import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "@/orchestrator/orchestrator.ts";
import { OrchestratorEmitter } from "@/orchestrator/orchestrator-emitter.ts";

describe("OrchestratorEmitter", () => {
  it("sends events to listeners until they unsubscribe", () => {
    const emitter = new OrchestratorEmitter();
    const receivedEvents: OrchestratorEvent[] = [];

    function collectEvent(event: OrchestratorEvent): void {
      receivedEvents.push(event);
    }

    const unsubscribe = emitter.subscribe(collectEvent);
    emitter.emit({ type: "reset" });
    unsubscribe();
    emitter.emit({ type: "reset" });

    expect(receivedEvents).toEqual([{ type: "reset" }]);
  });
});
