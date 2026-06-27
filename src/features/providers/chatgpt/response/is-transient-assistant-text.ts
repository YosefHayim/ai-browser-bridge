/** Context for {@link isTransientAssistantText}. */
export interface IsTransientAssistantTextContext {
  /** Normalized assistant response text to inspect. */
  text: string;
}

/** True when assistant text is a transient placeholder such as "Thinking…". */
export function isTransientAssistantText(ctx: IsTransientAssistantTextContext): boolean {
  const normalized = ctx.text.trim().toLowerCase();
  return normalized === "thinking"
    || normalized.endsWith(" thinking")
    || normalized.endsWith(" thinking...")
    || /^thinking[.\s]*$/.test(normalized);
}
