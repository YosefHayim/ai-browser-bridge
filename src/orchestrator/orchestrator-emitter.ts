import type { OrchestratorEvent } from "@/orchestrator/orchestrator.ts";

export class OrchestratorEmitter {
  private listeners: Array<(event: OrchestratorEvent) => void> = [];

  subscribe = (listener: (event: OrchestratorEvent) => void): (() => void) => {
    this.listeners.push(listener);

    function isOtherListener(registered: (event: OrchestratorEvent) => void): boolean {
      return registered !== listener;
    }

    return () => {
      this.listeners = this.listeners.filter(isOtherListener);
    };
  };

  emit = (event: OrchestratorEvent): void => {
    for (const listener of this.listeners) listener(event);
  };
}
