import type { Child } from "hono/jsx";

const TOKEN_PATTERN = /"[^"]*"?|'[^']*'?|\s+|\S+/g;
const BINARY_NAMES = new Set(["bridge", "npm", "claude"]);

type TokenKind = "bin" | "sub" | "flag" | "value" | "file" | "num" | "plain" | "dim";

const NUMBER_PATTERN = /^\d+(\.\d+)?[a-zA-Z]{0,2}$/;

function readTokenKind(token: string, isCommandStart: boolean, isAfterFlag: boolean): TokenKind {
  if (/^["']/.test(token)) return "value";
  if (token === "\\") return "dim";
  if (token.startsWith("@")) return "file";
  if (token.startsWith("-")) return "flag";
  if (NUMBER_PATTERN.test(token)) return "num";
  if (token === "bridge" || (isCommandStart && BINARY_NAMES.has(token))) return "bin";
  if (isAfterFlag) return "value";
  return "sub";
}

/**
 * Colors one shell command line the way a themed terminal does: the command name in the
 * accent, subcommands in the text color, flags in cyan, values and quoted strings in amber,
 * @file mentions in magenta and numbers in orange. Every terminal panel uses this.
 */
export function colorCommand(command: string): Child[] {
  const tokens = command.match(TOKEN_PATTERN) ?? [];
  let isCommandStart = true;
  let isAfterFlag = false;

  return tokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token;

    const kind = readTokenKind(token, isCommandStart, isAfterFlag);
    isCommandStart = false;
    isAfterFlag = kind === "flag" && token !== "--" && !token.includes("=");
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: the tokens never reorder
      <span class={`tk-${kind}`} key={index}>
        {token}
      </span>
    );
  });
}

/** Colors the numbers inside a line of command output orange and leaves the rest as it is. */
export function colorNumbers(text: string): Child[] {
  return text.split(/(\d+(?:\.\d+)?[a-z]?)/g).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
      <span class="tk-num" key={index}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}
