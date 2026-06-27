import type { Page } from "playwright";
import type { Message } from "../domain/types.ts";
import type { OrchestratorEvent } from "./orchestrator.types.ts";

/** Require a connected page or emit an error and return null. */
export function requirePage(page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected." });
  return null;
}

/** Require a connected page for prompt sending (distinct error message). */
export function requirePageForPrompt(page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
  return null;
}

/** Build a domain Message for a given role and content. */
export function buildMessage(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
}

/** Format an unknown error as a string. */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Create a simple pub/sub emitter for orchestrator events. */
export function createOrchestratorEmitter() {
  const state = { listeners: [] as Array<(event: OrchestratorEvent) => void> };
  return {
    on(fn: (event: OrchestratorEvent) => void) {
      state.listeners.push(fn);
      return () => {
        state.listeners = state.listeners.filter((listener) => listener !== fn);
      };
    },
    emit(event: OrchestratorEvent) {
      for (const fn of state.listeners) fn(event);
    },
  };
}

/** Map provider-captured messages to domain Message objects. */
export function mapCapturedMessages(captured: Array<{ role: string; content: string }>): Message[] {
  return captured
    .filter((message): message is { role: "user" | "assistant"; content: string } =>
      (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0,
    )
    .map((message) => mapCapturedMessage(message));
}

/** Map one captured DOM message to a domain Message. */
function mapCapturedMessage(message: { role: "user" | "assistant"; content: string }): Message {
  return {
    id: `dom-${crypto.randomUUID()}`,
    role: message.role,
    content: message.content,
    timestamp: Date.now(),
  };
}
