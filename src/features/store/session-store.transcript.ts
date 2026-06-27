import type { SessionEvent } from "./session-store.types.ts";

/** Format all session events as a plain-text transcript. */
export function formatTranscript(events: SessionEvent[]): string {
  return events.map(formatTranscriptEvent).join("\n");
}

/** Format one session event as a transcript line. */
export function formatTranscriptEvent(event: SessionEvent): string {
  const prefix = `[${event.createdAt}]`;
  if (event.type === "message") return formatMessageEvent({ prefix, event });
  if (event.type === "action") return formatActionEvent({ prefix, event });
  return formatGenericEvent({ prefix, event });
}

/** Format a message event line. */
function formatMessageEvent(input: { prefix: string; event: SessionEvent }): string {
  return `${input.prefix} ${input.event.role ?? "message"}: ${input.event.content ?? ""}`;
}

/** Format an action event line. */
function formatActionEvent(input: { prefix: string; event: SessionEvent }): string {
  const name = input.event.name ? ` ${input.event.name}` : "";
  const status = input.event.status ? ` ${input.event.status}` : "";
  const detail = eventDetail(input.event);
  return detail ? `${input.prefix} action${name}${status}: ${detail}` : `${input.prefix} action${name}${status}`;
}

/** Format a generic event line. */
function formatGenericEvent(input: { prefix: string; event: SessionEvent }): string {
  const label = [input.event.type, input.event.name, input.event.status].filter(Boolean).join(" ");
  const detail = eventDetail(input.event);
  return detail ? `${input.prefix} ${label}: ${detail}` : `${input.prefix} ${label}`;
}

/** Resolve detail text from content or serialized data. */
function eventDetail(event: SessionEvent): string {
  return event.content ?? (event.data ? JSON.stringify(event.data) : "");
}
