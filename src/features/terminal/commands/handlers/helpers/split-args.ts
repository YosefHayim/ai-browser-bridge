/** Split a command argument string into tokens, honouring single/double quotes. */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of input.trim()) {
    const next = consumeSplitChar({ char, quote, current, args });
    current = next.current;
    quote = next.quote;
  }

  return finalizeSplitArgs({ current, args });
}

/** Push trailing token when arg splitting finishes. */
function finalizeSplitArgs(input: { current: string; args: string[] }): string[] {
  if (input.current) input.args.push(input.current);
  return input.args;
}

function consumeSplitChar(input: {
  char: string;
  quote: "'" | '"' | null;
  current: string;
  args: string[];
}): { current: string; quote: "'" | '"' | null } {
  if ((input.char === "'" || input.char === '"') && input.quote === null) {
    return { current: input.current, quote: input.char };
  }
  if (input.char === input.quote) return { current: input.current, quote: null };
  if (/\s/.test(input.char) && input.quote === null) {
    if (input.current) input.args.push(input.current);
    return { current: "", quote: input.quote };
  }
  return { current: input.current + input.char, quote: input.quote };
}
