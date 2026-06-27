interface SplitArgumentsInput {
  input: string;
}

/** Split a slash-command argument string respecting quotes. */
export function splitCommandArguments(input: SplitArgumentsInput | string): string[] {
  const text = typeof input === "string" ? input : input.input;
  const state = { args: [] as string[], current: "", quote: null as "'" | '"' | null };
  for (const char of text.trim()) {
    const next = consumeArgumentChar({ char, state });
    state.current = next.current;
    state.quote = next.quote;
  }
  if (state.current) state.args.push(state.current);
  return state.args;
}

function consumeArgumentChar(input: {
  char: string;
  state: { args: string[]; current: string; quote: "'" | '"' | null };
}): { current: string; quote: "'" | '"' | null } {
  const { char, state } = input;
  if ((char === "'" || char === '"') && state.quote === null) {
    return { current: state.current, quote: char };
  }
  if (char === state.quote) return { current: state.current, quote: null };
  if (/\s/.test(char) && state.quote === null) {
    if (state.current) state.args.push(state.current);
    return { current: "", quote: state.quote };
  }
  return { current: state.current + char, quote: state.quote };
}
