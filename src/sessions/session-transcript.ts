import { MESSAGE_EVENT_TYPE, type SessionEvent } from "@/sessions/session-schemas.ts";

function readEventDetail(event: SessionEvent): string {
  const hasMessage = event.content != null;
  if (hasMessage) return event.content ?? "";

  const hasDetails = event.data != null;
  if (hasDetails) return JSON.stringify(event.data);

  return "";
}

function writeMessageTranscript(event: SessionEvent, prefix: string): string {
  const role = event.role ?? MESSAGE_EVENT_TYPE;
  const message = event.content ?? "";

  return `${prefix} ${role}: ${message}`;
}

function readTranscriptFieldSuffix(field: string | undefined): string {
  const isFieldBlank = field == null || field.length === 0;
  if (isFieldBlank) return "";

  return ` ${field}`;
}

function writeActionTranscript(event: SessionEvent, prefix: string): string {
  const name = readTranscriptFieldSuffix(event.name);
  const status = readTranscriptFieldSuffix(event.status);
  const detail = readEventDetail(event);

  const isDetailEmpty = detail.length === 0;
  if (isDetailEmpty) return `${prefix} action${name}${status}`;

  return `${prefix} action${name}${status}: ${detail}`;
}

function isFilled(part: string | undefined): part is string {
  return part != null && part.length > 0;
}

function writeGenericTranscript(event: SessionEvent, prefix: string): string {
  const labelParts = [event.type, event.name, event.status].filter(isFilled);
  const label = labelParts.join(" ");
  const detail = readEventDetail(event);

  const isDetailEmpty = detail.length === 0;
  if (isDetailEmpty) return `${prefix} ${label}`;

  return `${prefix} ${label}: ${detail}`;
}

function writeTranscriptEvent(event: SessionEvent): string {
  const prefix = `[${event.createdAt}]`;

  const isEventTypeMessage = event.type === MESSAGE_EVENT_TYPE;
  if (isEventTypeMessage) return writeMessageTranscript(event, prefix);

  const isEventTypeAction = event.type === "action";
  if (isEventTypeAction) return writeActionTranscript(event, prefix);

  return writeGenericTranscript(event, prefix);
}

export function writeTranscript(events: SessionEvent[]): string {
  return events.map(writeTranscriptEvent).join("\n");
}
