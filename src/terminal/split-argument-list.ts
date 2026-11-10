export const splitArgumentList = (details: string): string[] => {
  const argumentList: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const character of details.trim()) {
    const next = consumeSplitCharacter({ character, quote, current, argumentList });
    current = next.current;
    quote = next.quote;
  }

  return finalizeSplitArgumentList({ current, argumentList });
};

const finalizeSplitArgumentList = (details: {
  current: string;
  argumentList: string[];
}): string[] => {
  // Empty current means no trailing token ("" is a valid string, not "absent").
  const isCurrentNotEmpty = details.current !== "";
  if (isCurrentNotEmpty) details.argumentList.push(details.current);

  return details.argumentList;
};

const consumeSplitCharacter = (details: {
  character: string;
  quote: "'" | '"' | null;
  current: string;
  argumentList: string[];
}): { current: string; quote: "'" | '"' | null } => {
  const { character } = details;

  const isQuoteOpening = (character === "'" || character === '"') && details.quote == null;
  if (isQuoteOpening) {
    return { current: details.current, quote: character };
  }

  const isQuoteClosing = character === details.quote;
  if (isQuoteClosing) return { current: details.current, quote: null };

  const isWhitespaceOutsideQuote = /\s/.test(character) && details.quote == null;
  if (isWhitespaceOutsideQuote) {
    const isCurrentNotEmpty = details.current !== "";
    if (isCurrentNotEmpty) details.argumentList.push(details.current);

    return { current: "", quote: details.quote };
  }

  return { current: details.current + character, quote: details.quote };
};
