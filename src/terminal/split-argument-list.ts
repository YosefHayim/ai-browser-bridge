export const splitArgumentList = (details: string): string[] => {
  const argumentList: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of details.trim()) {
    const next = consumeSplitChar({ char, quote, current, args: argumentList });
    current = next.current;
    quote = next.quote;
  }

  return finalizeSplitArgumentList({ current, args: argumentList });
};

const finalizeSplitArgumentList = (details: { current: string; args: string[] }): string[] => {
  // Empty current means no trailing token ("" is a valid string, not "absent").
  const isCurrentNotEmpty = details.current !== "";
  if (isCurrentNotEmpty) details.args.push(details.current);

  return details.args;
};

const consumeSplitChar = (details: {
  char: string;
  quote: "'" | '"' | null;
  current: string;
  args: string[];
}): { current: string; quote: "'" | '"' | null } => {
  if ((details.char === "'" || details.char === '"') && details.quote == null) {
    return { current: details.current, quote: details.char };
  }

  if (details.char === details.quote) return { current: details.current, quote: null };

  if (/\s/.test(details.char) && details.quote == null) {
    const isCurrentNotEmpty = details.current !== "";
    if (isCurrentNotEmpty) details.args.push(details.current);

    return { current: "", quote: details.quote };
  }

  return { current: details.current + details.char, quote: details.quote };
};
